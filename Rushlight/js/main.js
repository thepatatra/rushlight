/* Rushlight - panneau (CEP + Node.js) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const $ = (id) => document.getElementById(id);
const SETTINGS = ['lang', 'preset', 'auto', 'threshold', 'minSilence', 'padBefore', 'padAfter', 'cutCalm', 'minCalm', 'mode',
  'closeGaps', 'backup', 'ffmpeg', 'hlCount', 'hlLength'];
// dossiers de sauvegardes possibles : français, anglais, et celui d'avant le renommage (v0.7.x)
const BACKUP_DIRS = [I18N.fr.backupDir, I18N.en.backupDir, 'AutoCut Lite - sauvegardes'];

// Modes prédéfinis : choisir un mode remplit ces réglages ; modifier l'un d'eux à la main repasse en « Personnalisé ».
// Leur description est dans i18n.js (presetInfo_<mode>).
const PRESETS = {
  gaming: { values: { minSilence: 800, padBefore: 150, padAfter: 400, cutCalm: false, minCalm: 8, hlCount: 8, hlLength: 15 } },
  vlog: { values: { minSilence: 350, padBefore: 80, padAfter: 120, cutCalm: false, minCalm: 5, hlCount: 5, hlLength: 10 } },
  podcast: { values: { minSilence: 1000, padBefore: 200, padAfter: 300, cutCalm: false, minCalm: 10, hlCount: 5, hlLength: 20 } },
  bestof: { values: { minSilence: 300, padBefore: 60, padAfter: 100, cutCalm: true, minCalm: 3, hlCount: 10, hlLength: 8 } },
};
const PRESET_FIELDS = Object.keys(PRESETS.gaming.values);
const DETECTION = ['auto', 'threshold', 'minSilence', 'padBefore', 'padAfter', 'cutCalm', 'minCalm'];
const WINDOW = 0.05;       // durée d'une mesure de volume (s)
const MIN_SPEECH = 0.1;    // un bruit plus court que ça (clic, souffle) compte comme du silence
const HYSTERESIS = 6;      // dB : un silence ne commence que nettement sous le seuil (fins de mots gardées)
const CALM_SMOOTH = 1;     // les passages calmes sont jugés sur le volume moyen d'une seconde
const CHUNK = 3600;        // les longues séquences sont coupées par tranches d'1 h

let sequence = null;   // infos renvoyées par acl_getSequenceInfo
let analysis = null;   // { db, hf, levels, frameDuration, covered } : volumes de toute la séquence, réutilisés quand on change un réglage
let pending = null;    // [{ zone, intervals }] prêts à couper
let savedMoments = { items: [], frame: 1 / 30 }; // moments forts lus dans les marqueurs de la séquence
let lastBackup = null;  // nom de la dernière sauvegarde, à rouvrir en cas de problème

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function evalJSX(code) {
  return new Promise((resolve, reject) => {
    window.__adobe_cep__.evalScript(code, (result) => {
      if (!result || result === 'EvalScript error.') return reject(new Error(t('extendScriptError', { code: code.slice(0, 80) })));
      const data = JSON.parse(result);
      if (data.error) return reject(new Error(data.error));
      resolve(data);
    });
  });
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}

/* ---------- ffmpeg ---------- */

function extensionDir() {
  const url = window.__adobe_cep__.getSystemPath('extension'); // file:///C:/...
  return decodeURIComponent(url.replace(/^file:\/{2,3}/, ''));
}

// winget installe Gyan.FFmpeg dans Packages\Gyan.FFmpeg_*\ffmpeg-<version>-*\bin
function wingetFfmpeg() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    return fs.readdirSync(root).filter((d) => d.startsWith('Gyan.FFmpeg')).flatMap((pkg) =>
      fs.readdirSync(path.join(root, pkg)).map((build) => path.join(root, pkg, build, 'bin', 'ffmpeg.exe')));
  } catch (e) {
    return [];
  }
}

function findFfmpeg() {
  const custom = $('ffmpeg').value.trim();
  if (custom) return custom;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(extensionDir(), 'bin', 'ffmpeg.exe'),
    ...wingetFfmpeg(),
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'ffmpeg';
}

// Lance ffmpeg ; chaque ligne de sa sortie est passée à onLine au fil de l'eau (rien n'est gardé en mémoire
// à part la fin, pour le message d'erreur) : une vidéo de 2 h ne sature pas le panneau.
function runFfmpeg(args, onLine) {
  return new Promise((resolve, reject) => {
    let rest = '';
    let tail = '';
    const proc = spawn(findFfmpeg(), args, { windowsHide: true });
    proc.stderr.on('data', (d) => {
      const lines = (rest + d).split('\n');
      rest = lines.pop();
      if (onLine) lines.forEach(onLine);
      tail = (tail + d).slice(-2000);
    });
    proc.on('error', () => reject(new Error(t('ffmpegMissing'))));
    proc.on('close', (code) => {
      if (rest && onLine) onLine(rest);
      if (code === 0) resolve();
      else reject(new Error(tail.split('\n').slice(-3).join('\n')));
    });
  });
}

// Volume (dB RMS) toutes les 50 ms sur la portion utilisée du média : global (levels) et aigus > 2 kHz (high)
async function measureLevels(file, from, duration, onProgress) {
  const meter = 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level';
  const series = {};
  let lastReport = 0;
  await runFfmpeg([
    '-hide_banner', '-nostats',
    '-ss', from.toFixed(3), '-t', duration.toFixed(3), '-i', file,
    '-vn', '-filter_complex',
    `[0:a:0]aresample=16000,asetnsamples=n=${WINDOW * 16000}:p=0,asplit=2[a][b];` +
      `[a]${meter}[full];[b]highpass=f=2000,highpass=f=2000,${meter}[high]`,
    '-map', '[full]', '-f', 'null', '-', '-map', '[high]', '-f', 'null', '-',
  ], (line) => {
    // les deux mesures sortent mélangées, chacune signée par le nom de son filtre (Parsed_ametadata_N)
    const m = line.match(/Parsed_ametadata_(\d+) @[^\]]*\] lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    if (!m) return;
    (series[m[1]] = series[m[1]] || []).push(m[2] === '-inf' ? -100 : Math.max(-100, parseFloat(m[2])));
    const done = series[m[1]].length * WINDOW;
    if (onProgress && done - lastReport >= 30) { lastReport = done; onProgress(Math.min(1, done / duration)); }
  });
  const [full, high] = Object.keys(series).sort((a, b) => a - b).map((k) => series[k]);
  return { levels: full || [], high: high || [] };
}

// Additionne (en énergie) le son de tous les clips mesurés sur une grille de 50 ms couvrant toute la séquence.
// Les endroits sans aucun clip audio restent à NaN : ce ne sont pas des silences mais des trous.
function buildGrid(measured, end) {
  const n = Math.ceil(end / WINDOW) + 1;
  const power = new Float64Array(n);
  const highPower = new Float64Array(n);
  const covered = new Uint8Array(n);
  for (const { clip, levels, high } of measured) {
    const speed = (clip.outPoint - clip.inPoint) / (clip.end - clip.start);
    for (let i = 0; i < levels.length; i++) {
      const t = clip.start + (i * WINDOW) / speed;
      if (t >= clip.end) break;
      const k = Math.round(t / WINDOW);
      if (k >= n) break;
      power[k] += Math.pow(10, levels[i] / 10);
      highPower[k] += Math.pow(10, (high[i] === undefined ? -100 : high[i]) / 10);
      covered[k] = 1;
    }
  }
  const db = new Float32Array(n);
  const hf = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    db[k] = covered[k] ? Math.max(-100, 10 * Math.log10(power[k])) : NaN;
    hf[k] = covered[k] ? Math.max(-100, 10 * Math.log10(highPower[k])) : NaN;
  }
  return { db, hf };
}

/* ---------- réglage automatique ---------- */

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Méthode d'Otsu : la coupure qui sépare le mieux un ensemble de volumes (triés) en deux groupes
function otsuSplit(sorted) {
  const lo = Math.floor(sorted[0]);
  const bins = new Array(Math.ceil(sorted[sorted.length - 1]) - lo + 1).fill(0);
  for (const v of sorted) bins[Math.floor(v) - lo]++;
  const total = sorted.length;
  const sumAll = sorted.reduce((s, v) => s + v, 0);
  let best = 0, split = lo, wB = 0, sumB = 0;
  for (let i = 0; i < bins.length; i++) {
    wB += bins[i];
    sumB += bins[i] * (lo + i + 0.5);
    const wF = total - wB;
    if (!wB || !wF) continue;
    const between = wB * wF * Math.pow(sumB / wB - (sumAll - sumB) / wF, 2);
    if (between > best) { best = between; split = lo + i + 1; }
  }
  return split;
}

// Sur toute la séquence : sépare « rien ne se passe » (fond) de « il se passe quelque chose » (voix, jeu, musique…),
// puis, dans ce qui se passe, le calme de l'intense. Le seuil de silence est placé plus près du fond que de
// l'activité pour ne pas couper les fins de mots ou les sons faibles.
function autoLevels(values) {
  const sorted = [...values].sort((a, b) => a - b); // le silence numérique (-100 dB) compte aussi comme du « rien »
  if (sorted.length < 20) return null;
  const split = otsuSplit(sorted);
  const noise = sorted.filter((v) => v < split);
  const active = sorted.filter((v) => v >= split);
  if (!noise.length || !active.length) return null;
  const noiseLevel = percentile(noise, 0.5);
  const activityLevel = percentile(active, 0.5);
  const threshold = Math.round(Math.min(-10, Math.max(-70, noiseLevel + (activityLevel - noiseLevel) * 0.35)));

  const above = sorted.filter((v) => v >= threshold);
  const calmThreshold = above.length >= 20 ? otsuSplit(above) : threshold + 12;
  const intense = above.filter((v) => v >= calmThreshold);
  return {
    threshold,
    calmThreshold,
    noiseLevel,
    activityLevel,
    intenseLevel: intense.length ? percentile(intense, 0.5) : activityLevel,
    contrast: activityLevel - noiseLevel,
  };
}

/* ---------- calcul des coupes ---------- */

// Silences en secondes timeline. Les trous (NaN) ne sont pas des silences : on n'y coupe pas.
// Deux seuils, comme un « noise gate » : un silence ne commence que si le son descend sous closeThreshold
// (plus bas que threshold) et ne finit que quand il remonte au-dessus de threshold. Les fins de mots et de
// sons qui s'éteignent doucement entre les deux seuils sont donc gardées.
function silencesFromLevels(db, threshold, closeThreshold = threshold) {
  const loud = new Array(db.length);
  let silent = false;
  for (let i = 0; i < db.length; i++) {
    const v = db[i];
    if (Number.isNaN(v)) silent = false;
    else if (silent) silent = v < threshold;
    else silent = v < closeThreshold;
    loud[i] = !silent;
  }
  // efface les sons trop courts (clics, respirations) au milieu d'un silence
  const minRun = Math.round(MIN_SPEECH / WINDOW);
  for (let i = 0; i < loud.length;) {
    if (!loud[i] || Number.isNaN(db[i])) { i++; continue; }
    let j = i;
    while (j < loud.length && loud[j] && !Number.isNaN(db[j])) j++;
    const quietAround = (i === 0 || !loud[i - 1]) && (j === loud.length || !loud[j]);
    if (j - i < minRun && quietAround) loud.fill(false, i, j);
    i = j;
  }
  return runs(loud.map((v) => !v));
}

// Passages où le volume moyen (sur 1 s) reste sous le seuil « calme » pendant au moins minCalm secondes
function calmPassages(db, calmThreshold, minCalm) {
  const half = Math.round(CALM_SMOOTH / WINDOW / 2);
  const power = Array.from(db, (v) => (Number.isNaN(v) ? NaN : Math.pow(10, v / 10)));
  const calm = new Array(db.length).fill(false);
  let sum = 0, count = 0, holes = 0;
  // moyenne glissante centrée ; une fenêtre qui touche un trou n'est jamais « calme »
  const add = (k, sign) => {
    if (k < 0 || k >= power.length) return;
    if (Number.isNaN(power[k])) holes += sign; else { sum += sign * power[k]; count += sign; }
  };
  for (let k = 0; k <= half; k++) add(k, 1);
  for (let i = 0; i < db.length; i++) {
    if (i > 0) { add(i + half, 1); add(i - half - 1, -1); }
    calm[i] = !holes && count > 0 && 10 * Math.log10(sum / count) < calmThreshold;
  }
  return runs(calm).filter(([s, e]) => e - s >= minCalm);
}

// [début, fin] (secondes) de chaque suite de true
function runs(flags) {
  const out = [];
  for (let i = 0; i < flags.length;) {
    if (!flags[i]) { i++; continue; }
    let j = i;
    while (j < flags.length && flags[j]) j++;
    out.push([i * WINDOW, j * WINDOW]);
    i = j;
  }
  return out;
}

function computeCuts(raw, opts, frame) {
  raw.sort((a, b) => a[0] - b[0]);
  // fusionne les silences qui se touchent ou se chevauchent
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + frame) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  const cuts = [];
  for (const [s, e] of merged) {
    if (e - s < opts.minSilence) continue;
    // la marge après le son décale le début, la marge avant le son recule la fin ; on reste sur des images entières
    const start = Math.ceil((s + opts.padAfter) / frame - 1e-6) * frame;
    const end = Math.floor((e - opts.padBefore) / frame + 1e-6) * frame;
    if (end - start >= frame) cuts.push([+start.toFixed(6), +end.toFixed(6)]);
  }
  return cuts;
}

function readOptions() {
  return {
    auto: $('auto').checked,
    threshold: parseInt($('threshold').value, 10),
    minSilence: Math.max(0.1, parseFloat($('minSilence').value) / 1000),
    padBefore: Math.max(0, parseFloat($('padBefore').value) / 1000),
    padAfter: Math.max(0, parseFloat($('padAfter').value) / 1000),
    cutCalm: $('cutCalm').checked,
    minCalm: Math.max(1, parseFloat($('minCalm').value) || 5),
    mode: $('mode').value,
  };
}

// Recalcule les coupes à partir des volumes déjà mesurés (instantané, sans relancer ffmpeg)
function updateCuts() {
  if (!analysis) return;
  const opts = readOptions();
  const notes = [];
  const auto = analysis.levels;

  if (auto) {
    if (opts.auto) {
      $('threshold').value = auto.threshold;
      showThreshold();
      opts.threshold = auto.threshold;
    }
    $('levels').textContent = t('levels', {
      noise: auto.noiseLevel.toFixed(0), activity: auto.activityLevel.toFixed(0), intense: auto.intenseLevel.toFixed(0),
    });
    if (opts.auto && auto.contrast < 10) notes.push(t('lowContrast'));
  }
  const calmThreshold = auto ? Math.max(auto.calmThreshold, opts.threshold + 3) : opts.threshold + 12;

  // seuil d'entrée dans un silence : 6 dB plus bas, sans descendre dans le bruit de fond
  const closeThreshold = auto ? Math.max(opts.threshold - HYSTERESIS, auto.noiseLevel + 3) : opts.threshold - HYSTERESIS;
  const raw = silencesFromLevels(analysis.db, opts.threshold, Math.min(opts.threshold, closeThreshold));
  if (opts.cutCalm) raw.push(...calmPassages(analysis.db, calmThreshold, opts.minCalm));
  const cuts = computeCuts(raw, opts, analysis.frameDuration);

  // seules les zones choisies (jamais celles déjà coupées) sont retenues
  const zones = selectedZones();
  pending = zones.map((zone) => ({ zone, intervals: clipToZone(cuts, zone, analysis.frameDuration) }));
  const count = pending.reduce((n, p) => n + p.intervals.length, 0);
  const total = pending.reduce((sum, p) => sum + p.intervals.reduce((s, [a, b]) => s + (b - a), 0), 0);

  let msg = t('thresholdLine', { threshold: opts.threshold }) + (opts.cutCalm ? t('calmLine', { calm: calmThreshold }) : '') + '\n';
  if (!analysis.zones.length) {
    msg += t('allCut');
  } else {
    msg += zones.length === 1
      ? t('zoneSummary', { from: formatTime(zones[0][0]), to: formatTime(zones[0][1]) })
      : t('zonesSummary', { n: zones.length });
    msg += t('cutsSummary', { count, total: formatTime(total) });
  }
  if (analysis.processed.length) {
    notes.push(t('alreadyCut', { list: analysis.processed.map(([s, e]) => `${formatTime(s)} → ${formatTime(e)}`).join(', ') }));
  }
  if (analysis.skipped.length) notes.push(t('skipped', { list: analysis.skipped.join(', ') }));
  if (notes.length) msg += '\n' + notes.join('\n');
  setStatus(msg, count ? 'ok' : '');
  $('apply').disabled = !zones.length;
}

/* ---------- zones ---------- */

function mergeIntervals(list, tolerance) {
  const merged = [];
  for (const [s, e] of [...list].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + tolerance) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// Ce qui reste à couper : la séquence moins les zones déjà coupées, en morceaux d'1 h maximum
function remainingZones(processed, end) {
  const zones = [];
  let cursor = 0;
  for (const [s, e] of [...processed, [end, end]]) {
    for (let a = cursor; a < s - 1; a += CHUNK) zones.push([a, Math.min(a + CHUNK, s)]);
    cursor = Math.max(cursor, e);
  }
  return zones.filter(([a, b]) => b - a >= 1);
}

function clipToZone(intervals, zone, frame) {
  const [zs, ze] = zone.map((t) => Math.round(t / frame) * frame); // limites calées sur des images entières
  return intervals
    .map(([s, e]) => [Math.max(s, zs), Math.min(e, ze)])
    .filter(([s, e]) => e - s >= frame);
}

function selectedZones() {
  const v = $('zone').value;
  if (v === 'all') return analysis.zones;
  return [analysis.zones[parseInt(v, 10)]].filter(Boolean);
}

function populateZones() {
  const select = $('zone');
  select.innerHTML = '';
  const add = (value, text) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  };
  if (!analysis.zones.length) return add('', t('zoneAllCut'));
  if (analysis.zones.length > 1) add('all', t('zoneAll', { n: analysis.zones.length }));
  analysis.zones.forEach(([s, e], i) => add(i, t('zoneItem', { i: i + 1, from: formatTime(s), to: formatTime(e) })));
}

/* ---------- sauvegardes ---------- */

// Copie horodatée du projet, à côté de lui : « Rushlight - sauvegardes\Projet_2026-10-27_14-05-12_avant-coupe.prproj ».
// Jamais d'écrasement : chaque action crée un nouveau fichier.
function backupCopy(projectPath, reason, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const dir = path.join(path.dirname(projectPath), t('backupDir'));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(projectPath, path.extname(projectPath));
  for (let n = 1; ; n++) {
    const dest = path.join(dir, `${base}_${stamp}_${reason}${n > 1 ? `-${n}` : ''}.prproj`);
    try {
      fs.copyFileSync(projectPath, dest, fs.constants.COPYFILE_EXCL);
      return dest;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// À appeler avant toute action qui modifie le projet. Lève une erreur (et l'action n'a pas lieu) si la sauvegarde échoue.
async function backup(reason) {
  if (!$('backup').checked) return;
  setStatus(t('savingProject'));
  const project = await evalJSX('acl_saveProject()');
  if (!fs.existsSync(project.path)) throw new Error(t('projectMissing', { path: project.path }));
  const dest = backupCopy(project.path, reason);
  lastBackup = path.basename(dest);
  $('backupInfo').textContent = t('lastBackup', { file: lastBackup });
}

// Message quand Premiere signale des clips empilés : on arrête tout et on indique la sauvegarde à rouvrir
function brokenTimelineMessage(res, step) {
  const restore = lastBackup ? t('restoreHint', { file: lastBackup }) : '';
  const at = step ? t('stepAt', { step }) : '';
  if (res.razorMiss) {
    return t('razorMiss', {
      step: at, found: res.found.toFixed(3), wanted: res.wanted.toFixed(3), gap: (res.found - res.wanted).toFixed(3), restore,
    });
  }
  if (res.alreadyBroken) return t('alreadyBroken', { n: res.overlaps });
  return t('overlaps', { step: at, n: res.overlaps, restore });
}

async function openBackups() {
  try {
    const project = await evalJSX('acl_projectPath()');
    // dossier de la langue actuelle d'abord, puis ceux de l'autre langue et d'avant le renommage
    const dir = [t('backupDir'), ...BACKUP_DIRS].map((d) => path.join(path.dirname(project.path), d)).find((d) => fs.existsSync(d));
    if (!dir) return setStatus(t('noBackups'));
    spawn('explorer.exe', [dir], { detached: true });
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

/* ---------- actions ---------- */

function resetAnalysis() {
  analysis = null;
  pending = null;
  $('apply').disabled = true;
  $('levels').textContent = '';
  $('zone').innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('zoneNone');
  $('zone').appendChild(none);
}

async function refresh() {
  resetAnalysis();
  try {
    sequence = await evalJSX('acl_getSequenceInfo()');
    const select = $('track');
    let previous = select.value;
    try { previous = previous || localStorage.getItem('acl.track'); } catch (e) {}
    select.innerHTML = '';
    const mix = document.createElement('option');
    mix.value = 'mix';
    mix.textContent = t('trackMix');
    select.appendChild(mix);
    for (const track of sequence.audioTracks) {
      const opt = document.createElement('option');
      opt.value = track.index;
      opt.textContent = `A${track.index + 1} – ${track.name} (${t('trackClips', { n: track.clips.length })})` +
        (track.muted ? ` – ${t('trackMuted')}` : '');
      select.appendChild(opt);
    }
    if (previous && select.querySelector(`option[value="${previous}"]`)) select.value = previous;
    setStatus(t('sequenceInfo', { name: sequence.name, duration: formatTime(sequence.end) }));
    loadHighlights();
  } catch (e) {
    sequence = null;
    setStatus(e.message, 'error');
  }
}

async function analyze() {
  await refresh();
  if (!sequence) return;
  const source = $('track').value;
  const tracks = source === 'mix'
    ? sequence.audioTracks.filter((t) => !t.muted)
    : [sequence.audioTracks[parseInt(source, 10)]].filter(Boolean);
  const clips = tracks.flatMap((t) => t.clips);
  if (!clips.length) return setStatus(t('noAudio'), 'error');

  $('analyze').disabled = true;
  const measured = [];
  const skipped = [];
  const cache = new Map(); // un même morceau de média présent sur plusieurs pistes n'est mesuré qu'une fois
  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const label = t('analyzing', { i: i + 1, n: clips.length, name: clip.name });
      setStatus(label + '…');
      if (!clip.path || !fs.existsSync(clip.path)) { skipped.push(clip.name); continue; }
      const key = `${clip.path}|${clip.inPoint}|${clip.outPoint}|${clip.start}`;
      if (!cache.has(key)) {
        cache.set(key, await measureLevels(clip.path, clip.inPoint, clip.outPoint - clip.inPoint,
          (p) => setStatus(`${label} (${Math.round(p * 100)} %)`)));
      }
      measured.push({ clip, ...cache.get(key) });
    }
    const end = Math.max(sequence.end, ...clips.map((c) => c.end));
    const grid = buildGrid(measured, end);
    const values = Array.from(grid.db).filter((v) => !Number.isNaN(v));
    const processed = mergeIntervals(sequence.processed, 1);
    analysis = {
      ...grid,
      levels: autoLevels(values),
      covered: values.length * WINDOW,
      frameDuration: sequence.frameDuration,
      processed,
      zones: remainingZones(processed, end),
      skipped,
    };
    populateZones();
    updateCuts();
  } catch (e) {
    setStatus(e.message, 'error');
  } finally {
    $('analyze').disabled = false;
  }
}

// La timeline a changé : il faudra réanalyser ; la liste des moments forts est relue depuis leurs marqueurs,
// qui ont suivi la coupe
function timelineChanged() {
  resetAnalysis();
  loadHighlights();
}

async function closeGaps() {
  const res = await evalJSX('acl_closeGaps()');
  timelineChanged();
  return res;
}

async function apply() {
  if (!pending) return;
  const mode = $('mode').value;
  $('apply').disabled = true;
  try {
    if (mode === 'markers') await backup(t('reason_markers'));
    // zones d'1 h max traitées de la fin vers le début : couper la fin ne décale pas les zones précédentes
    const work = [...pending].sort((a, b) => b.zone[0] - a.zone[0]);
    const left = analysis.zones.length - work.length;
    let removed = 0, markers = 0;
    for (let n = 0; n < work.length; n++) {
      const step = work.length > 1 ? t('zoneStep', { i: n + 1, n: work.length }) : '';
      // une sauvegarde avant chaque zone : on peut revenir à n'importe quelle étape de la découpe
      if (mode !== 'markers') {
        await backup(work.length > 1 ? t('reason_cutZone', { i: n + 1, n: work.length }) : t('reason_cut'));
      }
      setStatus(t('cutting', { step }));
      const payload = {
        intervals: work[n].intervals, mode, zone: mode === 'markers' ? null : work[n].zone,
        zoneName: t('zoneMarkerName'), zoneComment: t('zoneMarkerComment'),
      };
      const res = await evalJSX(`acl_apply(${JSON.stringify(payload)})`);
      if (res.overlaps || res.razorMiss) {
        timelineChanged();
        return setStatus(brokenTimelineMessage(res, step.trim()), 'error');
      }
      removed += res.removed || 0;
      markers += res.markers || 0;
    }
    if (mode === 'markers') return setStatus(t('markersAdded', { n: markers }), 'ok');

    let msg = t('cutDone', { n: removed, rippled: mode === 'ripple' ? t('cutRippled') : '' }) + '\n' + t('zonesMarked');
    if ($('closeGaps').checked) {
      await backup(t('reason_gaps'));
      setStatus(t('closingGaps'));
      const gaps = await closeGaps();
      if (gaps.overlaps) return setStatus(brokenTimelineMessage(gaps, t('gapsStep')), 'error');
      if (gaps.gaps) msg += '\n' + t('gapsRemoved', { n: gaps.gaps, total: formatTime(gaps.seconds) });
    }
    if (mode === 'ripple' || mode === 'gaps') msg += '\n' + relinkMessage(await relink());
    if (left > 0) msg += '\n' + t('zonesLeft', { n: left });
    timelineChanged();
    setStatus(msg, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
    $('apply').disabled = false;
  }
}

// Relie les morceaux image + son séparés par la coupe (ne déplace et ne supprime rien)
async function relink() {
  setStatus(t('relinking'));
  try {
    return await evalJSX('acl_relink()');
  } catch (e) {
    return { error: e.message };
  }
}

function relinkMessage(res) {
  if (res.error) return t('relinkError', { error: res.error });
  if (res.unsupported) return t('relinkUnsupported');
  return t('relinked', { n: res.linked });
}

async function relinkNow() {
  try {
    await backup(t('reason_relink'));
    const res = await relink();
    setStatus(relinkMessage(res), res.error || res.unsupported ? 'error' : 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function closeGapsNow() {
  try {
    await backup(t('reason_gaps'));
    setStatus(t('closingGaps'));
    const res = await closeGaps();
    if (res.overlaps) return setStatus(brokenTimelineMessage(res, t('gapsStep')), 'error');
    setStatus(res.gaps ? t('gapsRemoved', { n: res.gaps, total: formatTime(res.seconds) }) : t('noGaps'), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Pour une séquence coupée avant la v0.7.0 (ou à la main) : protège la zone pour que l'extension n'y repasse plus
async function markDone() {
  try {
    await backup(t('reason_markDone'));
    const res = await evalJSX(`acl_markProcessed(${JSON.stringify({ name: t('zoneMarkerName'), comment: t('manualMarkerComment') })})`);
    resetAnalysis(); // les zones restantes ont changé
    setStatus(t('markedDone', { from: formatTime(res.start), to: formatTime(res.end) }), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

/* ---------- moments forts ---------- */

// Mesures de la séquence (hors trous) pour la recherche des moments forts
function timelineFrames() {
  const frames = [];
  for (let k = 0; k < analysis.db.length; k++) {
    if (!Number.isNaN(analysis.db[k])) frames.push({ t: k * WINDOW, db: analysis.db[k], hf: analysis.hf[k] });
  }
  return frames;
}

// Les moments forts sont relus depuis les marqueurs de la séquence : la liste survit à la fermeture du panneau
// ou de Premiere, et suit la timeline quand elle est coupée.
async function loadHighlights() {
  try {
    const res = await evalJSX('acl_getHighlights()');
    savedMoments = { items: res.items, frame: res.frameDuration };
  } catch (e) {
    savedMoments = { items: [], frame: savedMoments.frame };
  }
  renderHighlights();
}

function renderHighlights() {
  const kept = savedMoments.items.filter((m) => !m.rejected).sort((a, b) => a.rank - b.rank);
  const ignored = savedMoments.items.length - kept.length;
  const list = $('hlList');
  list.innerHTML = '';
  for (const m of kept) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `#${m.rank} · ${formatTime(m.start)} → ${formatTime(m.end)}${m.comment ? ` · ${m.comment}` : ''}`;
    text.title = t('hlGoto');
    text.addEventListener('click', () => evalJSX(`acl_goto(${m.start})`).catch((e) => setStatus(e.message, 'error')));
    const ignore = document.createElement('button');
    ignore.className = 'hl-ignore';
    ignore.textContent = '✕';
    ignore.title = t('hlIgnore');
    ignore.addEventListener('click', () => rejectMoment(m));
    li.append(text, ignore);
    list.appendChild(li);
  }
  $('hlSummary').textContent = savedMoments.items.length
    ? t('hlSummary', { kept: kept.length }) + (ignored ? t('hlSummaryIgnored', { n: ignored }) : '')
    : '';
  $('hlBestOf').disabled = !kept.length;
  $('hlClear').disabled = !savedMoments.items.length;
}

async function rejectMoment(m) {
  try {
    await evalJSX(`acl_rejectHighlight(${JSON.stringify({ start: m.start, name: t('hlIgnoredName'), comment: t('hlIgnoredComment') })})`);
    await loadHighlights();
    setStatus(t('hlRejected', { rank: m.rank }), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function clearHighlights() {
  try {
    await backup(t('reason_clearHighlights'));
    const res = await evalJSX('acl_clearHighlights()');
    await loadHighlights();
    setStatus(t('hlCleared', { n: res.removed }), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Cherche de NOUVEAUX moments forts : ceux déjà marqués ou ignorés sont exclus, la numérotation continue
async function highlights() {
  if (!analysis) await analyze();
  if (!analysis) return;
  await loadHighlights(); // à jour si des marqueurs ont été supprimés à la main
  const count = Math.max(1, parseInt($('hlCount').value, 10) || 5);
  const moments = findHighlights(timelineFrames(), {
    threshold: parseInt($('threshold').value, 10),
    count,
    length: Math.max(3, parseFloat($('hlLength').value) || 10),
    exclude: savedMoments.items.map((m) => [m.start, m.end]),
  });
  if (!moments.length) {
    return savedMoments.items.length ? setStatus(t('hlNoneLeft'), 'ok') : setStatus(t('hlNotEnough'), 'error');
  }

  try {
    await backup(t('reason_highlights'));
    const first = Math.max(0, ...savedMoments.items.map((m) => m.rank)) + 1;
    const items = [...moments].sort((a, b) => a.rank - b.rank).map((m, i) => ({
      start: m.start,
      end: m.end,
      name: `★ ${t('hlMarkerName')} #${first + i}`,
      comment: m.reasons.map((r) => t('reason_' + r)).join(', '),
    }));
    await evalJSX(`acl_addHighlightMarkers(${JSON.stringify({ items })})`);
    await loadHighlights();
    let msg = t('hlFound', { n: items.length, first, last: first + items.length - 1 });
    if (items.length < count) msg += '\n' + t('hlFinished');
    setStatus(msg, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Copie de la séquence ne gardant que les moments forts gardés, bout à bout (la séquence d'origine reste intacte)
async function bestOf() {
  const moments = savedMoments.items.filter((m) => !m.rejected);
  if (!moments.length) return;
  const { frame } = savedMoments;
  // un peu d'avance avant chaque moment pour ne pas démarrer sur un mot coupé ; calé sur des images entières
  const ranges = mergeIntervals(moments.map((m) => [
    Math.floor(Math.max(0, m.start - 0.3) / frame) * frame,
    Math.ceil(m.end / frame) * frame,
  ]), frame);
  $('hlBestOf').disabled = true;
  try {
    await backup(t('reason_bestOf'));
    setStatus(t('bestOfCreating'));
    const res = await evalJSX(`acl_createBestOf(${JSON.stringify({ ranges, prefix: t('bestOfPrefix') })})`);
    timelineChanged(); // la séquence active est maintenant le best of
    if (res.overlaps || res.razorMiss) {
      return setStatus(t('bestOfBroken', { name: res.name }) + brokenTimelineMessage(res, ''), 'error');
    }
    setStatus(t('bestOfDone', { name: res.name, duration: formatTime(res.seconds) }), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
    $('hlBestOf').disabled = false;
  }
}

async function testFfmpeg() {
  try {
    await runFfmpeg(['-hide_banner', '-f', 'lavfi', '-i', 'anullsrc', '-t', '0.1', '-f', 'null', '-']);
    setStatus(t('ffmpegOk', { path: findFfmpeg() }), 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Numéro de version lu dans le manifest (seul endroit où on le change)
function showVersion() {
  try {
    const xml = fs.readFileSync(path.join(extensionDir(), 'CSXS', 'manifest.xml'), 'utf8');
    const m = xml.match(/ExtensionBundleVersion="([^"]+)"/);
    if (m) $('version').textContent = 'v' + m[1];
  } catch (e) {}
}

/* ---------- réglages persistants ---------- */

function showThreshold() {
  $('thresholdVal').textContent = `(${$('threshold').value} dB)`;
}

function showPresetInfo() {
  $('presetInfo').textContent = t('presetInfo_' + (PRESETS[$('preset').value] ? $('preset').value : 'custom'));
}

function applyPreset() {
  const preset = PRESETS[$('preset').value];
  saveSetting('preset');
  showPresetInfo();
  if (!preset) return;
  for (const [id, value] of Object.entries(preset.values)) {
    if ($(id).type === 'checkbox') $(id).checked = value;
    else $(id).value = value;
    saveSetting(id);
  }
  updateCuts();
}

function saveSetting(id) {
  const el = $(id);
  try { localStorage.setItem('acl.' + id, el.type === 'checkbox' ? String(el.checked) : el.value); } catch (e) {}
}

function loadSettings() {
  for (const id of SETTINGS) {
    const el = $(id);
    try {
      const v = localStorage.getItem('acl.' + id);
      if (v !== null) {
        if (el.type === 'checkbox') el.checked = v === 'true';
        else el.value = v;
      }
    } catch (e) {}
    el.addEventListener('change', () => {
      saveSetting(id);
      if (PRESET_FIELDS.includes(id) && $('preset').value !== 'custom') {
        $('preset').value = 'custom';
        saveSetting('preset');
        showPresetInfo();
      }
      if (DETECTION.includes(id)) updateCuts();
    });
  }
  $('preset').addEventListener('change', applyPreset);
  showPresetInfo();
  // changer de langue recharge le panneau pour tout réafficher (les réglages sont déjà enregistrés)
  $('lang').addEventListener('change', () => location.reload());
  $('track').addEventListener('change', () => {
    saveSetting('track');
    resetAnalysis(); // autre source de son : il faut réanalyser
  });
  // bouger le curseur passe en seuil manuel et met à jour l'aperçu en direct
  $('threshold').addEventListener('input', () => {
    showThreshold();
    if ($('auto').checked) { $('auto').checked = false; saveSetting('auto'); }
    updateCuts();
  });
  showThreshold();
}

// langue choisie dans les Réglages (lue avant le reste pour que tout s'affiche directement dans la bonne langue)
try { LANG = detectLanguage(localStorage.getItem('acl.lang') || 'auto'); } catch (e) { LANG = detectLanguage('auto'); }
applyI18n();
evalJSX(`acl_setLang('${LANG}')`).catch(() => {}); // messages d'erreur côté Premiere dans la même langue
resetAnalysis();
showVersion();
loadSettings();
$('refresh').addEventListener('click', refresh);
$('analyze').addEventListener('click', analyze);
$('apply').addEventListener('click', apply);
$('closeGapsNow').addEventListener('click', closeGapsNow);
$('openBackups').addEventListener('click', openBackups);
$('zone').addEventListener('change', updateCuts);
$('markDone').addEventListener('click', markDone);
$('relinkNow').addEventListener('click', relinkNow);
$('hlBestOf').addEventListener('click', bestOf);
$('hlClear').addEventListener('click', clearHighlights);
$('testFfmpeg').addEventListener('click', testFfmpeg);
$('hlFind').addEventListener('click', highlights);
refresh();
