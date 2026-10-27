// Rushlight - côté Premiere Pro (ExtendScript, ES3)
// Toutes les fonctions renvoient une chaîne JSON lue par le panneau.

var TICKS_PER_SECOND = 254016000000;
// Les noms de marqueurs commencent par un symbole qui sert à les reconnaître, quelle que soit la langue :
var HIGHLIGHT_PREFIX = '★';  // ★ Moment fort #n / Highlight #n
var REJECTED_PREFIX = '✖';   // ✖ Moment ignoré #n / Ignored #n
var PROCESSED_PREFIX = '✂';  // ✂ Rushlight : zone coupée (et l'ancien « ✂ AutoCut : zone coupée » des v0.7.x)

// Messages d'erreur dans la langue du panneau (le panneau appelle acl_setLang au démarrage)
var ACL_LANG = 'fr';
var ACL_MSG = {
    noSequence: ['Aucune séquence active.', 'No active sequence.'],
    markerMissing: ['Marqueur de ce moment introuvable (il a peut-être été supprimé à la main).',
        'Marker for this moment not found (it may have been deleted by hand).'],
    saveFirst: ['Enregistrez d\'abord le projet une première fois (Fichier > Enregistrer).',
        'Save the project once first (File > Save).'],
    notSaved: ['Le projet n\'a pas encore été enregistré.', 'The project has not been saved yet.'],
    copyFailed: ['Impossible de copier la séquence.', 'Could not copy the sequence.']
};

function acl_msg(key) {
    return ACL_MSG[key] ? ACL_MSG[key][ACL_LANG === 'en' ? 1 : 0] : key;
}

function acl_setLang(lang) {
    ACL_LANG = lang;
    return acl_toJSON({ ok: true });
}

function acl_toJSON(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') {
        return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
    }
    var parts = [], i;
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) parts.push(acl_toJSON(v[i]));
        return '[' + parts.join(',') + ']';
    }
    for (i in v) {
        if (v.hasOwnProperty(i)) parts.push(acl_toJSON(String(i)) + ':' + acl_toJSON(v[i]));
    }
    return '{' + parts.join(',') + '}';
}

function acl_error(msg) {
    return acl_toJSON({ error: String(msg) });
}

function acl_frameDuration(seq) {
    return Number(seq.timebase) / TICKS_PER_SECOND;
}

function acl_markers(seq) {
    var list = [], m = seq.markers.getFirstMarker();
    while (m) {
        list.push(m);
        m = seq.markers.getNextMarker(m);
    }
    return list;
}

function acl_setMarkerTime(marker, prop, seconds) {
    var t = new Time();
    t.seconds = seconds;
    try { marker[prop] = t; } catch (e) { marker[prop] = seconds; }
}

function acl_createMarker(seq, start, end, name, comment, color) {
    var marker = seq.markers.createMarker(start);
    acl_setMarkerTime(marker, 'end', end);
    marker.name = name;
    if (comment) marker.comments = comment;
    try { marker.setColorByIndex(color); } catch (e) {}
    return marker;
}

function acl_getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var info = {
            name: seq.name,
            frameDuration: acl_frameDuration(seq),
            end: Number(seq.end) / TICKS_PER_SECOND,
            processed: [],
            audioTracks: []
        };
        var markers = acl_markers(seq);
        for (var k = 0; k < markers.length; k++) {
            if (markers[k].name && markers[k].name.indexOf(PROCESSED_PREFIX) === 0) info.processed.push([markers[k].start.seconds, markers[k].end.seconds]);
        }
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            var track = seq.audioTracks[i];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var path = '';
                try { if (clip.projectItem) path = clip.projectItem.getMediaPath(); } catch (e) {}
                clips.push({
                    name: clip.name,
                    path: path,
                    start: clip.start.seconds,
                    end: clip.end.seconds,
                    inPoint: clip.inPoint.seconds,
                    outPoint: clip.outPoint.seconds
                });
            }
            var muted = false;
            try { muted = track.isMuted(); } catch (e) {}
            info.audioTracks.push({
                index: i,
                name: track.name || ('A' + (i + 1)),
                locked: track.isLocked(),
                muted: muted,
                clips: clips
            });
        }
        return acl_toJSON(info);
    } catch (e) {
        return acl_error(e);
    }
}

// Les marqueurs de la séquence servent de mémoire aux moments forts : « ★ Moment fort #n » (orange) pour ceux
// qu'on garde, « ✖ Moment ignoré #n » (blanc) pour ceux qu'on a écartés et qui ne doivent plus être proposés.
function acl_isHighlightMarker(m) {
    return m.name && (m.name.indexOf(HIGHLIGHT_PREFIX) === 0 || m.name.indexOf(REJECTED_PREFIX) === 0);
}

function acl_getHighlights() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var items = [], markers = acl_markers(seq);
        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            if (!acl_isHighlightMarker(m)) continue;
            var rank = m.name.match(/#(\d+)/);
            items.push({
                start: m.start.seconds,
                end: m.end.seconds,
                rank: rank ? parseInt(rank[1], 10) : 0,
                comment: m.comments || '',
                rejected: m.name.indexOf(REJECTED_PREFIX) === 0
            });
        }
        return acl_toJSON({ items: items, frameDuration: acl_frameDuration(seq) });
    } catch (e) {
        return acl_error(e);
    }
}

// payload = { items: [{ start, end, name, comment }] } ; s'ajoutent aux moments déjà marqués
function acl_addHighlightMarkers(payload) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        for (var i = 0; i < payload.items.length; i++) {
            var item = payload.items[i];
            acl_createMarker(seq, item.start, item.end, item.name, item.comment, 3); // orange
        }
        return acl_toJSON({ markers: payload.items.length });
    } catch (e) {
        return acl_error(e);
    }
}

// payload = { start, name, comment } : le moment fort qui commence à cet instant passe en « ignoré » (son marqueur
// reste, en blanc, pour que cette zone ne soit plus jamais proposée) ; name et comment viennent du panneau (langue)
function acl_rejectHighlight(payload) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var markers = acl_markers(seq);
        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            if (!m.name || m.name.indexOf(HIGHLIGHT_PREFIX) !== 0 || Math.abs(m.start.seconds - payload.start) > 0.05) continue;
            var rank = m.name.match(/#(\d+)/);
            m.name = REJECTED_PREFIX + ' ' + payload.name + (rank ? ' #' + rank[1] : '');
            m.comments = payload.comment;
            try { m.setColorByIndex(5); } catch (e) {} // blanc
            return acl_toJSON({ ok: true });
        }
        return acl_error(acl_msg('markerMissing'));
    } catch (e) {
        return acl_error(e);
    }
}

// Retire tous les marqueurs de moments forts (gardés et ignorés) pour repartir de zéro
function acl_clearHighlights() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var markers = acl_markers(seq), removed = 0;
        for (var i = 0; i < markers.length; i++) {
            if (acl_isHighlightMarker(markers[i])) { seq.markers.deleteMarker(markers[i]); removed++; }
        }
        return acl_toJSON({ removed: removed });
    } catch (e) {
        return acl_error(e);
    }
}

// Enregistre le projet (dans son fichier habituel) pour que la sauvegarde copiée par le panneau soit à jour
function acl_saveProject() {
    try {
        if (!app.project || !app.project.path) return acl_error(acl_msg('saveFirst'));
        app.project.save();
        return acl_toJSON({ path: app.project.path, name: app.project.name });
    } catch (e) {
        return acl_error(e);
    }
}

function acl_projectPath() {
    if (!app.project || !app.project.path) return acl_error(acl_msg('notSaved'));
    return acl_toJSON({ path: app.project.path });
}

function acl_goto(seconds) {
    var seq = app.project.activeSequence;
    if (!seq) return acl_error(acl_msg('noSequence'));
    seq.setPlayerPosition(String(Math.round(seconds * TICKS_PER_SECOND)));
    return acl_toJSON({ ok: true });
}

function acl_unlockedTracks(seq) {
    var list = [], i;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
        if (!seq.videoTracks[i].isLocked()) list.push({ kind: 'video', index: i });
    }
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
        if (!seq.audioTracks[i].isLocked()) list.push({ kind: 'audio', index: i });
    }
    return list;
}

// Les objets clip de l'API ne se mettent pas à jour quand Premiere déplace un clip lié avec son partenaire :
// on repasse toujours par la séquence pour lire une position à jour.
function acl_track(seq, ref) {
    return ref.kind === 'video' ? seq.videoTracks[ref.index] : seq.audioTracks[ref.index];
}

function acl_freshClip(seq, c) {
    return acl_track(seq, c.ref).clips[c.index];
}

// Tous les clips des pistes déverrouillées (piste + rang dans la piste + position actuelle), triés par début
function acl_collectClips(seq, tracks) {
    var list = [];
    for (var k = 0; k < tracks.length; k++) {
        var clips = acl_track(seq, tracks[k]).clips;
        for (var c = 0; c < clips.numItems; c++) {
            var clip = clips[c];
            list.push({ ref: tracks[k], index: c, item: clip, start: clip.start.seconds, end: clip.end.seconds });
        }
    }
    list.sort(function (a, b) { return a.start - b.start; });
    return list;
}

// Nombre de clips qui en chevauchent un autre sur la même piste (relu à neuf) : doit toujours valoir 0
function acl_countOverlaps(seq, tracks, eps) {
    var overlaps = 0;
    for (var k = 0; k < tracks.length; k++) {
        var clips = acl_track(seq, tracks[k]).clips, spans = [];
        for (var c = 0; c < clips.numItems; c++) spans.push([clips[c].start.seconds, clips[c].end.seconds]);
        spans.sort(function (a, b) { return a[0] - b[0]; });
        for (var i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1] - eps) overlaps++;
    }
    return overlaps;
}

function acl_razorAll(seq, tracks, times) {
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var settings = seq.getSettings();
    var zero = Number(seq.zeroPoint) / TICKS_PER_SECOND;
    for (var t = 0; t < times.length; t++) {
        var time = new Time();
        time.seconds = times[t] + zero;
        var tc = time.getFormatted(settings.videoFrameRate, settings.videoDisplayFormat);
        for (var k = 0; k < tracks.length; k++) {
            var qeTrack = tracks[k].kind === 'video'
                ? qeSeq.getVideoTrackAt(tracks[k].index)
                : qeSeq.getAudioTrackAt(tracks[k].index);
            qeTrack.razor(tc);
        }
    }
}

// Nombre d'intervalles (triés) dont le début est <= t
function acl_countStartingBefore(intervals, t) {
    var lo = 0, hi = intervals.length;
    while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (intervals[mid][0] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
}

// Nombre de trous (triés) entièrement terminés à l'instant t
function acl_countEndedBefore(holes, t) {
    var lo = 0, hi = holes.length;
    while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (holes[mid][1] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
}

function acl_cumulative(holes) {
    var cumul = [0];
    for (var h = 0; h < holes.length; h++) cumul.push(cumul[h] + holes[h][1] - holes[h][0]);
    return cumul;
}

// Position d'un instant une fois les trous retirés (un instant tombé dans un trou va au point de recollage)
function acl_mapTime(holes, cumul, t) {
    var n = acl_countEndedBefore(holes, t);
    if (n < holes.length && holes[n][0] < t) return holes[n][0] - cumul[n];
    return t - cumul[n];
}

// Recule chaque clip de la durée cumulée des « trous » (triés, sans chevauchement) situés avant lui.
// Ordre chronologique sur toutes les pistes à la fois : la place visée est toujours déjà libérée.
function acl_shiftClips(seq, clips, holes, eps) {
    var cumul = acl_cumulative(holes);
    var moved = 0;
    for (var i = 0; i < clips.length; i++) {
        var shift = cumul[acl_countEndedBefore(holes, clips[i].start + eps)];
        if (shift <= 0) continue;
        // un clip lié a pu être déplacé avec son partenaire : on relit sa position à neuf
        // et on ne bouge que la différence restante (jamais deux fois)
        var item = acl_freshClip(seq, clips[i]);
        var delta = (clips[i].start - shift) - item.start.seconds;
        if (Math.abs(delta) < eps) continue;
        var offset = new Time();
        offset.seconds = delta;
        item.move(offset);
        moved++;
    }
    return moved;
}

// Les marqueurs de séquence ne suivent pas les clips dans Premiere : on les recale nous-mêmes
function acl_shiftMarkers(seq, holes) {
    var cumul = acl_cumulative(holes);
    var markers = acl_markers(seq);
    for (var i = 0; i < markers.length; i++) {
        var s = markers[i].start.seconds, e = markers[i].end.seconds;
        var ns = acl_mapTime(holes, cumul, s), ne = acl_mapTime(holes, cumul, e);
        if (Math.abs(ns - s) < 1e-6 && Math.abs(ne - e) < 1e-6) continue;
        acl_setMarkerTime(markers[i], 'start', ns); // on recule : le début d'abord, la fin reste après
        acl_setMarkerTime(markers[i], 'end', Math.max(ns, ne));
    }
}

// Vides de la timeline (aucun clip sur aucune piste donnée), depuis le début de la séquence
function acl_holes(clips, eps) {
    var holes = [], cursor = 0;
    for (var i = 0; i < clips.length; i++) {
        if (clips[i].start > cursor + eps) holes.push([cursor, clips[i].start]);
        if (clips[i].end > cursor) cursor = clips[i].end;
    }
    return holes;
}

// Coupe les intervalles (triés) sur toutes les pistes déverrouillées ; si ripple, resserre clips et marqueurs.
// Renvoie { removed, overlaps, holes } ou { razorMiss, wanted, found } si les coups de ciseaux ne sont pas
// tombés au bon endroit (dans ce cas rien n'est supprimé ni déplacé).
function acl_cutIntervals(seq, intervals, ripple) {
    var frame = acl_frameDuration(seq);
    var eps = frame / 2;
    var tracks = acl_unlockedTracks(seq);
    var i, k, times = [];
    for (i = 0; i < intervals.length; i++) times.push(intervals[i][0], intervals[i][1]);
    acl_razorAll(seq, tracks, times);

    // 1. Contrôle des ciseaux : à chaque instant demandé, aucun clip ne doit encore « traverser » la coupe
    //    (tolérance d'une image). Sinon on s'arrête avant de supprimer quoi que ce soit.
    //    Un seul passage : les instants et les clips sont triés ; on garde le clip commencé qui finit le plus tard.
    var clips = acl_collectClips(seq, tracks);
    var longest = null;
    for (i = 0, k = 0; i < times.length; i++) {
        while (k < clips.length && clips[k].start < times[i] - frame) {
            if (!longest || clips[k].end > longest.end) longest = clips[k];
            k++;
        }
        if (longest && longest.end > times[i] + frame) {
            // le bord de clip le plus proche montre où Premiere a réellement coupé
            var found = longest.end;
            for (var j = k; j < clips.length && clips[j].start < times[i] + 10; j++) {
                if (Math.abs(clips[j].start - times[i]) < Math.abs(found - times[i])) found = clips[j].start;
            }
            return { removed: 0, overlaps: 0, razorMiss: true, wanted: times[i], found: found };
        }
    }

    // 2. Supprime les morceaux dont le milieu tombe dans un intervalle (indépendant d'un léger décalage des ciseaux)
    var removed = 0;
    for (i = 0; i < clips.length; i++) {
        var mid = (clips[i].start + clips[i].end) / 2;
        var n = acl_countStartingBefore(intervals, mid);
        if (n === 0 || mid >= intervals[n - 1][1]) continue;
        try { clips[i].item.remove(false, false); removed++; } catch (e) {} // déjà supprimé via un lien
    }

    // 3. Resserre sur les vides réellement laissés (et seulement ceux qui touchent une coupe)
    var holes = [];
    if (ripple) {
        var fresh = acl_collectClips(seq, tracks);
        var all = acl_holes(fresh, eps);
        for (i = 0; i < all.length; i++) {
            var m = acl_countStartingBefore(intervals, all[i][1]);
            if (m > 0 && intervals[m - 1][1] > all[i][0]) holes.push(all[i]);
        }
        acl_shiftClips(seq, fresh, holes, eps);
        acl_shiftMarkers(seq, holes);
    }
    return { removed: removed, overlaps: acl_countOverlaps(seq, tracks, eps), holes: holes };
}

// payload = { intervals: [[debut, fin], ...] triés, mode: 'ripple' | 'gaps' | 'markers', zone: [debut, fin] (optionnel),
//            zoneName, zoneComment } (nom et commentaire du marqueur vert, dans la langue du panneau)
// Le panneau envoie une zone d'1 h max par appel, de la fin vers le début. La zone traitée est marquée en vert
// (« ✂ Rushlight : zone coupée ») pour ne jamais être recoupée ; ce marqueur suit les coupes suivantes.
function acl_apply(payload) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var intervals = payload.intervals;
        var i;

        if (payload.mode === 'markers') {
            for (i = 0; i < intervals.length; i++) acl_createMarker(seq, intervals[i][0], intervals[i][1], 'Silence', '', 1);
            return acl_toJSON({ markers: intervals.length });
        }

        // timeline déjà abîmée (clips empilés, ex. coupe faite avec la v0.6.0) : on ne touche à rien
        var before = acl_countOverlaps(seq, acl_unlockedTracks(seq), acl_frameDuration(seq) / 2);
        if (before) return acl_toJSON({ removed: 0, overlaps: before, alreadyBroken: true });

        var ripple = payload.mode === 'ripple';
        var res = intervals.length ? acl_cutIntervals(seq, intervals, ripple) : { removed: 0, overlaps: 0, holes: [] };
        // ciseaux mal placés ou timeline abîmée : on ne marque pas la zone comme faite, le panneau arrête tout
        if (res.razorMiss) return acl_toJSON(res);
        if (res.overlaps) return acl_toJSON({ removed: res.removed, overlaps: res.overlaps });
        if (payload.zone) {
            var zs = payload.zone[0], ze = payload.zone[1];
            if (ripple && res.holes.length) {
                var cumul = acl_cumulative(res.holes);
                zs = acl_mapTime(res.holes, cumul, zs);
                ze = acl_mapTime(res.holes, cumul, ze);
            }
            acl_createMarker(seq, zs, ze, payload.zoneName, payload.zoneComment, 0);
        }
        return acl_toJSON({ removed: res.removed, rippled: ripple, overlaps: 0 });
    } catch (e) {
        return acl_error(e + (e.line ? ' (ligne ' + e.line + ')' : ''));
    }
}

// Marque comme déjà coupé ce qui est entre les points d'entrée et de sortie de la séquence
// (sans points posés, Premiere renvoie le début et la fin : toute la séquence est marquée)
function acl_markProcessed(payload) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var end = Number(seq.end) / TICKS_PER_SECOND;
        var s = parseFloat(seq.getInPoint()), e = parseFloat(seq.getOutPoint());
        if (!(s >= 0)) s = 0;
        if (!(e > s) || e > end) e = end;
        acl_createMarker(seq, s, e, payload.name, payload.comment, 0);
        return acl_toJSON({ start: s, end: e });
    } catch (e2) {
        return acl_error(e2);
    }
}

// Les coups de ciseaux donnés piste par piste laissent des morceaux image et son séparés : on relie chaque
// morceau vidéo aux morceaux audio du même fichier placés exactement au même endroit (comme « Lier » dans Premiere).
function acl_relinkSequence(seq) {
    if (typeof seq.linkSelection !== 'function') return { linked: 0, unsupported: true };
    var frame = acl_frameDuration(seq);
    var tracks = acl_unlockedTracks(seq);
    var clips = acl_collectClips(seq, tracks);
    var groups = {}, order = [], i;
    for (i = 0; i < clips.length; i++) {
        var path = '';
        try { path = clips[i].item.projectItem.getMediaPath(); } catch (e) {}
        if (!path) continue;
        var key = path + '|' + Math.round(clips[i].start / frame) + '|' + Math.round(clips[i].end / frame);
        if (!groups[key]) { groups[key] = { video: 0, audio: 0, items: [] }; order.push(key); }
        groups[key][clips[i].ref.kind]++;
        groups[key].items.push(clips[i].item);
    }

    // on part d'une sélection vide pour ne lier que ce qu'on choisit
    var selected = seq.getSelection();
    for (i = 0; i < selected.length; i++) selected[i].setSelected(false, false);

    var linked = 0;
    for (var g = 0; g < order.length; g++) {
        var group = groups[order[g]];
        if (!group.video || !group.audio) continue;
        for (i = 0; i < group.items.length; i++) group.items[i].setSelected(true, false);
        seq.linkSelection();
        for (i = 0; i < group.items.length; i++) group.items[i].setSelected(false, false);
        linked++;
    }
    return { linked: linked };
}

function acl_relink() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        return acl_toJSON(acl_relinkSequence(seq));
    } catch (e) {
        return acl_error(e + (e.line ? ' (ligne ' + e.line + ')' : ''));
    }
}

// Supprime tous les vides de la timeline (là où aucune piste déverrouillée n'a de clip), début compris
function acl_closeGaps() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var eps = acl_frameDuration(seq) / 2;
        var tracks = acl_unlockedTracks(seq);
        // timeline déjà abîmée (clips empilés) : on ne touche à rien
        var before = acl_countOverlaps(seq, tracks, eps);
        if (before) return acl_toJSON({ gaps: 0, seconds: 0, overlaps: before, alreadyBroken: true });
        var clips = acl_collectClips(seq, tracks);
        var holes = acl_holes(clips, eps), total = 0;
        for (var i = 0; i < holes.length; i++) total += holes[i][1] - holes[i][0];
        acl_shiftClips(seq, clips, holes, eps);
        acl_shiftMarkers(seq, holes);
        return acl_toJSON({ gaps: holes.length, seconds: total, overlaps: acl_countOverlaps(seq, tracks, eps) });
    } catch (e) {
        return acl_error(e + (e.line ? ' (ligne ' + e.line + ')' : ''));
    }
}

// payload = { ranges: [[debut, fin], ...] triés, prefix } : copie la séquence active et ne garde que ces passages, bout à bout.
// La séquence d'origine n'est pas modifiée ; la copie devient la séquence active.
function acl_createBestOf(payload) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return acl_error(acl_msg('noSequence'));
        var known = {}, i;
        for (i = 0; i < app.project.sequences.numSequences; i++) known[app.project.sequences[i].sequenceID] = true;
        seq.clone();
        var copy = null;
        for (i = 0; i < app.project.sequences.numSequences; i++) {
            if (!known[app.project.sequences[i].sequenceID]) copy = app.project.sequences[i];
        }
        if (!copy) return acl_error(acl_msg('copyFailed'));
        copy.name = payload.prefix + seq.name;
        app.project.openSequence(copy.sequenceID);
        copy = app.project.activeSequence;

        // la copie reprend tous les marqueurs de l'original (zones coupées, moments forts, silences…) : inutiles
        // dans un best of, on les retire. Double vérification que c'est bien la copie, jamais l'original.
        if (copy.sequenceID !== seq.sequenceID) {
            var copyMarkers = acl_markers(copy);
            for (i = 0; i < copyMarkers.length; i++) copy.markers.deleteMarker(copyMarkers[i]);
        }

        // tout ce qui n'est pas un moment fort est retiré
        var ranges = payload.ranges, holes = [], cursor = 0;
        var end = Number(copy.end) / TICKS_PER_SECOND;
        for (i = 0; i < ranges.length; i++) {
            if (ranges[i][0] > cursor) holes.push([cursor, ranges[i][0]]);
            cursor = Math.max(cursor, ranges[i][1]);
        }
        if (end > cursor) holes.push([cursor, end]);
        var res = acl_cutIntervals(copy, holes, true);
        if (!res.razorMiss && !res.overlaps) { try { acl_relinkSequence(copy); } catch (e) {} }
        return acl_toJSON({ name: copy.name, seconds: Number(copy.end) / TICKS_PER_SECOND, overlaps: res.overlaps,
            razorMiss: res.razorMiss, wanted: res.wanted, found: res.found });
    } catch (e) {
        return acl_error(e + (e.line ? ' (ligne ' + e.line + ')' : ''));
    }
}
