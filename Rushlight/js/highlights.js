/* Rushlight - détection des moments forts à partir de l'audio seul.
 * Entrée : frames = [{ t, db, hf }] triées par temps timeline (une mesure toutes les ~50 ms),
 *   db = volume global, hf = volume des aigus (> 2 kHz).
 * Chaque fenêtre de `length` secondes reçoit un score selon : volume de la voix, intonation,
 * débit (syllabes/s), aigus (exclamations), rafales régulières (rires probables), continuité de la parole.
 */

const HIGHLIGHT_WEIGHTS = { loud: 1.0, dyn: 0.5, rate: 0.7, density: 0.6, bright: 0.5, laugh: 0.9 };
// Les raisons renvoyées sont des clés (loud, dyn, rate, density, bright, laugh, above), traduites par le panneau
// avec t('reason_<clé>').

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

// Pics d'énergie ≈ syllabes : maximum local qui dépasse ses voisins d'au moins 3 dB
function findPeaks(frames, from, to, threshold) {
  const peaks = [];
  for (let i = from + 3; i < to - 3; i++) {
    const v = frames[i].db;
    if (v < threshold || v <= frames[i - 1].db || v < frames[i + 1].db) continue;
    const before = Math.min(frames[i - 1].db, frames[i - 2].db, frames[i - 3].db);
    const after = Math.min(frames[i + 1].db, frames[i + 2].db, frames[i + 3].db);
    if (v - before >= 3 && v - after >= 3) peaks.push(i);
  }
  return peaks;
}

// Rire ≈ au moins 4 éclats forts, réguliers (150 à 350 ms d'écart) et soufflés (plus d'aigus que la voix normale)
function countLaughPeaks(frames, peaks, voiceLevel, brightLevel) {
  const strong = peaks.filter((i) => frames[i].db >= voiceLevel - 3);
  let count = 0;
  let run = [strong[0]];
  const flush = () => {
    if (run.length < 4) return;
    const gaps = run.slice(1).map((p, k) => frames[p].t - frames[run[k]].t);
    const g = mean(gaps);
    const breathy = mean(run.map((p) => frames[p].hf - frames[p].db)) >= brightLevel + 3;
    if (breathy && gaps.every((x) => Math.abs(x - g) <= 0.25 * g)) count += run.length;
  };
  for (let k = 1; k < strong.length; k++) {
    const gap = frames[strong[k]].t - frames[strong[k - 1]].t;
    if (gap >= 0.15 && gap <= 0.35) run.push(strong[k]);
    else { flush(); run = [strong[k]]; }
  }
  if (strong.length) flush();
  return count;
}

function findHighlights(frames, opts) {
  const { threshold, count } = opts;
  if (frames.length < 20) return [];
  const length = Math.min(opts.length, frames[frames.length - 1].t - frames[0].t); // rush plus court qu'un moment
  const voiced = frames.filter((f) => f.db >= threshold);
  if (!voiced.length) return [];
  const voiceLevel = median(voiced.map((f) => f.db));
  const brightLevel = median(voiced.map((f) => f.hf - f.db));

  // fenêtres glissantes d'une seconde en une seconde
  const windows = [];
  const first = frames[0].t;
  const last = frames[frames.length - 1].t;
  let i0 = 0, i1 = 0;
  for (let start = first; start + length <= last + 0.001; start += 1) {
    while (i0 < frames.length && frames[i0].t < start) i0++;
    while (i1 < frames.length && frames[i1].t < start + length) i1++;
    const win = frames.slice(i0, i1);
    const speech = win.filter((f) => f.db >= threshold);
    const step = win.length > 1 ? (win[win.length - 1].t - win[0].t) / (win.length - 1) : 0.05;
    const speechSeconds = speech.length * step;
    if (speechSeconds < 0.4 * length) continue;

    const peaks = findPeaks(frames, i0, i1, threshold);
    windows.push({
      start, i0, i1,
      raw: {
        loud: mean(speech.map((f) => f.db)) - voiceLevel,
        dyn: stdDev(speech.map((f) => f.db)),
        rate: peaks.length / speechSeconds,
        density: speech.length / win.length,
        bright: mean(speech.map((f) => f.hf - f.db)) - brightLevel,
        laugh: countLaughPeaks(frames, peaks, voiceLevel, brightLevel) / length,
      },
    });
  }
  if (!windows.length) return [];

  // chaque critère est ramené à un écart à la moyenne du rush (z-score), puis pondéré
  const keys = Object.keys(HIGHLIGHT_WEIGHTS);
  const stats = {};
  for (const k of keys) {
    const vals = windows.map((w) => w.raw[k]);
    stats[k] = { m: mean(vals), s: stdDev(vals) || 1 };
  }
  for (const w of windows) {
    w.z = {};
    w.score = 0;
    for (const k of keys) {
      w.z[k] = (w.raw[k] - stats[k].m) / stats[k].s;
      w.score += HIGHLIGHT_WEIGHTS[k] * w.z[k];
    }
  }

  // garde les meilleures fenêtres sans chevauchement, et seulement celles qui se détachent nettement du reste du rush
  // (au moins un écart-type au-dessus du score moyen : un passage juste un peu plus fort que la moyenne ne compte pas).
  // Les passages déjà marqués ou ignorés (opts.exclude) comptent dans la moyenne mais ne sont plus proposés.
  const exclude = opts.exclude || [];
  const scores = windows.map((w) => w.score);
  const minScore = mean(scores) + stdDev(scores);
  windows.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const w of windows) {
    if (picked.length >= count || w.score < minScore) break;
    if (picked.some((p) => Math.abs(p.start - w.start) < length)) continue;
    if (exclude.some(([s, e]) => w.start < e && w.start + length > s)) continue;
    picked.push(w);
  }

  return picked.map((w, rank) => {
    // resserre sur la parole : du premier au dernier son de la fenêtre
    let a = w.i0, b = w.i1 - 1;
    while (a < b && frames[a].db < threshold) a++;
    while (b > a && frames[b].db < threshold) b--;
    const reasons = keys
      .filter((k) => w.z[k] > 0.8 && (k !== 'laugh' || w.raw.laugh > 0))
      .sort((x, y) => w.z[y] * HIGHLIGHT_WEIGHTS[y] - w.z[x] * HIGHLIGHT_WEIGHTS[x]);
    return {
      rank: rank + 1,
      start: frames[a].t,
      end: frames[b].t + 0.3,
      score: w.score,
      reasons: reasons.length ? reasons : ['above'],
    };
  }).sort((x, y) => x.start - y.start);
}
