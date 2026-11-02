'use strict';
/* Hantelbuch – Trainings-App für Manu & Rob.
   Alles, was passiert (Training, Skip, Planänderung, Tausch, Körpergewicht, Profilbild), wird als Eintrag in einem Log gespeichert:
   zuerst auf dem Handy, beim Sync in der Google-Tabelle. Der aktuelle Stand wird immer aus dem Log berechnet.
   Ausnahme: der Vault. Seine Bilder bleiben verschlüsselt nur auf diesem Handy und werden nie synchronisiert. */

const APP_VERSION = '1.3.3';
const SCRIPT_MIN = 2;            // benötigte Version des Google-Skripts
const PEOPLE = ['Manu', 'Rob'];
const DAYS = ['A', 'B', 'C'];    // interne Kennung der Trainingstage, angezeigt werden die Kürzel
const DAY_SHORT = { A: 'B&T', B: 'R&B', C: 'B&B' };
const DAY_TONE = { A: 'y', B: 'm', C: 'c' };   // Gelb, Magenta, Cyan
const TYPE_LABEL = { kg: 'Gewicht', bw: 'Körpergewicht', time: 'Zeit' };
const WARMUP_DEFAULT = new Set(['bankdruecken', 'lh-rudern', 'kniebeugen', 'rdl']);
const WARMUP = [0.6, 6];         // ein Aufwärmsatz: 60 % × 6
const FEEL = { leicht: 'Leicht', passt: 'Passt', schwer: 'Schwer' };
const DELOAD_WEEKS = 8;
const DELOAD_WEEKS_PLATEAU = 4;

function ex(id, name, type, sets, min, max, step, cue) {
  return { id, name, type, sets, min, max, step, cue, video: '', image: '', warmup: WARMUP_DEFAULT.has(id), personal: false };
}
const DEFAULT_PLAN = {
  A: { title: 'Brust & Trizeps', short: 'B&T', exercises: [
    ex('bankdruecken', 'Bankdrücken (Langhantel)', 'kg', 4, 6, 8, 2.5, 'Schulterblätter zusammen, Füße fest am Boden, Stange zur unteren Brust führen, Ellbogen ca. 45° vom Körper.'),
    ex('schraegbank', 'Schrägbankdrücken (Kurzhantel, 30°)', 'kg', 3, 8, 12, 2, 'Hanteln tief absenken, oben nicht zusammenschlagen.'),
    ex('dips', 'Dips (Brust-Fokus)', 'bw', 3, 8, 12, 2.5, 'Oberkörper leicht nach vorn, absenken bis der Oberarm parallel zum Boden ist.'),
    ex('kabelflys', 'Kabelzug-Flys', 'kg', 3, 12, 15, 1.25, 'Leicht gebeugte Arme, Hände vor der Brust zusammenführen, 1 Sek. halten.'),
    ex('ueberkopf-trizeps', 'Überkopf-Trizepsstrecken am Kabel', 'kg', 3, 10, 12, 1.25, 'Ellbogen eng und fix, volle Dehnung hinter dem Kopf.'),
    ex('trizeps-seil', 'Trizepsdrücken am Kabel (Seil)', 'kg', 3, 12, 15, 1.25, 'Oberarme am Körper, unten das Seil auseinanderziehen.')
  ] },
  B: { title: 'Rücken & Bizeps', short: 'R&B', exercises: [
    ex('klimmzuege', 'Klimmzüge', 'bw', 4, 6, 10, 2.5, 'Schulterblätter zuerst nach unten ziehen, Brust zur Stange, unten ganz ausstrecken. Mit Unterstützung: Gewicht negativ eintragen.'),
    ex('lh-rudern', 'Langhantelrudern vorgebeugt', 'kg', 4, 6, 8, 2.5, 'Rücken gerade, Oberkörper ca. 45°, Stange zum Bauchnabel ziehen.'),
    ex('kabelrudern', 'Kabelrudern sitzend (enger Griff)', 'kg', 3, 10, 12, 2.5, 'Brust raus, Ellbogen eng nach hinten, vorne kontrolliert dehnen.'),
    ex('facepulls', 'Face Pulls am Kabel', 'kg', 3, 12, 15, 1.25, 'Seil auf Augenhöhe, Hände neben die Ohren ziehen, Schultern nach außen drehen.'),
    ex('sz-curls', 'Langhantel-Curls (SZ-Stange)', 'kg', 3, 8, 12, 2.5, 'Ellbogen am Körper, kein Schwung aus dem Rücken.'),
    ex('hammer-curls', 'Hammer-Curls (Kurzhantel)', 'kg', 3, 10, 12, 2, 'Neutraler Griff, langsam absenken.')
  ] },
  C: { title: 'Beine & Bauch', short: 'B&B', exercises: [
    ex('kniebeugen', 'Kniebeugen (Langhantel)', 'kg', 4, 6, 8, 2.5, 'Füße schulterbreit, Knie über den Zehen, mindestens bis Oberschenkel parallel, Rücken neutral.'),
    ex('rdl', 'Rumänisches Kreuzheben', 'kg', 3, 8, 10, 2.5, 'Knie leicht gebeugt, Hüfte nach hinten schieben, Stange nah am Bein, Dehnung im Beinbizeps.'),
    ex('beinpresse', 'Beinpresse', 'kg', 3, 10, 12, 5, 'Unterer Rücken bleibt am Polster, Knie oben nicht ganz durchstrecken.'),
    ex('beinbeuger', 'Beinbeuger', 'kg', 3, 10, 12, 2.5, 'Hüfte fest aufs Polster, langsam zurückführen.'),
    ex('wadenheben', 'Wadenheben stehend', 'kg', 3, 12, 15, 2.5, 'Unten voll dehnen, oben 1 Sek. halten.'),
    ex('beinheben', 'Hängendes Beinheben', 'bw', 3, 10, 15, 0, 'Becken einrollen statt nur die Beine zu schwingen. Alternative: Kabel-Crunch.'),
    ex('plank', 'Plank', 'time', 3, 30, 60, 0, 'Körper in einer Linie, Bauch und Po anspannen.')
  ] }
};

/* ---------- Hilfsfunktionen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const int = v => { const n = parseInt(String(v ?? ''), 10); return isFinite(n) && n > 0 ? n : 0; };
const fmtN = n => (Math.round(n * 100) / 100).toLocaleString('de-DE');
const fmtIn = n => (n == null || n === '' ? '' : String(Math.round(Math.abs(n) * 100) / 100).replace('.', ','));
const fmtSigned = w => (w > 0 ? '+' : w < 0 ? '−' : '') + fmtN(Math.abs(w)) + ' kg';
const fmtDate = iso => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtLong = iso => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gen = p => (/s$/.test(p) ? p + "'" : p + 's');
const partner = () => PEOPLE.find(p => p !== cfg.me);
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => (a.length ? sum(a) / a.length : 0);
const roundTo = (v, step) => { const s = step > 0 ? step : 2.5; return Math.round(Math.round(v / s) * s * 100) / 100; };
const stepOf = x => (x.step > 0 ? x.step : 2.5);
const videoUrl = x => x.video || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(x.name + ' richtige Ausführung');
const pad2 = n => String(n).padStart(2, '0');
const dateKey = v => { const d = new Date(v); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const todayStr = () => dateKey(new Date());
const weekKey = v => { const d = new Date(v); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7)); };
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'uebung';
function relDay(iso) {
  const d = new Date(iso), t = new Date();
  const n = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return n <= 0 ? 'heute' : n === 1 ? 'gestern' : n < 7 ? `vor ${n} Tagen` : fmtDate(iso);
}
function duration(a, b) { const m = Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
function weekStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7); }

// Tageskürzel (z. B. B&T) und Tagesfarbe
const dl = (d, p) => { const pl = st().plans[p || cfg.me][d]; return (pl && pl.short) || DAY_SHORT[d]; };
const dayChip = (d, p, extra = '') => `<span class="day t-${DAY_TONE[d]} ${extra}">${esc(dl(d, p))}</span>`;
// Avatar: Profilbild oder Glas mit weißem Buchstaben
function avatar(p, size = 32) {
  const img = st().avatars[p];
  const st_ = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  return img ? `<img class="av" src="${esc(img)}" alt="${esc(p)}" style="${st_}">` : `<span class="av" style="${st_}" aria-hidden="true">${esc(p[0])}</span>`;
}

const ICON = {
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  swap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>',
  sync: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  cam: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2.5 2.5"/></svg>',
  del: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/><path d="m16 9-5 6M11 9l5 6"/></svg>'
};

/* ---------- Lokaler Speicher ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('hb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hb.' + k, JSON.stringify(v)); } catch (e) { toast('Speichern auf dem Handy fehlgeschlagen. Ist der Speicher voll?'); } }
};
let cfg = LS.get('cfg', { me: null, url: '', key: '' });
let events = LS.get('events', []);
let pending = LS.get('pending', []);
let lastSeq = LS.get('lastSeq', 0);
let lastSync = LS.get('lastSync', null);
let scriptVersion = LS.get('scriptVersion', null);
let draft = LS.get('draft', null);   // laufendes Training (wird unten beim Start bereinigt)
let seenIds = new Set(events.map(e => e.id));

function saveLog() { LS.set('events', events); LS.set('pending', pending); LS.set('lastSeq', lastSeq); }
function saveDraft() { LS.set('draft', draft); }
function addEvent(type, data, summary) {
  const e = { id: uid(), ts: new Date().toISOString(), person: cfg.me, type, data, summary };
  pending.push(e); saveLog(); invalidate();
  sync({ quiet: true });
  return e;
}

/* ---------- Daten aus der Tabelle immer bereinigen ---------- */
const safeUrl = v => (/^https?:\/\//i.test(String(v || '').trim()) ? String(v).trim() : '');
const str = (v, n = 500) => String(v ?? '').slice(0, n);
function cleanEx(x) {
  x = x || {};
  const type = TYPE_LABEL[x.type] ? x.type : 'kg';
  const min = int(x.min) || 1;
  const id = str(x.id, 64) || 'x-' + uid().slice(0, 8);
  const o = {
    id, name: str(x.name, 80) || 'Übung', type, sets: Math.min(10, int(x.sets) || 3), min, max: Math.max(min, int(x.max) || min),
    step: type === 'time' ? 0 : Math.max(0, num(x.step)), cue: str(x.cue), video: safeUrl(x.video), image: safeUrl(x.image),
    warmup: type === 'kg' && (x.warmup === undefined ? WARMUP_DEFAULT.has(id) : !!x.warmup), personal: !!x.personal
  };
  if (x.replaces) o.replaces = str(x.replaces, 64);
  return o;
}
function cleanPlan(p, day) {
  return { title: str(p && p.title, 40) || DEFAULT_PLAN[day].title, short: str(p && p.short, 6).trim() || DAY_SHORT[day],
    exercises: (Array.isArray(p && p.exercises) ? p.exercises : []).slice(0, 25).map(cleanEx) };
}
function cleanEntry(en) {
  en = en || {};
  const type = TYPE_LABEL[en.type] ? en.type : 'kg';
  return {
    exId: str(en.exId, 64), name: str(en.name, 80), type, note: str(en.note, 1000), feel: FEEL[en.feel] ? en.feel : '',
    sets: (Array.isArray(en.sets) ? en.sets : []).slice(0, 20).map(s => type === 'time' ? { r: int(s && s.r) } : { w: num(s && s.w), r: int(s && s.r) })
  };
}
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/* ---------- Zustand aus dem Log berechnen ---------- */
let _st = null;
function invalidate() { _st = null; }
function st() { return _st || (_st = buildState()); }

function buildState() {
  const all = events.slice().sort((a, b) => a.seq - b.seq)
    .concat(pending.filter(p => !seenIds.has(p.id)).sort((a, b) => a.ts.localeCompare(b.ts)));
  const s = { plans: {}, last: {}, workouts: [], skips: [], swaps: [], feed: [], changes: {}, lastChange: {}, lastShared: {}, decisions: {}, lastAction: {}, hist: {}, exInfo: {}, bw: {}, avatars: {}, first: {} };
  _st = s; // für dl() während des Aufbaus
  // Nachträgliche Änderungen an abgeschlossenen Trainings: es gilt die jeweils letzte, nur von derselben Person
  const edits = {};
  all.forEach(e => { if (e.type === 'workout_edit' && e.data && typeof e.data.ref === 'string') edits[e.data.ref] = e; });
  PEOPLE.forEach(p => { s.plans[p] = clone(DEFAULT_PLAN); s.hist[p] = {}; s.last[p] = null; s.bw[p] = []; });
  DAYS.forEach(d => DEFAULT_PLAN[d].exercises.forEach(x => { s.exInfo[x.id] = { name: x.name, type: x.type }; }));
  all.forEach((e, k) => {
    if (!PEOPLE.includes(e.person) || !e.id || !e.ts) return;
    const ed = e.type === 'workout' ? edits[e.id] : null;
    if (ed && ed.person === e.person) {
      if (ed.data.deleted) return;
      e = { ...e, data: { ...(e.data || {}), entries: ed.data.entries, edited: ed.ts } };
    }
    const d = e.data || {}; e.k = k;
    if (!s.first[e.person]) s.first[e.person] = e.ts;
    if (e.type === 'workout') {
      if (!DAYS.includes(d.day)) return;
      d.title = str(d.title, 40); d.entries = (Array.isArray(d.entries) ? d.entries : []).map(cleanEntry);
      d.deload = !!d.deload; d.deloadSkipped = !!d.deloadSkipped;
      if (isNaN(new Date(d.start))) d.start = e.ts;
      if (isNaN(new Date(d.end))) d.end = e.ts;
      s.workouts.push(e); s.last[e.person] = { day: d.day, ts: e.ts, kind: 'workout' };
      d.entries.forEach(en => {
        (s.hist[e.person][en.exId] = s.hist[e.person][en.exId] || []).push({ ts: e.ts, wid: e.id, sets: en.sets, note: en.note, feel: en.feel, type: en.type, name: en.name, day: d.day, person: e.person, deload: d.deload });
        s.exInfo[en.exId] = { name: en.name, type: en.type };
      });
      s.feed.push(e);
    } else if (e.type === 'skip') {
      if (!DAYS.includes(d.day)) return;
      s.last[e.person] = { day: d.day, ts: e.ts, kind: 'skip' }; s.skips.push(e); s.feed.push(e);
    } else if (e.type === 'plan_change') {
      if (!DAYS.includes(d.day)) return;
      const p = cleanPlan(d, d.day); d.title = p.title; d.short = p.short; d.exercises = p.exercises;
      if (sharedDiff(s.plans[e.person][d.day], p).length) s.lastShared[e.person + '|' + d.day] = e;
      s.plans[e.person][d.day] = clone(p);
      p.exercises.forEach(x => { s.exInfo[x.id] = s.exInfo[x.id] || { name: x.name, type: x.type }; s.exInfo[x.id].name = x.name; });
      s.changes[e.id] = e; s.lastChange[e.person + '|' + d.day] = e; s.lastAction[e.person + '|' + d.day] = k;
    } else if (e.type === 'plan_decision') {
      const ch = s.changes[d.changeId];
      const decision = d.decision === 'accepted' ? 'accepted' : 'dismissed';
      s.decisions[e.person + '|' + d.changeId] = { decision, k };
      if (ch && decision === 'accepted') {
        s.plans[e.person][ch.data.day] = d.result && Array.isArray(d.result.exercises) ? cleanPlan(d.result, ch.data.day) : cleanPlan(ch.data, ch.data.day);
        s.lastAction[e.person + '|' + ch.data.day] = k;
      }
    } else if (e.type === 'swap') {
      if (!DAYS.includes(d.day) || !d.to) return;
      d.to = cleanEx(d.to); d.fromId = str(d.fromId, 64); d.fromName = str(d.fromName, 80); d.date = str(d.date, 10);
      s.exInfo[d.to.id] = s.exInfo[d.to.id] || { name: d.to.name, type: d.to.type };
      s.swaps.push(e); s.feed.push(e);
    } else if (e.type === 'bodyweight') {
      const kg = num(d.kg); if (kg >= 30 && kg <= 300) s.bw[e.person].push({ ts: e.ts, kg });
    } else if (e.type === 'avatar') {
      if (d.img === '') delete s.avatars[e.person];
      else if (typeof d.img === 'string' && d.img.length < 60000 && AVATAR_RE.test(d.img)) s.avatars[e.person] = d.img;
    }
  });
  s.feed.reverse();
  return s;
}

function nextDay(p) { const l = st().last[p]; return l ? DAYS[(DAYS.indexOf(l.day) + 1) % 3] : 'A'; }
function isPending(id) { return !seenIds.has(id) && pending.some(p => p.id === id); }

/* ---------- Kennzahlen ---------- */
function workW(sets) { const v = sets.filter(s => int(s.r) > 0).map(s => num(s.w)); return v.length ? Math.max(...v) : 0; }
function score(type, sets) {
  if (type === 'time') return Math.max(0, ...sets.map(s => int(s.r)));
  const w = workW(sets);
  return w * 1000 + sum(sets.filter(s => num(s.w) === w).map(s => int(s.r)));
}
const usesWeight = (type, sets) => type === 'kg' || (type === 'bw' && sets.some(s => num(s.w) !== 0));
function metricLabel(type, sets) {
  if (!sets || !sets.length) return '–';
  if (type === 'kg') return fmtN(workW(sets)) + ' kg';
  if (type === 'time') return Math.max(...sets.map(s => int(s.r))) + ' s';
  const reps = sum(sets.map(s => int(s.r))); const w = workW(sets);
  return reps + ' Wdh.' + (w ? ' · ' + fmtSigned(w) : '');
}
function fmtSets(type, sets) {
  if (!sets || !sets.length) return '–';
  if (type === 'kg') return sets.map(s => `${fmtN(num(s.w))}×${int(s.r)}`).join(' · ');
  if (type === 'time') return sets.map(s => int(s.r)).join(' · ') + ' s';
  if (sets.some(s => num(s.w) !== 0)) return sets.map(s => `${int(s.r)}${num(s.w) ? ` (${fmtSigned(num(s.w))})` : ''}`).join(' · ');
  return sets.map(s => int(s.r)).join(' · ') + ' Wdh.';
}
const normalSessions = (p, id, type) => (st().hist[p][id] || []).filter(h => !h.deload && (!type || h.type === type));
const lastAny = (p, id) => { const h = st().hist[p][id]; return h && h.length ? h[h.length - 1] : null; };

function improvements(e) {
  if (e.data.deload) return [];
  const out = [];
  (e.data.entries || []).forEach(en => {
    const h = normalSessions(e.person, en.exId, en.type);
    const i = h.findIndex(x => x.wid === e.id);
    if (i <= 0 || !en.sets.length) return;
    const prev = h.slice(0, i), last = prev[prev.length - 1];
    const cur = score(en.type, en.sets), best = Math.max(...prev.map(x => score(x.type, x.sets)));
    if (cur <= score(last.type, last.sets)) return;
    let label;
    if (en.type === 'time') label = `+${Math.max(...en.sets.map(s => s.r)) - Math.max(...last.sets.map(s => s.r))} s`;
    else {
      const dW = Math.round((workW(en.sets) - workW(last.sets)) * 100) / 100;
      if (dW > 0) label = `+${fmtN(dW)} kg`;
      else { const dr = sum(en.sets.map(s => s.r)) - sum(last.sets.map(s => s.r)); label = dr > 0 ? `+${dr} Wdh.` : 'mehr geschafft'; }
    }
    out.push({ name: en.name, exId: en.exId, label, pr: cur > best });
  });
  return out;
}

/* ---------- Steigerung (doppelte Progression, erweitert) ---------- */
function isPlateau(h) {
  if (h.length < 4) return false;
  const before = Math.max(...h.slice(0, -3).map(x => score(x.type, x.sets)));
  return h.slice(-3).every(x => score(x.type, x.sets) <= before);
}
function progression(x, p = cfg.me) {
  const h = normalSessions(p, x.id, x.type);
  if (!h.length) return { w: null, base: null, kind: 'new', hint: '' };
  const last = h[h.length - 1], sets = last.sets;
  if (x.type === 'time') {
    const best = Math.max(...sets.map(s => int(s.r)));
    return { w: null, base: null, kind: 'hold', hint: best >= x.max ? `Letztes Mal ${best} s. Zeit für eine schwerere Variante oder eine längere Spanne.` : `Ziel: länger als ${best} s` };
  }
  const W = workW(sets), step = x.step > 0 ? x.step : 0;
  const reps = sets.map(s => int(s.r));
  const full = sets.length >= x.sets;
  const allTop = full && reps.every(r => r >= x.max);
  const allTop2 = full && reps.every(r => r >= x.max + 2);
  const below = avg(reps) < x.min;
  const prevBelow = h.length > 1 && avg(h[h.length - 2].sets.map(s => int(s.r))) < x.min;
  const res = (w, kind, hint) => ({ w, base: W, kind, hint });
  if (below && prevBelow) {
    if (x.type === 'kg' && W > 0) return res(roundTo(W * 0.9, stepOf(x)), 'down', 'Zweimal unter der Spanne. Heute −10 % und neu aufbauen.');
    if (x.type === 'bw' && step) return res(roundTo(W - step, step), 'down', W > 0 ? `Zweimal unter der Spanne. Heute ${fmtN(step)} kg weniger Zusatzgewicht.` : `Zweimal unter der Spanne. Heute ${fmtN(step)} kg mehr Unterstützung.`);
    return res(W, 'hold', 'Zweimal unter der Spanne. Eine leichtere Variante oder eine niedrigere Spanne im Plan kann helfen.');
  }
  if (below) return res(W, 'hold', 'Letztes Mal unter der Spanne. Gewicht halten.');
  if (last.feel === 'schwer') return res(W, 'hold', allTop ? 'Geschafft, aber als schwer bewertet. Gewicht halten.' : '');
  if (step && (allTop2 || (allTop && last.feel === 'leicht'))) return res(roundTo(W + 2 * step, step), 'up', `${allTop2 ? 'Deutlich mehr geschafft' : 'Alle Sätze geschafft und als leicht bewertet'}. Heute +${fmtN(2 * step)} kg.`);
  if (step && allTop) return res(roundTo(W + step, step), 'up', `Alle Sätze mit ${x.max} Wdh. geschafft. Heute +${fmtN(step)} kg.`);
  if (allTop) return res(W, 'hold', 'Alle Sätze am oberen Ende. Zeit für Zusatzgewicht oder eine höhere Spanne im Plan.');
  if (isPlateau(h)) return res(W, 'plateau', 'Seit 3 Einheiten kein Fortschritt.');
  if (x.type === 'bw' && !W) return res(W, 'hold', `Ziel: mehr als ${sum(reps)} Wdh. insgesamt`);
  return res(W, 'hold', '');
}
function plateauCount(p) {
  return DAYS.reduce((a, d) => a + st().plans[p][d].exercises.filter(x => x.type !== 'time' && isPlateau(normalSessions(p, x.id, x.type))).length, 0);
}

/* ---------- Deload (für jede Person getrennt) ---------- */
function deloadState(p) {
  const ws = st().workouts.filter(w => w.person === p);
  let marked = 0, cycleEnd = -1;
  ws.forEach((w, i) => { if (w.data.deload || w.data.deloadSkipped) { marked++; if (marked >= 3) { marked = 0; cycleEnd = i; } } });
  if (marked > 0) return { active: true, part: marked + 1, reason: 'Deload-Woche läuft' };
  const weeks = new Set(ws.slice(cycleEnd + 1).map(w => weekKey(w.ts))).size;
  const plat = plateauCount(p);
  if (weeks >= DELOAD_WEEKS) return { active: true, part: 1, reason: `${weeks} Trainingswochen seit dem letzten Deload` };
  if (weeks >= DELOAD_WEEKS_PLATEAU && plat >= 2) return { active: true, part: 1, reason: `Kein Fortschritt bei ${plat} Übungen` };
  return { active: false, weeks };
}
const deloadW = W => (W > 0 ? W * 0.9 : W < 0 ? W * 1.1 : 0);

/* ---------- Plan-Abgleich ---------- */
const SHARED_FIELDS = ['name', 'type', 'sets', 'min', 'max', 'warmup'];
function fieldChanges(a, b, sharedOnly) {
  const c = [];
  if (a.name !== b.name) c.push('Name');
  if (a.type !== b.type) c.push(`Art ${TYPE_LABEL[a.type]} → ${TYPE_LABEL[b.type]}`);
  if (a.sets !== b.sets) c.push(`Sätze ${a.sets} → ${b.sets}`);
  if (a.min !== b.min || a.max !== b.max) c.push(`${b.type === 'time' ? 'Sek.' : 'Wdh.'} ${a.min}–${a.max} → ${b.min}–${b.max}`);
  if (!!a.warmup !== !!b.warmup) c.push(b.warmup ? 'Aufwärmsatz an' : 'Aufwärmsatz aus');
  if (sharedOnly) return c;
  if (b.type !== 'time' && (a.step || 0) !== (b.step || 0)) c.push(`Steigerung ${fmtN(a.step || 0)} → ${fmtN(b.step || 0)} kg`);
  if ((a.cue || '') !== (b.cue || '')) c.push('Ausführung');
  if ((a.video || '') !== (b.video || '')) c.push('Video');
  if ((a.image || '') !== (b.image || '')) c.push('Bild');
  if (!!a.personal !== !!b.personal) c.push(b.personal ? 'jetzt abweichend (nur ich)' : 'jetzt gemeinsam');
  return c;
}
function diffPlan(from, to, sharedOnly) {
  const out = [];
  if ((from.title || '') !== (to.title || '')) out.push({ k: 'title', a: from.title, b: to.title });
  if ((from.short || '') !== (to.short || '')) out.push({ k: 'short', a: from.short, b: to.short });
  const fm = new Map(from.exercises.map(x => [x.id, x])), tm = new Map(to.exercises.map(x => [x.id, x]));
  to.exercises.forEach(x => {
    if (!fm.has(x.id)) {
      if (x.replaces && fm.has(x.replaces) && !tm.has(x.replaces)) out.push({ k: 'replace', a: fm.get(x.replaces).name, b: x.name });
      else out.push({ k: 'add', b: x.name });
    } else {
      const ch = fieldChanges(fm.get(x.id), x, sharedOnly);
      if (ch.length) out.push({ k: 'edit', b: x.name, ch });
    }
  });
  from.exercises.forEach(x => { if (!tm.has(x.id) && !to.exercises.some(y => y.replaces === x.id && !fm.has(y.id))) out.push({ k: 'remove', a: x.name }); });
  const common = to.exercises.filter(x => fm.has(x.id)).map(x => x.id).join();
  const commonFrom = from.exercises.filter(x => tm.has(x.id)).map(x => x.id).join();
  if (common !== commonFrom) out.push({ k: 'order' });
  return out;
}
function sharedDiff(mine, theirs) {
  const ignore = new Set([...mine.exercises, ...theirs.exercises].filter(x => x.personal).map(x => x.id));
  const f = p => ({ title: p.title, short: p.short, exercises: p.exercises.filter(x => !ignore.has(x.id)) });
  return diffPlan(f(mine), f(theirs), true);
}
function mergePlan(mine, theirs) {
  const tShared = theirs.exercises.filter(x => !x.personal);
  const tSharedIds = new Set(tShared.map(x => x.id));
  const tPersonal = new Set(theirs.exercises.filter(x => x.personal).map(x => x.id));
  const own = new Map(mine.exercises.map(x => [x.id, x]));
  const result = tShared.map(x => {
    const m = own.get(x.id);
    if (!m) { const n = clone(x); delete n.replaces; return n; }
    const n = clone(m); SHARED_FIELDS.forEach(f => { n[f] = x[f]; }); n.personal = false; delete n.replaces;
    if (n.type === 'time') n.step = 0;
    return n;
  });
  mine.exercises.forEach((x, i) => {
    if (tSharedIds.has(x.id) || !(x.personal || tPersonal.has(x.id))) return;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) { const idx = result.findIndex(y => y.id === mine.exercises[j].id); if (idx >= 0) { pos = idx + 1; break; } }
    result.splice(pos, 0, clone(x));
  });
  return { title: theirs.title, short: theirs.short, exercises: result };
}
const DIFF_SIGN = { add: '+', remove: '−', replace: '⇄', edit: '~', order: '↕', title: '~', short: '~' };
function diffText(d) {
  switch (d.k) {
    case 'add': return `Neu: ${d.b}`;
    case 'remove': return `Entfernt: ${d.a}`;
    case 'replace': return `${d.a} ersetzt durch ${d.b}`;
    case 'edit': return `${d.b}: ${(d.ch || []).join(', ')}`;
    case 'order': return 'Reihenfolge geändert';
    case 'title': return `Name des Tages: ${d.a} → ${d.b}`;
    case 'short': return `Kürzel: ${d.a} → ${d.b}`;
  }
  return '';
}
const diffList = list => `<ul class="diff">${list.map(d => `<li><span class="s">${DIFF_SIGN[d.k] || '~'}</span><span>${esc(diffText(d))}</span></li>`).join('')}</ul>`;

function bellItems() {
  const s = st(), me = cfg.me, other = partner(), out = [];
  DAYS.forEach(d => {
    const pc = s.lastShared[other + '|' + d];
    if (!pc) return;
    const diff = sharedDiff(s.plans[me][d], s.plans[other][d]);
    if (!diff.length) return;
    const dec = s.decisions[me + '|' + pc.id];
    const myK = s.lastAction[me + '|' + d] ?? -1;
    const status = !dec && pc.k > myK ? 'open' : dec && dec.decision === 'dismissed' ? 'dismissed' : 'diverged';
    out.push({ day: d, pc, diff, status });
  });
  return out;
}
const openCount = () => (cfg.me ? bellItems().filter(x => x.status === 'open').length : 0);

/* ---------- Synchronisation mit der Google-Tabelle ---------- */
const loader = {
  el: () => $('#loader'),
  show() { const l = this.el(); l.hidden = false; l.className = 'loader busy'; this.set(0, 'Verbinde …', ''); },
  set(p, text, sub) {
    p = Math.max(0, Math.min(100, Math.round(p)));
    $('#ld-bar').style.strokeDashoffset = String(326.73 * (1 - p / 100));
    $('#ld-pct').textContent = p + ' %';
    if (text != null) $('#ld-text').textContent = text;
    if (sub != null) $('#ld-sub').textContent = sub;
  },
  async error(text, sub) { this.el().className = 'loader error'; $('#ld-text').textContent = text; $('#ld-sub').textContent = sub || ''; await sleep(2200); },
  hide() { this.el().hidden = true; }
};
const mini = {
  show() { $('#topbar').hidden = false; this.set(4); },
  set(p) { $('#topbar i').style.width = Math.max(0, Math.min(100, p)) + '%'; },
  async error() {},
  hide() { setTimeout(() => { $('#topbar').hidden = true; this.set(0); }, 300); }
};
let syncing = null, syncError = null;
async function call(body, timeout = 25000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key: cfg.key }), signal: ctrl.signal, redirect: 'follow' });
    let json; try { json = await res.json(); } catch (e) { throw { code: 'bad_response' }; }
    if (!json.ok) throw { code: json.error || 'server' };
    const v = Number(json.version) || 1;
    if (v !== scriptVersion) { scriptVersion = v; LS.set('scriptVersion', v); }
    return json;
  } catch (e) {
    if (e && e.code) throw e;
    throw { code: 'network' };
  } finally { clearTimeout(t); }
}
const SYNC_ERR = {
  unauthorized: ['Sync-Schlüssel stimmt nicht', 'Prüfe den Schlüssel unter Einstellungen.'],
  network: ['Keine Verbindung zur Tabelle', 'Deine Einträge bleiben gespeichert und werden beim nächsten Öffnen gesendet.'],
  offline: ['Offline', 'Deine Einträge bleiben gespeichert und werden beim nächsten Öffnen gesendet.'],
  bad_response: ['Unerwartete Antwort', 'Prüfe die Sync-Adresse unter Einstellungen (endet auf /exec).']
};
function addSynced(ev) {
  if (!ev || !ev.id || seenIds.has(ev.id)) { if (ev && ev.seq > lastSeq) lastSeq = ev.seq; return; }
  if (typeof ev.data === 'string') { try { ev.data = JSON.parse(ev.data); } catch (e) { ev.data = {}; } }
  events.push({ seq: ev.seq, id: ev.id, ts: ev.ts, person: ev.person, type: ev.type, summary: ev.summary, data: ev.data });
  seenIds.add(ev.id);
  if (ev.seq > lastSeq) lastSeq = ev.seq;
}
function sync({ overlay = false, quiet = false } = {}) {
  if (!cfg.url || !cfg.key) return Promise.resolve({ ok: false, code: 'nocfg' });
  if (syncing) return syncing;
  const ui = overlay ? loader : mini;
  syncing = (async () => {
    await Promise.resolve();
    ui.show();
    try {
      if (navigator.onLine === false) throw { code: 'offline' };
      const toPush = pending.filter(p => !seenIds.has(p.id));
      const batches = []; for (let i = 0; i < toPush.length; i += 10) batches.push(toPush.slice(i, i + 10));
      const pushShare = batches.length ? 0.4 : 0;
      let rejected = 0;
      ui.set(4, toPush.length ? `Sende ${toPush.length} ${toPush.length === 1 ? 'Eintrag' : 'Einträge'} …` : 'Prüfe auf Neuigkeiten …', '');
      for (let i = 0; i < batches.length; i++) {
        const r = await call({ action: 'push', events: batches[i].map(e => ({ id: e.id, ts: e.ts, person: e.person, type: e.type, summary: e.summary || '', data: e.data })) });
        rejected += r.rejected || 0;
        ui.set(4 + 92 * pushShare * ((i + 1) / batches.length), null, `${Math.min((i + 1) * 10, toPush.length)} von ${toPush.length} gesendet`);
      }
      // Selbstprüfung: die letzte bekannte Zeile wird mit abgefragt. Passt sie nicht mehr (Zeilen in der Tabelle
      // gelöscht oder verschoben), lädt die App den ganzen Log neu. So bleibt nichts hängen und Löschungen kommen an.
      const lastEv = lastSeq ? events.find(e => e.seq === lastSeq) : null;
      let check = lastEv ? lastEv.id : null;
      let start = lastSeq, guard = 0;
      for (let pass = 0; pass < 2; pass++) {
      while (guard++ < 400) {
        const since = check ? lastSeq - 1 : lastSeq;
        const r = await call({ action: 'pull', since, limit: 200 });
        if (check) {
          const first = (r.events || [])[0];
          if ((r.total || 0) < lastSeq || !first || first.id !== check) {
            events = []; seenIds = new Set(); lastSeq = 0; start = 0; check = null; invalidate();
            ui.set(10, 'Tabelle wurde geändert, lade alles neu …', '');
            continue;
          }
          check = null;
        }
        (r.events || []).forEach(addSynced);
        const total = r.total || lastSeq;
        const frac = total > start ? (lastSeq - start) / (total - start) : 1;
        ui.set(4 + 92 * pushShare + 92 * (1 - pushShare) * frac, 'Lade Verlauf …', total > start ? `${lastSeq - start} von ${total - start} neuen Einträgen` : 'Alles aktuell');
        if (!r.more || !(r.events || []).length) break;
      }
      // Gesendet, aber beim Abholen nicht zurückbekommen: Zählung verrutscht, einmal alles neu laden
      if (pass === 0 && start > 0 && !rejected && toPush.some(p => !seenIds.has(p.id))) {
        events = []; seenIds = new Set(); lastSeq = 0; start = 0; guard = 0; invalidate();
        continue;
      }
      break;
      }
      pending = pending.filter(p => !seenIds.has(p.id));
      saveLog();
      lastSync = new Date().toISOString(); LS.set('lastSync', lastSync); syncError = null;
      ui.set(100, 'Fertig', '');
      if (overlay) await sleep(400);
      if (rejected && !quiet) toast('Einige Einträge wurden abgelehnt. Bitte das Google-Skript aktualisieren.');
      setTimeout(() => vaultSync(), 0);
      return { ok: true };
    } catch (err) {
      const code = (err && err.code) || 'server';
      syncError = code;
      const [t, s] = SYNC_ERR[code] || ['Sync fehlgeschlagen', `Fehler: ${code}`];
      if (overlay) await ui.error(t, s);
      else if (!quiet) toast(t);
      return { ok: false, code };
    } finally {
      ui.hide(); syncing = null; invalidate(); safeRender();
    }
  })();
  return syncing;
}

/* ---------- Bilder verkleinern ---------- */
function loadImage(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); }; img.src = url; });
}
async function resizeImage(file, max, square) {
  const img = await loadImage(file);
  let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
  if (square) { const m = Math.min(w, h); sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = Math.min(max, m); }
  else { const f = Math.min(1, max / Math.max(w, h)); w = Math.round(w * f); h = Math.round(h * f); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}
const canvasBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

/* ---------- Vault: private Bilder, verschlüsselt ----------
   Schlüsselaufbau (ab 1.3):
   - Wiederherstellungsschlüssel: 160 Bit Zufall, einmal angezeigt (32 Zeichen). Nur die Person selbst kennt ihn.
   - Daraus abgeleitet: der Datenschlüssel (verschlüsselt Bilder und Notizen) und der Vault-Zugang für die Tabelle.
   - Auf dem Handy liegt der Wiederherstellungsschlüssel nur mit dem 4-stelligen Code verschlüsselt.
   - In die Tabelle gehen nur die schon verschlüsselten Einträge. Ohne den Schlüssel sind sie unlesbar. */
const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const VAULT = { picking: 0, key: null, raw: null, mode: 'unlock', pin: '', first: '', msg: '', bad: false, entries: null, urls: {}, fails: 0, until: 0, del: null, importData: null, photo: null, photoUrl: null, showKey: null, wantKey: false, restore: null };
const vmeta = () => LS.get('vault.' + cfg.me, null);
const vtoken = () => LS.get('vault.tok.' + cfg.me, null);
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('hb-vault', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('entries', { keyPath: 'id' }); s.createIndex('person', 'person'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('entries', mode); const s = t.objectStore('entries'); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); },
  all(person) { return this.tx('readonly', s => s.index('person').getAll(person)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  put(rec) { return this.tx('readwrite', s => s.put(rec)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); }
};
async function deriveKey(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(saltB64), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encBytes(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: b64e(iv), ct: new Uint8Array(ct) }; }
async function decBytes(key, iv, ct) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, key, ct)); }
const encJSON = (key, o) => encBytes(key, new TextEncoder().encode(JSON.stringify(o)));
const decJSON = async (key, iv, ct) => JSON.parse(new TextDecoder().decode(await decBytes(key, iv, ct)));

/* Wiederherstellungsschlüssel: 20 Byte, als 8 Vierergruppen ohne verwechselbare Zeichen (kein 0/O, 1/I) */
const RK_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rkEncode(raw) {
  let bits = '', out = '';
  raw.forEach(b => { bits += b.toString(2).padStart(8, '0'); });
  for (let i = 0; i < bits.length; i += 5) out += RK_ABC[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
function rkDecode(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  if (t.length !== 32 || [...t].some(c => !RK_ABC.includes(c))) return null;
  const bits = [...t].map(c => RK_ABC.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Uint8Array.from(bits.match(/.{8}/g), b => parseInt(b, 2));
}
async function rawKeys(raw) {
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = new TextEncoder().encode('hantelbuch-vault-v2');
  const dk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('daten') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const tb = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('zugang') }, base, 256));
  return { dk, token: [...tb].map(b => b.toString(16).padStart(2, '0')).join('') };
}
async function wrapMeta(pin, raw, saved) {
  const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
  const pk = await deriveKey(pin, salt);
  const w = await encBytes(pk, raw);
  return { v: 2, salt, wiv: w.iv, wrap: b64e(w.ct), saved: !!saved };
}
/* Öffnet den Vault mit dem Code. Liefert { dk, raw } oder null. Alte Vaults (1.2) haben noch keinen raw-Schlüssel. */
async function openMeta(pin, meta) {
  try {
    const pk = await deriveKey(pin, meta.salt);
    if (meta.v === 2) { const raw = await decBytes(pk, meta.wiv, b64d(meta.wrap)); const k = await rawKeys(raw); return { dk: k.dk, raw, token: k.token }; }
    const o = await decJSON(pk, meta.civ, b64d(meta.check));
    return o && o.v === 'hantelbuch-vault' ? { dk: pk, raw: null } : null;
  } catch (e) { return null; }
}
async function unlocked(res) {
  VAULT.key = res.dk; VAULT.raw = res.raw;
  if (res.token) LS.set('vault.tok.' + cfg.me, res.token);
}
/* Umstellung eines alten Vaults (nur mit Code verschlüsselt) auf den Wiederherstellungsschlüssel */
async function migrateVault(pin) {
  const raw = crypto.getRandomValues(new Uint8Array(20));
  const k = await rawKeys(raw);
  await reencryptAll(VAULT.key, k.dk);
  LS.set('vault.' + cfg.me, await wrapMeta(pin, raw, false));
  await unlocked({ dk: k.dk, raw, token: k.token });
  VAULT.showKey = rkEncode(raw);
}
async function reencryptAll(oldKey, newKey) {
  for (const r of await IDB.all(cfg.me)) {
    const m = await decBytes(oldKey, r.miv, new Uint8Array(r.meta));
    const i = await decBytes(oldKey, r.iiv, new Uint8Array(r.img));
    const em = await encBytes(newKey, m), ei = await encBytes(newKey, i);
    await IDB.put({ ...r, miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
  }
}
async function loadVault() {
  const recs = await IDB.all(cfg.me);
  const list = [];
  for (const r of recs) { try { const m = await decJSON(VAULT.key, r.miv, new Uint8Array(r.meta)); list.push({ ...m, id: r.id, created: r.created }); } catch (e) { /* falscher Schlüssel: überspringen */ } }
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || '').localeCompare(a.created || ''));
  VAULT.entries = list;
}
function lockVault() {
  Object.values(VAULT.urls).forEach(u => URL.revokeObjectURL(u));
  Object.assign(VAULT, { key: null, raw: null, entries: null, urls: {}, pin: '', first: '', msg: '', mode: 'unlock', del: null, importData: null, showKey: null, restore: null });
  if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
  VAULT.photo = null; VAULT.photoUrl = null;
}
async function fillVaultImages() {
  if (!VAULT.key) return;
  const imgs = document.querySelectorAll('img[data-vimg]');
  for (const el of imgs) {
    const id = el.dataset.vimg;
    if (!VAULT.urls[id]) {
      try {
        const rec = await IDB.get(id);
        const bytes = await decBytes(VAULT.key, rec.iiv, new Uint8Array(rec.img));
        VAULT.urls[id] = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (e) { continue; }
    }
    if (document.body.contains(el)) el.src = VAULT.urls[id];
  }
}
async function pinComplete() {
  const pin = VAULT.pin; VAULT.pin = '';
  const fail = msg => { VAULT.msg = msg; VAULT.bad = true; render(); setTimeout(() => { VAULT.bad = false; }, 400); };
  const meta = vmeta();
  if (VAULT.mode === 'set1' || VAULT.mode === 'new1') { VAULT.first = pin; VAULT.mode = VAULT.mode === 'set1' ? 'set2' : 'new2'; VAULT.msg = ''; render(); return; }
  if (VAULT.mode === 'set2') {
    if (pin !== VAULT.first) { VAULT.mode = 'set1'; VAULT.first = ''; return fail('Die Codes stimmen nicht überein. Bitte noch einmal.'); }
    const restoring = !!VAULT.restore;
    VAULT.msg = restoring ? 'Stelle Vault wieder her …' : 'Lege Vault an …'; render();
    const raw = restoring ? VAULT.restore.raw : crypto.getRandomValues(new Uint8Array(20));
    const k = await rawKeys(raw);
    LS.set('vault.' + cfg.me, await wrapMeta(pin, raw, restoring));
    await unlocked({ dk: k.dk, raw, token: k.token });
    VAULT.entries = []; VAULT.mode = 'unlock'; VAULT.restore = null;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
    if (restoring) {
      VAULT.msg = 'Lade Bilder aus der Tabelle …'; render();
      const r = await vaultSync({ progress: (a, b) => { VAULT.msg = `Lade Bilder aus der Tabelle … ${a} von ${b}`; if (view === 'vault' && !VAULT.entries.length) render(); } });
      VAULT.msg = ''; await loadVault();
      toast(r && r.ok ? `${VAULT.entries.length} ${VAULT.entries.length === 1 ? 'Bild' : 'Bilder'} wiederhergestellt` : 'Laden unterbrochen. Der Rest kommt beim nächsten Öffnen.');
      render(); return;
    }
    VAULT.msg = ''; VAULT.showKey = rkEncode(raw);
    render(); return;
  }
  if (VAULT.mode === 'new2') {
    if (pin !== VAULT.first) { VAULT.mode = 'new1'; VAULT.first = ''; return fail('Die Codes stimmen nicht überein. Neuen Code noch einmal eingeben.'); }
    VAULT.msg = 'Speichere neuen Code …'; render();
    if (VAULT.raw) LS.set('vault.' + cfg.me, await wrapMeta(pin, VAULT.raw, meta && meta.saved));
    lockVault(); toast('Vault-Code geändert'); location.hash = '#einstellungen'; return;
  }
  if (Date.now() < VAULT.until) return fail(`Zu viele Versuche. Bitte ${Math.ceil((VAULT.until - Date.now()) / 1000)} Sekunden warten.`);
  if (VAULT.mode === 'import') {
    const res = await openMeta(pin, VAULT.importData.meta);
    if (!res) return fail('Falscher Code für dieses Backup.');
    VAULT.msg = 'Lade Backup …'; render();
    const n = await importBackup(VAULT.importData, res.dk);
    VAULT.importData = null; VAULT.mode = 'unlock'; VAULT.msg = ''; await loadVault(); toast(`${n} ${n === 1 ? 'Bild' : 'Bilder'} aus dem Backup geladen`); render(); vaultSync(); return;
  }
  VAULT.msg = 'Prüfe Code …'; render();
  const res = await openMeta(pin, meta);
  if (!res) { VAULT.fails++; if (VAULT.fails >= 5) { VAULT.until = Date.now() + 30000; VAULT.fails = 0; } return fail('Falscher Code.'); }
  VAULT.fails = 0; VAULT.msg = '';
  await unlocked(res);
  if (!res.raw) { VAULT.msg = 'Stelle den Vault auf Cloud-Sicherung um …'; render(); await migrateVault(pin); VAULT.msg = ''; }
  if (VAULT.mode === 'old') { VAULT.mode = 'new1'; render(); return; }
  if (VAULT.wantKey) { VAULT.wantKey = false; VAULT.showKey = rkEncode(VAULT.raw); }
  if (VAULT.importData) {
    if (VAULT.importData.meta.salt === vmeta().salt) { VAULT.msg = 'Lade Backup …'; render(); const n = await importBackup(VAULT.importData, VAULT.key); VAULT.importData = null; VAULT.msg = ''; toast(`${n} ${n === 1 ? 'Bild' : 'Bilder'} aus dem Backup geladen`); }
    else { VAULT.mode = 'import'; render(); return; }
  }
  await loadVault(); render(); vaultSync();
}
async function saveVaultEntry(form) {
  const f = new FormData(form);
  const err = m => { const e = $('#vn-err'); e.textContent = m; e.hidden = false; };
  if (!VAULT.photo) return err('Bitte zuerst ein Foto aufnehmen oder auswählen.');
  const date = String(f.get('date') || todayStr());
  const bw = num(f.get('bw'));
  const note = String(f.get('note') || '').trim().slice(0, 2000);
  const btn = $('#vn-save'); btn.disabled = true; btn.textContent = 'Speichere …';
  try {
    const canvas = await resizeImage(VAULT.photo, 1600, false);
    const blob = await canvasBlob(canvas, 0.82);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const em = await encJSON(VAULT.key, { date, note, bw: bw >= 30 && bw <= 300 ? bw : null });
    const ei = await encBytes(VAULT.key, bytes);
    await IDB.put({ id: uid(), person: cfg.me, created: new Date().toISOString(), miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
    if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
    VAULT.photo = null; VAULT.photoUrl = null;
    await loadVault(); toast('Im Vault gespeichert'); location.hash = '#vault';
    vaultSync();
  } catch (e) { btn.disabled = false; btn.textContent = 'Im Vault speichern'; err('Speichern fehlgeschlagen: ' + (e.message || e)); }
}
async function deleteVaultEntry(id) {
  const rec = await IDB.get(id);
  await IDB.del(id);
  if (rec && rec.up) { const t = LS.get('vault.tomb.' + cfg.me, []); t.push(id); LS.set('vault.tomb.' + cfg.me, t); }
  vaultSync();
}
async function exportVault() {
  const meta = vmeta(); if (!meta) return;
  const recs = await IDB.all(cfg.me);
  const data = { type: 'hantelbuch-vault', v: 1, person: cfg.me, created: new Date().toISOString(), meta, entries: recs.map(r => ({ id: r.id, created: r.created, miv: r.miv, meta: b64e(new Uint8Array(r.meta)), iiv: r.iiv, img: b64e(new Uint8Array(r.img)) })) };
  const name = `hantelbuch-vault-${cfg.me.toLowerCase()}-${todayStr()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Hantelbuch Vault-Backup' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`Backup mit ${recs.length} ${recs.length === 1 ? 'Bild' : 'Bildern'} erstellt`);
}
async function importBackup(data, srcKey) {
  const existing = new Set((await IDB.all(cfg.me)).map(r => r.id));
  let n = 0;
  for (const e of data.entries) {
    if (existing.has(e.id)) continue;
    const m = await decBytes(srcKey, e.miv, b64d(e.meta));
    const i = await decBytes(srcKey, e.iiv, b64d(e.img));
    const em = await encBytes(VAULT.key, m), ei = await encBytes(VAULT.key, i);
    await IDB.put({ id: e.id, person: cfg.me, created: e.created, miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
    n++;
  }
  return n;
}
async function readBackupFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== 'hantelbuch-vault' || !data.meta || !Array.isArray(data.entries)) throw new Error();
    if (!vmeta()) { LS.set('vault.' + cfg.me, data.meta); }
    VAULT.importData = data;
    if (!VAULT.key) { toast('Gib den Code ein, mit dem das Backup erstellt wurde.'); VAULT.mode = 'unlock'; location.hash = '#vault'; render(); return; }
    VAULT.mode = 'import'; location.hash = '#vault'; render();
  } catch (e) { toast('Diese Datei ist kein Hantelbuch-Backup.'); }
}

/* ---------- Vault-Sicherung in der Tabelle ----------
   Läuft still im Hintergrund, auch wenn der Vault gesperrt ist: Hoch- und runtergeladen werden nur die bereits
   verschlüsselten Einträge. Der persönliche Vault-Zugang sorgt dafür, dass niemand sonst sie abrufen kann. */
const VCHUNK = 45000;
let vaultSyncing = null, vaultQueued = null;
const vcloud = () => LS.get('vault.cloud.' + cfg.me, null);
function vaultSync({ progress } = {}) {
  // läuft schon ein Abgleich, kommt genau ein weiterer danach (z. B. für ein gerade gelöschtes Bild)
  if (vaultSyncing) { if (!vaultQueued) vaultQueued = vaultSyncing.then(() => { vaultQueued = null; return vaultSync({ progress }); }); return vaultQueued; }
  const tok = vtoken(), meta = vmeta();
  if (!cfg.url || !cfg.key || !tok || !meta || meta.v !== 2 || navigator.onLine === false) return Promise.resolve({ ok: false });
  if (scriptVersion != null && scriptVersion < 3) return Promise.resolve({ ok: false, code: 'script' });
  const me = cfg.me;
  const req = (action, extra = {}, timeout = 120000) => call({ action, person: me, vtoken: tok, ...extra }, timeout);
  vaultSyncing = (async () => {
    let changed = false;
    try {
      let cloud = [], fresh = false;
      try { cloud = (await req('vault_list', {}, 30000)).entries || []; }
      catch (e) { if (e.code !== 'vault_none') throw e; fresh = true; }
      const inCloud = new Set(cloud.map(c => c.id));
      // gelöschte Bilder auch in der Tabelle entfernen
      const tombs = LS.get('vault.tomb.' + me, []);
      for (const id of [...tombs]) {
        if (inCloud.has(id)) { await req('vault_del', { id }, 30000); inCloud.delete(id); }
        tombs.splice(tombs.indexOf(id), 1); LS.set('vault.tomb.' + me, tombs);
      }
      const local = await IDB.all(me), have = new Set(local.map(r => r.id));
      // hochladen, was neu ist; was hochgeladen war und in der Tabelle fehlt, wurde auf einem anderen Gerät gelöscht
      for (const r of local) {
        if (r.up && !inCloud.has(r.id) && !fresh) { await IDB.del(r.id); changed = true; continue; }
        if (r.up && !fresh) continue;
        const body = JSON.stringify({ id: r.id, created: r.created, miv: r.miv, meta: b64e(new Uint8Array(r.meta)), iiv: r.iiv, img: b64e(new Uint8Array(r.img)) });
        const chunks = []; for (let i = 0; i < body.length; i += VCHUNK) chunks.push(body.slice(i, i + VCHUNK));
        await req('vault_put', { id: r.id, created: r.created, chunks });
        await IDB.put({ ...r, up: true }); inCloud.add(r.id);
      }
      // fehlende Einträge aus der Tabelle laden (neues Handy oder zweites Gerät)
      const missing = cloud.filter(c => inCloud.has(c.id) && !have.has(c.id) && !tombs.includes(c.id));
      for (let i = 0; i < missing.length; i++) {
        if (progress) progress(i, missing.length);
        const g = await req('vault_get', { id: missing[i].id });
        const e = JSON.parse(g.chunks.join(''));
        if (e.id !== missing[i].id) continue;
        await IDB.put({ id: e.id, person: me, created: e.created, miv: e.miv, meta: b64d(e.meta).buffer, iiv: e.iiv, img: b64d(e.img).buffer, up: true });
        changed = true;
      }
      LS.set('vault.cloud.' + me, { at: new Date().toISOString(), n: inCloud.size, err: null });
      return { ok: true };
    } catch (e) {
      const c = (e && e.code) || 'server';
      LS.set('vault.cloud.' + me, { ...(vcloud() || {}), err: c });
      return { ok: false, code: c };
    } finally {
      vaultSyncing = null;
      if (changed && VAULT.key && cfg.me === me) { await loadVault(); if (view === 'vault') render(); }
      if (view === 'einstellungen') safeRender();
    }
  })();
  return vaultSyncing;
}
async function startRestore() {
  const err = m => { const e = $('#rk-err'); e.textContent = m; e.hidden = false; };
  const raw = rkDecode($('#rk-in').value);
  if (!raw) return err('Der Schlüssel hat 32 Zeichen (8 Gruppen à 4). Bitte prüfe deine Eingabe.');
  if (!cfg.url || !cfg.key) return err('Verbinde zuerst die Google-Tabelle unter Einstellungen.');
  const btn = $('#rk-go'); btn.disabled = true; btn.textContent = 'Prüfe Schlüssel …';
  try {
    const k = await rawKeys(raw);
    const r = await call({ action: 'vault_list', person: cfg.me, vtoken: k.token }, 30000);
    LS.set('vault.tok.' + cfg.me, k.token);
    VAULT.restore = { raw, n: (r.entries || []).length };
    VAULT.mode = 'set1'; location.hash = '#vault';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Weiter';
    err(e.code === 'vault_denied' ? 'Dieser Schlüssel passt nicht zu deinem Vault.' : e.code === 'vault_none' ? 'In der Tabelle gibt es noch keine Vault-Sicherung von dir.' : e.code === 'unknown_action' || e.code === 'bad_request' ? 'Das Google-Skript muss zuerst auf Version 3 aktualisiert werden.' : 'Keine Verbindung zur Tabelle. Bitte später noch einmal versuchen.');
  }
}

/* ---------- Oberfläche ---------- */
let view = '', verlaufTab = 'aktiv', notesFilter = 'Alle', skipAsk = false, builder = null, resetAsk = false, pendingRender = false;
const cal = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: todayStr() };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}
function bellBtn(id = 'bell') {
  const n = openCount();
  return `<a class="iconbtn" id="${id}" href="#glocke" aria-label="Planänderungen${n ? ', ' + n + ' neu' : ''}">${ICON.bell}${n ? `<span class="badge">${n}</span>` : ''}</a>`;
}
const gearBtn = () => `<a class="iconbtn" href="#einstellungen" aria-label="Einstellungen">${ICON.gear}</a>`;
const backBtn = (to, label = 'Zurück') => `<a class="iconbtn" href="#${to}" aria-label="${label}">${ICON.left}</a>`;
function head(title, big = true) { return `<header class="head" id="head"><div class="brand ${big ? 'big' : ''}">${title}</div>${bellBtn()}</header>`; }
const subhead = (backTo = 'start', right = '') => `<header class="head" id="head">${backBtn(backTo)}<div class="brand"></div>${right}</header>`;
function tabbar(active) {
  const t = (id, label, icon) => `<a href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  return `<nav class="tabbar glass" aria-label="Navigation">${t('start', 'Start', ICON.home)}${t('verlauf', 'Verlauf', ICON.chart)}${t('plan', 'Plan', ICON.list)}${t('notizen', 'Notizen', ICON.note)}${t('profil', 'Profil', avatar(cfg.me, 24))}</nav>`;
}

function safeRender() {
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; if (view === 'training') refreshTraining(); return; }
  if (view === 'training' && draft) { refreshTraining(); return; }
  if (view.startsWith('vault')) return; // Vault nicht durch Sync neu zeichnen
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (!pendingRender) return;
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  pendingRender = false; if (view === 'training' && draft) refreshTraining(); else if (!view.startsWith('vault')) render();
}, 50));

function exerciseDay(id) { const p = st().plans[cfg.me]; return DAYS.find(d => p[d].exercises.some(x => x.id === id)) || null; }

/* ---------- Hintergrund: Noise-Verlauf (Mechanik wie die Blender-Nodes) ----------
   Wolken = grobes Gradient-Rauschen, Grain = feines Pixel-Rauschen, gemischt und über eine Rampe
   von Schwarz zur Tagesfarbe eingefärbt. Das Muster hängt nur von der Position ab: Wird die Seite länger,
   werden unten einfach neue Abschnitte (je 512 px) dazugerechnet, die nahtlos anschließen. Bestehende bleiben. */
const BG = (() => {
  const CHUNK = 512;
  const TONES = {
    '': { rgb: [255, 255, 255], str: .3, lo: .56, seed: 5 },
    y: { rgb: [255, 242, 0], str: .68, lo: .56, seed: 11 },
    m: { rgb: [236, 0, 140], str: .8, lo: .56, seed: 23 },
    c: { rgb: [0, 174, 239], str: .8, lo: .56, seed: 37 }
  };
  const GAIN = 4.5, GRAIN = .29, CX = .003, CY = .0024;
  function makeNoise(seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
    const p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256), base = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const perlin = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const k00 = p[p[X] + Y], k10 = p[p[X + 1] + Y], k01 = p[p[X] + Y + 1], k11 = p[p[X + 1] + Y + 1];
      const n00 = gx[k00] * xf + gy[k00] * yf, n10 = gx[k10] * (xf - 1) + gy[k10] * yf;
      const n01 = gx[k01] * xf + gy[k01] * (yf - 1), n11 = gx[k11] * (xf - 1) + gy[k11] * (yf - 1);
      const u = fade(xf), v = fade(yf), a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
      return a + v * (b - a);
    };
    // zwei Ebenen, auf die Werteverteilung des Entwurfs normiert
    return (x, y) => .553 + (perlin(x, y) + .5 * perlin(x * 2 + 17.3, y * 2 + 5.1) + .037) * .4225;
  }
  const hash = (x, y, seed) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519 | 0); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sets = {};   // je Farbton: { width, noise, canvases[] }
  let el = null, tone = null, height = 0, queue = false;
  function draw(t, i) {
    const S = sets[t], cfg = TONES[t], w = S.width, cv = document.createElement('canvas');
    cv.width = w; cv.height = CHUNK; cv.style.top = (i * CHUNK) + 'px';
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, CHUNK), d = img.data;
    const cr = cfg.rgb[0] * cfg.str, cg = cfg.rgb[1] * cfg.str, cb = cfg.rgb[2] * cfg.str, y0 = i * CHUNK;
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < w; x++) {
      const v = S.noise(x * CX, (y0 + y) * CY) + GRAIN * (hash(x, y0 + y, cfg.seed) - .5);
      let k = (v - cfg.lo) * GAIN; k = k < 0 ? 0 : k > 1 ? 1 : k;
      const o = (y * w + x) * 4; d[o] = cr * k; d[o + 1] = cg * k; d[o + 2] = cb * k; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    S.canvases[i] = cv;
  }
  function fill() {
    queue = false;
    if (!el) return;
    const w = Math.max(1, Math.round(el.clientWidth));
    let S = sets[tone];
    if (!S || S.width !== w) S = sets[tone] = { width: w, noise: makeNoise(TONES[tone].seed), canvases: [] };
    const need = Math.ceil(height / CHUNK);
    // zuerst der sichtbare Bereich, dann der Rest, ein Abschnitt pro Bild, damit nichts ruckelt
    const app = $('#app'), first = Math.floor((app ? app.scrollTop : 0) / CHUNK);
    const order = [...Array(need).keys()].sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
    const todo = order.find(i => !S.canvases[i]);
    if (todo !== undefined) { draw(tone, todo); queue = true; requestAnimationFrame(fill); }
    const want = S.canvases.slice(0, need).filter(Boolean);
    if (el.childElementCount !== want.length || [...el.children].some((c, i) => c !== want[i])) el.replaceChildren(...want);
    el.style.height = height + 'px';
  }
  function update(nextTone, nextHeight) {
    return; // Noise-Hintergrund aus
    el = el || $('#bg');
    tone = TONES[nextTone] ? nextTone : '';
    height = Math.ceil(nextHeight);
    if (!queue) { queue = true; requestAnimationFrame(fill); }
  }
  return { update, reset() { for (const k in sets) delete sets[k]; if (el) el.replaceChildren(); update(tone || '', height); } };
})();

/* #app enthält dauerhaft den Hintergrund (#bg) und die Seite (#page). Nur die Seite wird neu gezeichnet,
   der Hintergrund bleibt stehen und wächst mit der Seitenhöhe mit. */
let pageObserver = null;
function setPage(html, tone) {
  const app = $('#app');
  let bg = $('#bg'), page = $('#page');
  if (!bg || !page) {
    app.innerHTML = '<div id="bg" aria-hidden="true"></div><div id="page" class="page"></div>';
    bg = $('#bg'); page = $('#page');
    if ('ResizeObserver' in window) { pageObserver = new ResizeObserver(() => BG.update(document.body.dataset.tone || '', page.offsetHeight)); pageObserver.observe(page); }
  }
  page.innerHTML = html;
  BG.update(tone, page.offsetHeight);
}
function render() {
  const app = $('#app');
  if (!cfg.me) { document.body.dataset.tone = ''; setPage(viewSetup(), ''); return; }
  const h = decodeURIComponent(location.hash.slice(1)) || 'start';
  const [name, arg] = h.includes(':') ? [h.slice(0, h.indexOf(':')), h.slice(h.indexOf(':') + 1)] : [h, ''];
  if (name !== view) { skipAsk = resetAsk = false; if (view.startsWith('vault') && !name.startsWith('vault')) lockVault(); }
  let html, tone = '';
  switch (name) {
    case 'training': if (!draft) { location.hash = '#start'; return; } html = viewTraining(); tone = DAY_TONE[draft.day]; break;
    case 'verlauf': html = head('Verlauf') + `<main class="view">${viewVerlauf()}</main>` + tabbar('verlauf'); break;
    case 'plan': html = head('Plan') + `<main class="view">${viewPlan()}</main>` + tabbar('plan'); break;
    case 'notizen': html = head('Notizen') + `<main class="view">${viewNotes()}</main>` + tabbar('notizen'); break;
    case 'glocke': html = subhead(draft ? 'training' : 'start') + `<main class="view">${viewBell()}</main>` + (draft ? '' : tabbar('')); break;
    case 'einstellungen': html = subhead(draft ? 'training' : 'start') + `<main class="view nobar">${viewSettings()}</main>`; break;
    case 'gewicht': html = subhead('profil') + `<main class="view">${viewBodyweight()}</main>` + tabbar('profil'); break;
    case 'profil': html = (arg && arg !== cfg.me ? subhead('start') : `<header class="head" id="head"><div class="brand"></div>${gearBtn()}</header>`) + `<main class="view">${viewProfile(arg && PEOPLE.includes(arg) ? arg : cfg.me)}</main>` + tabbar(arg && arg !== cfg.me ? '' : 'profil'); break;
    case 'vault': html = subhead('profil', VAULT.key && VAULT.mode === 'unlock' && !VAULT.showKey ? `<button class="btn small glass" data-act="v-lock" style="border-color:rgba(255,255,255,.3)">${ICON.lock.replace('width="22" height="22"', 'width="16" height="16"')} Sperren</button>` : '') + `<main class="view nobar">${viewVault()}</main>`; break;
    case 'vault-wiederherstellen': html = subhead(vmeta() ? 'einstellungen' : 'vault') + `<main class="view nobar">${viewRestore()}</main>`; break;
    case 'vault-neu': if (!VAULT.key) { location.hash = '#vault'; return; } html = subhead('vault') + `<main class="view nobar">${viewVaultNew()}</main>`; break;
    case 'uebung': html = subhead('verlauf') + `<main class="view">${viewExercise(arg)}</main>` + tabbar('verlauf'); tone = DAY_TONE[exerciseDay(arg)] || ''; break;
    case 'training-log': { html = subhead('verlauf') + `<main class="view">${viewWorkout(arg)}</main>` + tabbar('verlauf'); const w = st().workouts.find(x => x.id === arg); tone = w ? DAY_TONE[w.data.day] : ''; break; }
    default: html = `<header class="head" id="head"><div class="brand">Hantelbuch</div>${bellBtn()}${gearBtn()}</header><main class="view">${viewStart()}</main>` + tabbar('start');
  }
  document.body.dataset.tone = tone;
  setPage(html, tone);
  if (name !== view) { app.scrollTop = 0; view = name; }
  pendingRender = false;
  onScroll();
  if (name === 'vault') fillVaultImages();
}
function onScroll() { const h = $('#head'); if (h) h.classList.toggle('scrolled', $('#app').scrollTop > 4); const sh = $('.sheet.full'); if (sh) sh.classList.toggle('scrolled', sh.scrollTop > 40); }
document.addEventListener('scroll', onScroll, { passive: true, capture: true });
/* Echte Bildschirmhöhe: Als App vom Home-Bildschirm meldet iOS teils eine zu kleine Höhe, dann entstünde unten ein Balken. */
function setHeight() {
  let h = window.innerHeight;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) h = Math.max(h, matchMedia('(orientation: portrait)').matches ? screen.height : screen.width);
  document.documentElement.style.setProperty('--H', h + 'px');
}
setHeight();
window.addEventListener('resize', setHeight);
let bgW = innerWidth; window.addEventListener('resize', () => { if (innerWidth !== bgW) { bgW = innerWidth; BG.reset(); } });
window.addEventListener('orientationchange', () => setTimeout(setHeight, 300));

/* ---------- Start ---------- */
function syncLine() {
  const waiting = pending.filter(p => !seenIds.has(p.id)).length;
  if (!cfg.url) return `<div class="syncline"><i class="sdot off"></i><span>Ohne Sync – Einträge bleiben nur auf diesem Handy.</span><a class="linkbtn" href="#einstellungen">Einrichten</a></div>`;
  const old = scriptVersion != null && scriptVersion < SCRIPT_MIN;
  const txt = old ? 'Google-Skript bitte aktualisieren (siehe Anleitung)' :
    syncError && waiting ? `${waiting} ${waiting === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf Sync` :
    waiting ? `${waiting} ${waiting === 1 ? 'Eintrag wird' : 'Einträge werden'} gesendet …` :
    lastSync ? `Synchronisiert ${relDay(lastSync)}, ${fmtTime(lastSync)}` : 'Noch nicht synchronisiert';
  return `<div class="syncline"><i class="sdot ${waiting || old ? 'wait' : ''}"></i><span>${txt}</span><button class="linkbtn" data-act="sync">${ICON.sync} Sync</button></div>`;
}
function viewStart() {
  const s = st(), me = cfg.me, other = partner();
  const nd = nextDay(me), plan = s.plans[me][nd];
  const dl_ = deloadState(me);
  const nSets = plan.exercises.reduce((a, x) => a + (+x.sets || 0), 0);
  const lastDoneOf = d => s.workouts.filter(w => w.person === me && w.data.day === d).pop();
  const lastDone = lastDoneOf(nd);
  const wd = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
  const rot = DAYS.map(d => {
    const isNext = d === (draft ? draft.day : nd);
    const l = lastDoneOf(d);
    const label = isNext ? (draft ? 'läuft' : 'als Nächstes') : l ? 'zuletzt ' + new Date(l.ts).toLocaleDateString('de-DE', { weekday: 'short' }) : '–';
    return `<div class="rot glass t-${DAY_TONE[d]} ${isNext ? 'next' : ''}"><b><i class="dot t-${DAY_TONE[d]}"></i>${esc(dl(d))}</b><span>${label}</span></div>`;
  }).join('');
  let main;
  if (draft) {
    main = `<div class="eyebrow">Training läuft${draft.deload ? ' · Deload' : ''}</div>
      <h1 class="kurz">${esc(dl(draft.day))}</h1><div class="title">${esc(draft.title)}</div>
      <div class="mono muted small">begonnen ${relDay(draft.start)} um ${fmtTime(draft.start)}</div>
      <div class="btnrow" style="padding-top:8px"><a class="btn primary" href="#training">Training fortsetzen</a></div>`;
  } else {
    const nextAfter = DAYS[(DAYS.indexOf(nd) + 1) % 3];
    main = `<div class="eyebrow">${dl_.active ? `Deload · Teil ${dl_.part} von 3` : `Als Nächstes · ${wd}`}</div>
      <h1 class="kurz">${esc(dl(nd))}</h1><div class="title">${esc(plan.title)}</div>
      <div class="mono muted small">${plan.exercises.length} Übungen · ${dl_.active ? `${plan.exercises.reduce((a, x) => a + Math.ceil((+x.sets || 1) / 2), 0)} Sätze (halbiert)` : `${nSets} Sätze`}${lastDone ? ` · zuletzt ${relDay(lastDone.ts)}` : ''}</div>
      ${dl_.active ? `<div class="deload"><b>Deload-Woche</b><span class="muted">${esc(dl_.reason)}. Gewicht −10 %, halbe Sätze, Wiederholungen am unteren Ende. Danach geht es mit deinen bisherigen Gewichten weiter.</span></div>` : ''}
      <div class="btnrow" style="padding-top:8px">
        <button class="btn primary" data-act="start" style="flex:2 1 160px">${dl_.active ? 'Deload starten' : 'Training starten'}</button>
        ${skipAsk ? '' : '<button class="btn" data-act="skip-ask" style="flex:1 1 120px">Überspringen</button>'}
      </div>
      ${dl_.active ? '<button class="btn ghost" data-act="start-normal">Heute normal trainieren</button>' : ''}
      ${skipAsk ? `<div class="confirm"><div><b>${esc(dl(nd))} überspringen?</b><br><span class="small muted">Danach ist bei dir ${esc(dl(nextAfter))} dran. ${esc(gen(other))} Rotation bleibt unverändert.</span></div>
        <div class="btnrow"><button class="btn small primary" data-act="skip-yes">Überspringen</button><button class="btn small ghost" data-act="skip-no">Abbrechen</button></div></div>` : ''}`;
  }
  const wk = weekStart();
  const weekCount = p => s.workouts.filter(w => w.person === p && new Date(w.ts) >= wk).length;
  const ol = s.last[other], ml = s.last[me];
  const install = !(navigator.standalone || matchMedia('(display-mode: standalone)').matches) && /iPhone|iPad/.test(navigator.userAgent)
    ? `<div class="install glass">Tipp: Tippe in Safari auf <b>Teilen</b> und dann <b>Zum Home-Bildschirm</b>. Dann läuft die App wie eine normale App und auch offline.</div>` : '';
  const feed = s.feed.slice(0, 5);
  return `${install}
    <section class="hero">${main}</section>
    <div class="rotation" aria-label="Deine Rotation">${rot}</div>
    ${syncLine()}
    <div class="duo">
      <a class="card" href="#profil"><span class="who">${avatar(me, 28)}Du</span><span class="big">${weekCount(me)}<small> / 3</small></span><span class="small muted">diese Woche${ml ? ` · zuletzt ${relDay(ml.ts)}` : ''}</span></a>
      <a class="card" href="#profil:${esc(other)}"><span class="who">${avatar(other, 28)}${esc(other)}</span><span class="big">${weekCount(other)}<small> / 3</small></span><span class="small muted">${ol ? `als Nächstes ${esc(dl(nextDay(other), other))}` : 'noch kein Eintrag'}</span></a>
    </div>
    <div class="sec-title"><h2>Neuigkeiten</h2>${s.feed.length > 5 ? '<a href="#verlauf">Alle</a>' : ''}</div>
    <section class="card" style="padding:4px 16px">${feed.length ? `<div class="feed">${feed.map(feedItem).join('')}</div>` : '<div class="empty">Hier erscheinen eure Trainings, Steigerungen und Skips.</div>'}</section>`;
}
function feedItem(e) {
  const d = e.data || {}, p = e.person, me = p === cfg.me;
  const wait = isPending(e.id) ? '<span class="chip wait">noch nicht synchronisiert</span>' : '';
  let t = '', m = fmtDate(e.ts) + ' · ' + fmtTime(e.ts), extra = '', href = '';
  const who = `<b>${me ? 'Du' : esc(p)}</b>`;
  if (e.type === 'workout') {
    const n = (d.entries || []).reduce((a, en) => a + en.sets.length, 0);
    const imp = improvements(e);
    t = `${dayChip(d.day, p)}<span>${who} ${me ? 'hast' : 'hat'} abgeschlossen</span>`;
    m += ` · ${duration(d.start, d.end)} · ${n} ${n === 1 ? 'Satz' : 'Sätze'}`;
    const notes = (d.entries || []).filter(en => en.note).length;
    extra = (d.deload ? '<span class="chip dl">Deload</span>' : '')
      + imp.map(i => `<span class="chip ${i.pr ? 'pr' : ''}">${esc(i.name.replace(/\s*\(.*\)$/, ''))} ${esc(i.label)}${i.pr ? ' · Rekord' : ''}</span>`).join('')
      + (notes ? `<span class="chip">${notes} ${notes === 1 ? 'Notiz' : 'Notizen'}</span>` : '');
    href = '#training-log:' + encodeURIComponent(e.id);
  } else if (e.type === 'skip') {
    t = `${dayChip(d.day, p, 'skip')}<span>${who} ${me ? 'hast' : 'hat'} übersprungen</span>`;
  } else if (e.type === 'swap') {
    t = `${dayChip(d.day, p)}<span>${who} ${me ? 'hast' : 'hat'} heute ${esc(d.fromName)} durch ${esc(d.to.name)} getauscht</span>`;
    extra = '<span class="chip">für beide</span>';
  }
  const inner = `${avatar(p, 34)}<div><div class="t">${t}</div><div class="m">${m}</div>${extra || wait ? `<div class="chips">${extra}${wait}</div>` : ''}</div>`;
  return href ? `<a class="fi" href="${href}">${inner}</a>` : `<div class="fi">${inner}</div>`;
}

/* ---------- Training ---------- */
function normalizeDraft(d) {
  if (!d || !Array.isArray(d.items)) return null;
  d.swapIgnored = d.swapIgnored || [];
  d.items.forEach(it => {
    it.ex = cleanEx(it.ex); it.note = it.note || ''; it.feel = it.feel || ''; it.wu = it.wu || [];
    it.sets = (it.sets || []).map(s => ({ w: s.w ?? '', neg: !!s.neg, r: s.r ?? '', done: !!s.done }));
  });
  return d;
}
function blankSet(w) { return { w: w == null || w === 0 ? '' : fmtIn(w), neg: w < 0, r: '', done: false }; }
function newItem(x, deload) {
  const pr = progression(x);
  let n = Math.max(1, +x.sets || 1), w = pr.w;
  if (deload) { n = Math.max(1, Math.ceil(n / 2)); w = pr.base == null ? null : roundTo(deloadW(pr.base), stepOf(x)); }
  if (x.type === 'time') w = null;
  return { ex: x, note: '', feel: '', wu: [], swappedFrom: null, swapBy: null, removed: false, sets: Array.from({ length: n }, () => blankSet(w)) };
}
function partnerSwapsToday(day) {
  const other = partner(), latest = {};
  st().swaps.filter(e => e.person === other && e.data.day === day && e.data.date === todayStr()).forEach(e => { latest[e.data.fromId] = e; });
  return Object.values(latest);
}
function startTraining(skipDeload) {
  const me = cfg.me, day = nextDay(me), plan = st().plans[me][day];
  const dlS = deloadState(me), deload = dlS.active && !skipDeload;
  draft = { day, title: plan.title, start: new Date().toISOString(), deload, deloadSkipped: dlS.active && !!skipDeload, swapIgnored: [], items: plan.exercises.map(x => newItem(clone(x), deload)) };
  partnerSwapsToday(day).forEach(sw => {
    const i = draft.items.findIndex(t => t.ex.id === sw.data.fromId);
    if (i < 0) return;
    const it = newItem(clone(sw.data.to), deload);
    it.swappedFrom = { id: sw.data.fromId, name: sw.data.fromName }; it.swapBy = sw.person;
    draft.items[i] = it;
  });
  saveDraft(); location.hash = '#training';
}
const hasEntries = it => it.sets.some(s => s.done || int(s.r) > 0) || !!(it.note || '').trim();
const workCount = () => { let done = 0, tot = 0; draft.items.forEach(it => it.sets.forEach(s => { tot++; if (s.done) done++; })); return { done, tot }; };
function trainCountText() { const { done, tot } = workCount(); return `${done} / ${tot} Sätze · ${duration(draft.start, new Date().toISOString())}`; }
function viewTraining() {
  const { done, tot } = workCount();
  return `<header class="trainhead" id="head">
      <div class="row">${backBtn('start', 'Zurück zum Start')}<span class="count" id="tp-count">${trainCountText()}</span>${bellBtn('tbell')}</div>
      <div class="ttl"><div><h1 class="kurz">${esc(dl(draft.day))}</h1><div class="sub">${esc(draft.title)}</div></div>${draft.deload ? '<span class="pill dl">Deload</span>' : ''}</div>
      <div class="bar"><i id="tp-bar" style="width:${tot ? done / tot * 100 : 0}%"></i></div>
    </header>
    <main class="view notab">${draft.items.map((it, i) => exCard(it, i)).join('')}</main>
    <div class="trainbar"><button class="btn primary" data-act="finish-ask">Training abschließen</button><button class="btn x" data-act="discard-ask" aria-label="Training verwerfen">${ICON.x}</button></div>`;
}
function pendingSwapFor(it) {
  if (!draft || it.swappedFrom || it.removed) return null;
  return partnerSwapsToday(draft.day).find(sw => sw.data.fromId === it.ex.id && !draft.swapIgnored.includes(sw.id)) || null;
}
const hasWarmup = it => it.ex.warmup && it.ex.type === 'kg' && !it.removed;
function warmupLabel(it) {
  const W = num(it.sets[0] && it.sets[0].w) || workW(it.sets.map(s => ({ w: s.w, r: 1 })));
  const [p, reps] = WARMUP;
  if (!(W > 0)) return `Aufwärmen · ${Math.round(p * 100)} % × ${reps}`;
  const kg = Math.min(W, Math.max(W >= 20 ? 20 : 0, roundTo(W * p, 2.5)));
  return `Aufwärmen · ${fmtN(kg)} kg × ${reps}`;
}
function exCard(it, i) {
  const x = it.ex, me = cfg.me, other = partner();
  const mine = lastAny(me, x.id), theirs = lastAny(other, x.id);
  const pr = progression(x);
  const unit = x.type === 'time' ? ' s' : '';
  const allDone = it.sets.length && it.sets.every(s => s.done);
  const hint = draft.deload ? 'Deload: Gewicht −10 %, halbe Sätze, Wiederholungen am unteren Ende.' : pr.hint;
  const sw = pendingSwapFor(it);
  const lastReps = j => (draft.deload ? x.min : mine && mine.type === x.type && mine.sets[j] ? mine.sets[j].r : x.max);
  const wField = (s, j) => x.type === 'kg'
    ? `<label class="field"><input id="w-${i}-${j}" data-i="${i}" data-j="${j}" data-f="w" inputmode="decimal" autocomplete="off" aria-label="Gewicht Satz ${j + 1}" value="${esc(s.w)}" placeholder="–"><span>kg</span></label>`
    : x.type === 'bw'
      ? `<div class="field"><button class="sign" data-act="sign" data-i="${i}" data-j="${j}" aria-label="${s.neg ? 'Unterstützung, tippen für Zusatzgewicht' : 'Zusatzgewicht, tippen für Unterstützung'}">${s.neg ? '−' : '+'}</button><input id="w-${i}-${j}" data-i="${i}" data-j="${j}" data-f="w" inputmode="decimal" autocomplete="off" aria-label="${s.neg ? 'Unterstützung' : 'Zusatzgewicht'} Satz ${j + 1}" value="${esc(s.w)}" placeholder="0"><span>kg</span></div>` : '';
  const rows = it.sets.map((s, j) => `<div class="set ${s.done ? 'ok' : ''}">
      <span class="n">${j + 1}</span>${wField(s, j)}
      <label class="field"><input id="r-${i}-${j}" data-i="${i}" data-j="${j}" data-f="r" inputmode="numeric" autocomplete="off" aria-label="${x.type === 'time' ? 'Sekunden' : 'Wiederholungen'} Satz ${j + 1}" value="${esc(s.r)}" placeholder="${lastReps(j)}"><span>${x.type === 'time' ? 's' : '×'}</span></label>
      <button class="check" data-act="check" data-i="${i}" data-j="${j}" aria-label="Satz ${j + 1} erledigt" aria-pressed="${s.done}">${ICON.check}</button>
    </div>`).join('');
  const cols = x.type === 'time' ? `<div class="cols"><span></span><span class="r">Sekunden</span><span></span></div>`
    : `<div class="cols"><span></span><span class="r">${x.type === 'bw' ? '± kg' : 'kg'}</span><span class="r">Wdh.</span><span></span></div>`;
  const warm = hasWarmup(it) ? `<div class="wsets"><div class="wset ${it.wu[0] ? 'ok' : ''}"><span class="n">W</span><span class="wv" id="wu-${i}">${warmupLabel(it)}</span><button class="check" data-act="wu" data-i="${i}" aria-label="Aufwärmsatz erledigt" aria-pressed="${!!it.wu[0]}">${ICON.check}</button></div></div>` : '';
  return `<article class="ex glass ${allDone ? 'done' : ''} ${it.removed ? 'gone' : ''}" data-card="${i}" data-swaphint="${sw ? esc(sw.id) : ''}">
    <div class="ex-head"><div class="nm"><h3>${esc(x.name)}</h3>
      ${it.swappedFrom || it.removed || x.personal ? `<div class="tags">${it.swappedFrom ? `<span class="tag">Heute statt ${esc(it.swappedFrom.name)}${it.swapBy && it.swapBy !== me ? ` · von ${esc(it.swapBy)}` : ''}</span>` : ''}${it.removed ? '<span class="tag warn">Nicht mehr im Plan</span>' : ''}${x.personal ? '<span class="tag">Nur ich</span>' : ''}</div>` : ''}</div>
      <span class="tgt">${it.sets.length}×${x.min}–${x.max}${unit}</span></div>
    ${sw ? `<div class="swaphint"><span><b>${esc(sw.person)}</b> hat heute ${esc(sw.data.fromName)} durch <b>${esc(sw.data.to.name)}</b> getauscht.</span><div class="btnrow"><button class="btn small primary" data-act="swap-follow" data-i="${i}" data-id="${esc(sw.id)}">Auch tauschen</button><button class="btn small ghost" data-act="swap-ignore" data-id="${esc(sw.id)}">Nein</button></div></div>` : ''}
    <div class="lastline"><span class="who">Du</span><span class="v">${mine && mine.type === x.type ? fmtSets(x.type, mine.sets) : 'noch kein Eintrag'}</span>${mine ? `<span class="r">${relDay(mine.ts)}${mine.deload ? ' · Deload' : ''}</span>` : ''}</div>
    ${theirs ? `<div class="lastline other"><span class="who">${esc(other)}</span><span class="v">${fmtSets(theirs.type, theirs.sets)}</span><span class="r">${relDay(theirs.ts)}</span></div>` : ''}
    ${hint ? `<div class="hint ${draft.deload ? 'dlhint' : pr.kind === 'down' || pr.kind === 'plateau' ? 'warnhint' : ''}">${esc(hint)}${pr.kind === 'plateau' && !draft.deload ? `<div class="btnrow"><button class="btn small" data-act="plateau-down" data-i="${i}">Heute −10 %</button></div><span class="small">Oder im Plan die Spanne anheben, z. B. ${x.min}–${x.max} → ${x.min + 2}–${x.max + 2}.</span>` : ''}</div>` : ''}
    ${mine && mine.note ? `<div class="small muted">Deine Notiz vom letzten Mal: ${esc(mine.note)}</div>` : ''}
    <details class="how"><summary>Ausführung & Video</summary><div class="body">
      ${x.cue ? `<p>${esc(x.cue)}</p>` : ''}
      ${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy">` : ''}
      <a class="vlink" href="${esc(videoUrl(x))}" target="_blank" rel="noopener">▶ ${x.video ? 'Video ansehen' : 'Videos auf YouTube suchen'}</a>
    </div></details>
    <div class="sets ${x.type}">${cols}${warm}${rows}</div>
    <div class="cardacts"><button class="addset" data-act="addset" data-i="${i}">+ Satz</button><button class="addset" data-act="delset" data-i="${i}" ${it.sets.length <= 1 ? 'disabled' : ''}>− Satz</button><span class="sp"></span>${it.removed ? '' : `<button class="addset" data-act="swap-open" data-i="${i}">${ICON.swap} Heute tauschen</button>`}</div>
    ${allDone ? `<div class="feel" role="group" aria-label="Wie war die Übung?"><span>Wie war's?</span>${Object.entries(FEEL).map(([k, v]) => `<button data-act="feel" data-i="${i}" data-v="${k}" aria-pressed="${it.feel === k}">${v}</button>`).join('')}</div>` : ''}
    <label class="note"><span>Notiz</span><textarea id="note-${i}" data-note="${i}" rows="2" placeholder="z. B. Schulter zwickt, nächstes Mal enger greifen">${esc(it.note)}</textarea></label>
  </article>`;
}
function rerenderCard(i) {
  const el = document.querySelector(`[data-card="${i}"]`);
  if (el) { const d = el.querySelector('details.how'); const open = d && d.open; el.outerHTML = exCard(draft.items[i], i); if (open) document.querySelector(`[data-card="${i}"] details.how`).open = true; }
  updateTrainHead();
}
function updateTrainHead() {
  const { done, tot } = workCount();
  const c = $('#tp-count'), b = $('#tp-bar'), bell = $('#tbell');
  if (c) c.textContent = trainCountText();
  if (b) b.style.width = (tot ? done / tot * 100 : 0) + '%';
  if (bell) bell.outerHTML = bellBtn('tbell');
}
function refreshTraining() {
  if (!draft || view !== 'training') return;
  if (document.querySelectorAll('[data-card]').length !== draft.items.length) { if (!document.activeElement || !$('#app').contains(document.activeElement)) render(); return; }
  document.querySelectorAll('[data-card]').forEach(el => {
    const i = +el.dataset.card, sw = pendingSwapFor(draft.items[i]);
    if ((el.dataset.swaphint || '') !== (sw ? sw.id : '') && !el.contains(document.activeElement)) rerenderCard(i);
  });
  updateTrainHead();
}
function collectEntries() {
  return draft.items.map(it => {
    const x = it.ex;
    const sets = it.sets.filter(s => s.done || int(s.r) > 0).map(s => {
      if (x.type === 'time') return { r: int(s.r) };
      const w = Math.abs(num(s.w)) * (x.type === 'bw' && s.neg ? -1 : 1);
      return { w: x.type === 'kg' ? num(s.w) : w, r: int(s.r) };
    }).filter(s => s.r > 0);
    return { exId: x.id, name: x.name, type: x.type, sets, note: (it.note || '').trim(), feel: it.feel || '' };
  }).filter(en => en.sets.length || en.note);
}
function sheet(inner) { $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`; }
function finishSheet() {
  const entries = collectEntries();
  const sets = entries.reduce((a, en) => a + en.sets.length, 0);
  const vol = entries.filter(en => en.type === 'kg').reduce((a, en) => a + en.sets.reduce((b, s) => b + s.w * s.r, 0), 0);
  const empty = draft.items.filter(it => !it.removed && !entries.some(en => en.exId === it.ex.id)).map(it => it.ex.name);
  sheet(`<h2>Training abschließen?</h2>
    <dl class="kv"><dt>Sätze</dt><dd>${sets}</dd><dt>Volumen</dt><dd>${fmtN(Math.round(vol))} kg</dd><dt>Dauer</dt><dd>${duration(draft.start, new Date().toISOString())}</dd></dl>
    ${empty.length ? `<div class="small muted">Ohne Eintrag: ${esc(empty.join(', '))}</div>` : ''}
    ${sets ? '' : '<div class="err">Trage mindestens einen Satz ein.</div>'}
    <div class="btnrow"><button class="btn primary" data-act="finish-yes" ${sets ? '' : 'disabled'}>Speichern</button><button class="btn ghost" data-act="mclose">Weiter trainieren</button></div>`);
}
function discardSheet() {
  sheet(`<h2>Training verwerfen?</h2><p class="muted" style="margin:0">Alle Einträge dieses Trainings gehen verloren. Deine Rotation bleibt unverändert.</p>
    <div class="btnrow"><button class="btn danger" data-act="discard-yes">Verwerfen</button><button class="btn ghost" data-act="mclose">Abbrechen</button></div>`);
}
function finishTraining() {
  const entries = collectEntries();
  if (!entries.some(en => en.sets.length)) return;
  const end = new Date().toISOString();
  const n = entries.reduce((a, en) => a + en.sets.length, 0);
  const swaps = draft.items.filter(it => it.swappedFrom).map(it => ({ fromId: it.swappedFrom.id, fromName: it.swappedFrom.name, toId: it.ex.id, toName: it.ex.name }));
  const summary = `${dl(draft.day)} ${draft.title}${draft.deload ? ' (Deload)' : ''} · ${n} Sätze · ` + entries.map(en => `${en.name}: ${fmtSets(en.type, en.sets)}${en.feel ? ` [${FEEL[en.feel]}]` : ''}${en.note ? ` (Notiz: ${en.note})` : ''}`).join(' | ');
  const e = addEvent('workout', { day: draft.day, title: draft.title, start: draft.start, end, deload: !!draft.deload, deloadSkipped: !!draft.deloadSkipped, swaps, entries }, summary);
  draft = null; saveDraft(); $('#modal').innerHTML = '';
  const imp = improvements(e);
  toast(imp.length ? `Training gespeichert · ${imp.length} ${imp.length === 1 ? 'Steigerung' : 'Steigerungen'}` : 'Training gespeichert');
  location.hash = '#start';
}
function applyToDraft(plan) {
  const old = draft.items, used = new Set(), res = [];
  plan.exercises.forEach(x => {
    let it = old.find(t => !used.has(t) && !t.swappedFrom && t.ex.id === x.id) || old.find(t => !used.has(t) && t.swappedFrom && t.swappedFrom.id === x.id);
    if (it) {
      used.add(it);
      if (!it.swappedFrom) it.ex = clone(x);
      const target = draft.deload ? Math.ceil(x.sets / 2) : x.sets;
      while (it.sets.length < target) { const l = it.sets[it.sets.length - 1]; it.sets.push({ w: l ? l.w : '', neg: l ? l.neg : false, r: '', done: false }); }
      it.removed = false; res.push(it);
    } else res.push(newItem(clone(x), draft.deload));
  });
  old.forEach((t, i) => {
    if (used.has(t) || !hasEntries(t)) return;
    t.removed = true;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) { const k = res.indexOf(old[j]); if (k >= 0) { pos = k + 1; break; } }
    res.splice(pos, 0, t);
  });
  draft.items = res; draft.title = plan.title; saveDraft();
}
function knownExercises() {
  const s = st(), map = new Map();
  PEOPLE.forEach(p => DAYS.forEach(d => s.plans[p][d].exercises.forEach(x => { if (!map.has(x.name.toLowerCase())) map.set(x.name.toLowerCase(), { id: x.id, name: x.name, type: x.type }); })));
  Object.entries(s.exInfo).forEach(([id, v]) => { if (!map.has(v.name.toLowerCase())) map.set(v.name.toLowerCase(), { id, name: v.name, type: v.type }); });
  return map;
}
function swapForm(i) {
  const it = draft.items[i], x = it.ex;
  const names = [...knownExercises().values()].map(v => v.name).filter(n => n !== x.name).sort((a, b) => a.localeCompare(b, 'de'));
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form" id="swapform" data-i="${i}" novalidate>
    ${sheetHead(`${esc(dl(draft.day))} · ${esc(x.name)}`, 'Heute tauschen')}
    <h2>Heute tauschen</h2>
    <p class="help" style="margin:0">Ersetzt <b>${esc(x.name)}</b> nur in diesem Training. Dein Plan bleibt unverändert, die Ersatzübung bekommt ihren eigenen Verlauf.</p>
    <label>Ersatzübung<input class="inp" id="sw-name" name="name" list="sw-list" maxlength="60" autocomplete="off" required placeholder="z. B. Brustpresse Maschine"><datalist id="sw-list">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist></label>
    <label>Art<select id="sw-type" name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="grid3"><label>Sätze<input class="inp" id="sw-sets" name="sets" inputmode="numeric" value="${x.sets}"></label><label>von<input class="inp" id="sw-min" name="min" inputmode="numeric" value="${x.min}"></label><label>bis<input class="inp" id="sw-max" name="max" inputmode="numeric" value="${x.max}"></label></div>
    <fieldset class="radios"><legend>Für wen?</legend>
      <label class="chk"><input type="radio" name="who" value="both" checked><span>Für uns beide heute<small>${esc(partner())} sieht den Tausch in seinem heutigen Training für ${esc(dl(draft.day))}.</small></span></label>
      <label class="chk"><input type="radio" name="who" value="me"><span>Nur für mich</span></label>
    </fieldset>
    <div class="err" id="sw-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">Tauschen</button></div>
  </form></div>`;
  setTimeout(() => { const n = $('#sw-name'); if (n) n.focus(); }, 50);
}
function doSwap(i, x, from, by, shared) {
  const it = draft.items[i];
  const ni = newItem(x, draft.deload); ni.swappedFrom = from; ni.swapBy = by;
  if (hasEntries(it)) draft.items.splice(i + 1, 0, ni); else draft.items.splice(i, 1, ni);
  saveDraft();
  if (shared) addEvent('swap', { day: draft.day, date: todayStr(), fromId: from.id, fromName: from.name, to: x }, `${dl(draft.day)}: ${from.name} heute durch ${x.name} ersetzt (für beide)`);
}
function submitSwap(form) {
  const f = new FormData(form), i = +form.dataset.i, it = draft.items[i];
  const err = m => { const e = $('#sw-err'); e.textContent = m; e.hidden = false; };
  const name = String(f.get('name') || '').trim();
  const sets = int(f.get('sets')), min = int(f.get('min')), max = int(f.get('max'));
  if (!name) return err('Bitte gib die Ersatzübung ein.');
  if (!sets || sets > 10 || !min || !max || min > max) return err('Bitte prüfe Sätze und Spanne.');
  const known = knownExercises().get(name.toLowerCase());
  const type = known ? known.type : f.get('type');
  const id = known ? known.id : 's-' + slug(name);
  const from = it.swappedFrom || { id: it.ex.id, name: it.ex.name };
  if (id === it.ex.id || id === from.id) return err('Das ist dieselbe Übung.');
  const x = cleanEx({ id, name: known ? known.name : name, type, sets, min, max, step: type === 'time' ? 0 : 2.5, warmup: false });
  $('#modal').innerHTML = '';
  doSwap(i, x, from, cfg.me, f.get('who') === 'both');
  render();
  toast(f.get('who') === 'both' ? `Getauscht. ${partner()} sieht den Tausch.` : 'Getauscht');
}

/* ---------- Verlauf ---------- */
function viewVerlauf() {
  const seg = `<div class="seg" role="group" aria-label="Ansicht">${[['aktiv', 'Aktivität'], ['uebungen', 'Übungen'], ['kalender', 'Kalender']].map(([k, v]) => `<button data-act="vtab" data-v="${k}" aria-pressed="${verlaufTab === k}">${v}</button>`).join('')}</div>`;
  const s = st(), me = cfg.me, other = partner();
  if (verlaufTab === 'aktiv') return seg + `<section class="card" style="padding:4px 16px">${s.feed.length ? `<div class="feed">${s.feed.map(feedItem).join('')}</div>` : '<div class="empty">Noch keine Einträge. Starte dein erstes Training auf der Startseite.</div>'}</section>`;
  if (verlaufTab === 'kalender') return seg + viewCalendar();
  const inPlan = new Set();
  const row = x => {
    inPlan.add(x.id);
    const a = lastAny(me, x.id), b = lastAny(other, x.id);
    return `<a class="exrow" href="#uebung:${encodeURIComponent(x.id)}"><div class="n"><b>${esc(x.name)}</b><span class="small muted">${TYPE_LABEL[x.type]}${x.personal ? ' · nur ich' : ''}</span></div>
      <div class="vals"><span>${a ? metricLabel(a.type, a.sets) : '–'}</span><span class="r">${b ? metricLabel(b.type, b.sets) : '–'}</span></div><span class="chev">›</span></a>`;
  };
  const days = DAYS.map(d => `<div class="sec-title"><h2 style="display:flex;gap:8px;align-items:center">${dayChip(d)} ${esc(s.plans[me][d].title)}</h2></div><section class="card" style="padding:4px 16px">${s.plans[me][d].exercises.map(row).join('') || '<div class="empty">Keine Übungen</div>'}</section>`).join('');
  const archived = Object.keys(s.exInfo).filter(id => !inPlan.has(id) && (s.hist[me][id] || s.hist[other][id]));
  const legend = `<div class="legend"><span>oben: du</span><span>unten: ${esc(other)}</span><span>· letzte Einheit</span></div>`;
  return seg + legend + days + (archived.length ? `<div class="sec-title"><h2>Archiv</h2></div><div class="small muted" style="margin:0 2px">Ausgetauschte, entfernte oder spontan getauschte Übungen. Ihr Verlauf bleibt erhalten.</div><section class="card" style="padding:4px 16px">${archived.map(id => row({ id, ...s.exInfo[id] })).join('')}</section>` : '');
}
function viewCalendar() {
  const s = st(), first = new Date(cal.y, cal.m, 1), offset = (first.getDay() + 6) % 7, daysIn = new Date(cal.y, cal.m + 1, 0).getDate();
  const map = {}; const add = (k, o) => (map[k] = map[k] || []).push(o);
  s.workouts.forEach(w => add(dateKey(w.ts), { p: w.person, day: w.data.day, kind: w.data.deload ? 'deload' : 'workout', e: w }));
  s.skips.forEach(e => add(dateKey(e.ts), { p: e.person, day: e.data.day, kind: 'skip', e }));
  const today = todayStr();
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cd empty"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const k = `${cal.y}-${pad2(cal.m + 1)}-${pad2(d)}`;
    const items = (map[k] || []).sort((a, b) => PEOPLE.indexOf(a.p) - PEOPLE.indexOf(b.p));
    cells += `<button class="cd ${k === today ? 'today' : ''} ${k === cal.sel ? 'sel' : ''}" data-act="calday" data-v="${k}" aria-label="${d}. ${items.length ? items.length + ' Einträge' : 'kein Eintrag'}"><span class="dn">${d}</span><span class="marks">${items.map(o => `<i class="cm t-${DAY_TONE[o.day]} ${o.kind}" title="${esc(o.p)} · ${esc(dl(o.day, o.p))}">${esc(o.p[0])}</i>`).join('')}</span></button>`;
  }
  const sel = (map[cal.sel] || []).map(o => o.e).sort((a, b) => b.ts.localeCompare(a.ts));
  const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `<section class="card cal">
      <div class="calnav"><button class="iconbtn" data-act="calmove" data-v="-1" aria-label="Voriger Monat">${ICON.left}</button><b>${title}</b><button class="iconbtn" data-act="calmove" data-v="1" aria-label="Nächster Monat">${ICON.right}</button></div>
      <div class="calgrid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div>
      <div class="legend">${DAYS.map(d => `<span class="ln"><i class="cm t-${DAY_TONE[d]}">M</i>${esc(dl(d))}</span>`).join('')}<span class="ln"><i class="cm t-y skip">R</i>übersprungen</span><span class="ln"><i class="cm t-y deload">M</i>Deload</span></div>
    </section>
    <div class="sec-title"><h2>${new Date(cal.sel + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div>
    <section class="card" style="padding:4px 16px">${sel.length ? `<div class="feed">${sel.map(feedItem).join('')}</div>` : '<div class="empty">An diesem Tag hat niemand trainiert.</div>'}</section>`;
}
function chartSvg(series, label) {
  const pts = series.flatMap(sr => sr.points);
  if (!pts.length) return '<div class="empty">Noch keine Daten.</div>';
  const W = 340, H = 170, L = 38, R = 14, T = 16, B = 26;
  const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
  let v0 = Math.min(...pts.map(p => p.v)), v1 = Math.max(...pts.map(p => p.v));
  if (v0 === v1) { v0 -= 2; v1 += 2; }
  const raw = (v1 - v0) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const stepV = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || 10 * mag;
  v0 = Math.floor(v0 / stepV) * stepV; if (pts.every(p => p.v >= 0)) v0 = Math.max(0, v0);
  v1 = Math.ceil(v1 / stepV) * stepV; if (v1 === v0) v1 = v0 + stepV;
  const ticks = Math.round((v1 - v0) / stepV);
  const X = t => t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
  const Y = v => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  let g = '';
  for (let k = 0; k <= ticks; k++) {
    const v = v0 + stepV * k;
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtN(v)}</text>`;
  }
  const dlb = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  g += `<text x="${L}" y="${H - 6}">${dlb(t0)}</text>${t1 !== t0 ? `<text x="${W - R}" y="${H - 6}" text-anchor="end">${dlb(t1)}</text>` : ''}`;
  series.forEach(sr => {
    if (!sr.points.length) return;
    g += `<polyline fill="none" stroke="${sr.color}" stroke-width="2.5" ${sr.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round" points="${sr.points.map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}"/>`;
    sr.points.forEach((p, i) => { const last = i === sr.points.length - 1; g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${last ? 4.5 : 3}" fill="${last ? sr.color : '#000'}" stroke="${sr.color}" stroke-width="2"/>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${esc(label)}">${g}</svg>`;
}
const LEG = (dash) => `<svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke="#fff" stroke-width="3" ${dash ? 'stroke-dasharray="4 3"' : ''}/></svg>`;
function viewExercise(id) {
  const s = st(), me = cfg.me, other = partner();
  const info = s.exInfo[id];
  if (!info) return '<div class="empty">Diese Übung gibt es nicht.</div>';
  const day = exerciseDay(id);
  const def = DAYS.map(d => s.plans[me][d].exercises.find(x => x.id === id)).find(Boolean) || DAYS.map(d => s.plans[other][d].exercises.find(x => x.id === id)).find(Boolean);
  const type = (def && def.type) || info.type;
  const sessionsOf = p => normalSessions(p, id, type);
  const weighted = type === 'kg' || (type === 'bw' && [me, other].some(p => sessionsOf(p).some(h => usesWeight(h.type, h.sets))));
  const value = h => type === 'time' ? Math.max(...h.sets.map(x => x.r)) : weighted ? workW(h.sets) : sum(h.sets.map(x => x.r));
  const label = type === 'time' ? 'Längster Satz (Sek.)' : type === 'kg' ? 'Schwerster Satz (kg)' : weighted ? 'Zusatzgewicht (kg)' : 'Wiederholungen gesamt';
  const series = [me, other].map(p => ({ p, color: p === me ? '#fff' : 'rgba(255,255,255,.75)', dash: p !== me, points: sessionsOf(p).filter(h => h.sets.length).map(h => ({ t: +new Date(h.ts), v: value(h) })) }));
  const best = p => { const h = sessionsOf(p).filter(x => x.sets.length); if (!h.length) return '–'; const b = h.reduce((a, x) => score(x.type, x.sets) > score(a.type, a.sets) ? x : a); return metricLabel(b.type, b.sets); };
  const sessions = [...(s.hist[me][id] || []), ...(s.hist[other][id] || [])].sort((a, b) => b.ts.localeCompare(a.ts));
  return `<div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:center">${day ? dayChip(day, me, 'lg') : '<span class="tag" style="margin:0">Archiv</span>'}<span class="mono muted small">${TYPE_LABEL[type]}${def ? ` · ${def.sets}×${def.min}–${def.max}${type === 'time' ? ' s' : ''}` : ''}</span></div>
      <h1 style="margin:0;font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.1">${esc((def && def.name) || info.name)}</h1>
      ${def && def.cue ? `<span class="muted" style="font-size:14px">${esc(def.cue)}</span>` : ''}
      ${def && def.image ? `<img src="${esc(def.image)}" alt="${esc(def.name)}" loading="lazy" style="border-radius:14px">` : ''}
      <a class="vlink" href="${esc(videoUrl(def || { name: info.name }))}" target="_blank" rel="noopener">▶ ${def && def.video ? 'Video ansehen' : 'Videos auf YouTube suchen'}</a>
    </div>
    <div class="stat2">
      <div class="card"><span class="who">${avatar(me, 24)}Du</span><span class="val">${best(me)}</span><span class="eyebrow">Bestwert</span></div>
      <div class="card"><span class="who">${avatar(other, 24)}${esc(other)}</span><span class="val">${best(other)}</span><span class="eyebrow">Bestwert</span></div>
    </div>
    <section class="card chart"><div class="rowbetween"><b>${label}</b><div class="legend"><span class="ln">${LEG(false)}Du</span><span class="ln">${LEG(true)}${esc(other)}</span></div></div>
      ${chartSvg(series, label)}<span class="small muted">ohne Deload-Einheiten</span></section>
    <div class="sec-title"><h2>Alle Einheiten</h2></div>
    <section class="card">${sessions.length ? sessions.map(h => `<div class="sess"><div class="top"><span class="who" style="color:var(--fg)">${h.person === me ? 'Du' : esc(h.person)}</span><span class="mono">${fmtDate(h.ts)}${h.deload ? ' · Deload' : ''}${h.feel ? ' · ' + FEEL[h.feel] : ''}</span></div>
      <div class="v">${fmtSets(h.type, h.sets)}</div>${h.note ? `<p class="quote muted">${esc(h.note)}</p>` : ''}</div>`).join('') : '<div class="empty">Noch nicht trainiert.</div>'}</section>`;
}
function viewWorkout(id) {
  const e = st().workouts.find(w => w.id === id);
  if (!e) return '<div class="empty">Training nicht gefunden.</div>';
  const d = e.data, imp = improvements(e);
  return `<div style="display:flex;flex-direction:column;gap:8px"><span class="who">${avatar(e.person, 28)}${e.person === cfg.me ? 'Du' : esc(e.person)}</span>
      <h1 class="kurz" style="font-size:64px">${esc(dl(d.day, e.person))}</h1><div style="font-size:18px;font-weight:600">${esc(d.title)}</div>
      <div class="mono muted small">${fmtDate(e.ts)}, ${fmtTime(d.start)}–${fmtTime(d.end)} · ${duration(d.start, d.end)}${d.deload ? ' · Deload' : ''}</div>
      ${imp.length ? `<div class="chips">${imp.map(i => `<span class="chip ${i.pr ? 'pr' : ''}">${esc(i.name)} ${esc(i.label)}${i.pr ? ' · Rekord' : ''}</span>`).join('')}</div>` : ''}</div>
    ${d.edited ? `<span class="small muted">Nachträglich bearbeitet am ${fmtDate(d.edited)}, ${fmtTime(d.edited)}</span>` : ''}
    <section class="card">${d.entries.map(en => `<a class="sess" href="#uebung:${encodeURIComponent(en.exId)}"><div class="top"><b style="color:var(--fg)">${esc(en.name)}</b><span class="mono">${en.sets.length} ${en.sets.length === 1 ? 'Satz' : 'Sätze'}${en.feel ? ' · ' + FEEL[en.feel] : ''}</span></div>
      <div class="v">${fmtSets(en.type, en.sets)}</div>${en.note ? `<p class="quote muted">${esc(en.note)}</p>` : ''}</a>`).join('')}</section>
    ${e.person === cfg.me ? (wDelAsk === e.id
      ? `<section class="card"><b>Training endgültig löschen?</b><span class="small muted">Es verschwindet bei dir und bei ${esc(partner())} aus Verlauf, Statistik und Rotation.</span><div class="btnrow"><button class="btn small danger" data-act="w-del-yes" data-id="${esc(e.id)}">Löschen</button><button class="btn small ghost" data-act="w-del-no">Abbrechen</button></div></section>`
      : `<div class="btnrow"><button class="btn glass" data-act="w-edit" data-id="${esc(e.id)}">Bearbeiten</button><button class="btn ghost danger-t" data-act="w-del" data-id="${esc(e.id)}">Löschen</button></div>`) : ''}`;
}
/* ---------- Abgeschlossenes Training bearbeiten ---------- */
let wedit = null, wDelAsk = null;
function workoutForm() {
  const w = st().workouts.find(x => x.id === wedit.id); if (!w) return;
  const wfmt = (type, v) => typeof v === 'string' ? esc(v) : type === 'kg' ? fmtIn(v) : v ? (v < 0 ? '-' : '') + fmtIn(v) : '';
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form" id="wform" novalidate>
    ${sheetHead(`${esc(dl(w.data.day))} · ${fmtDate(w.ts)}`, 'Training bearbeiten')}
    <h2>Training bearbeiten</h2>
    <p class="help" style="margin:0">Änderungen gelten auch für Steigerung und Statistik. ${esc(partner())} sieht das korrigierte Training.</p>
    ${wedit.entries.map((en, i) => `<section class="card wed">
      <div class="rowbetween"><b>${esc(en.name)}</b><span class="mono muted small">${en.type === 'time' ? 'Sekunden' : en.type === 'bw' ? '± kg · Wdh.' : 'kg · Wdh.'}</span></div>
      ${en.sets.map((st2, j) => `<div class="wrow"><span class="n mono">${j + 1}</span>
        ${en.type === 'time' ? '' : `<input class="inp mono" data-we="w" data-i="${i}" data-j="${j}" inputmode="${en.type === 'bw' ? 'text' : 'decimal'}" value="${wfmt(en.type, st2.w)}" placeholder="${en.type === 'bw' ? '0' : 'kg'}" aria-label="${esc(en.name)} Satz ${j + 1} Gewicht">`}
        <input class="inp mono" data-we="r" data-i="${i}" data-j="${j}" inputmode="numeric" value="${st2.r || ''}" placeholder="${en.type === 'time' ? 'Sek.' : 'Wdh.'}" aria-label="${esc(en.name)} Satz ${j + 1} ${en.type === 'time' ? 'Sekunden' : 'Wiederholungen'}"></div>`).join('')}
      <div class="btnrow" style="gap:18px"><button type="button" class="addset" data-act="we-add" data-i="${i}">+ Satz</button><button type="button" class="addset" data-act="we-del" data-i="${i}">− Satz</button></div>
      <label>Notiz<textarea data-we="note" data-i="${i}" rows="2" maxlength="500">${esc(en.note || '')}</textarea></label>
    </section>`).join('')}
    <div class="err" id="we-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">Änderungen speichern</button></div>
  </form></div>`;
}
function readWorkoutForm() {
  document.querySelectorAll('#wform [data-we]').forEach(el => {
    const en = wedit.entries[+el.dataset.i];
    if (el.dataset.we === 'note') { en.note = el.value; return; }
    const set = en.sets[+el.dataset.j];
    if (el.dataset.we === 'r') set.r = el.value;
    else set.w = el.value;
  });
}
function saveWorkoutEdit() {
  readWorkoutForm();
  const w = st().workouts.find(x => x.id === wedit.id); if (!w) return;
  const entries = wedit.entries.map(en => ({
    exId: en.exId, name: en.name, type: en.type, feel: en.feel || '', note: String(en.note || '').trim().slice(0, 500),
    sets: en.sets.map(x => en.type === 'time' ? { r: int(x.r) } : { w: en.type === 'kg' ? Math.abs(num(x.w)) : num(x.w), r: int(x.r) }).filter(x => x.r > 0)
  })).filter(en => en.sets.length || en.note);
  if (!entries.some(en => en.sets.length)) { const e = $('#we-err'); e.textContent = 'Mindestens ein Satz muss bleiben. Zum Entfernen des ganzen Trainings nutze „Löschen“.'; e.hidden = false; return; }
  const before = JSON.stringify(w.data.entries.map(en => [en.exId, en.sets, en.note || ''])), after = JSON.stringify(entries.map(en => [en.exId, en.sets, en.note]));
  if (before === after) { $('#modal').innerHTML = ''; wedit = null; return; }
  addEvent('workout_edit', { ref: w.id, entries }, `${dl(w.data.day)} vom ${fmtDate(w.ts)} bearbeitet · ` + entries.map(en => `${en.name}: ${fmtSets(en.type, en.sets)}${en.note ? ` (Notiz: ${en.note})` : ''}`).join(' | '));
  $('#modal').innerHTML = ''; wedit = null; toast('Training geändert'); render();
}

/* ---------- Profil ---------- */
function viewProfile(p) {
  const s = st(), own = p === cfg.me;
  const ws = s.workouts.filter(w => w.person === p);
  const wk = weekStart();
  const counts = DAYS.map(d => ws.filter(w => w.data.day === d).length);
  const tot = ws.length;
  const bw = s.bw[p], lb = bw[bw.length - 1], pb = bw[bw.length - 2];
  const since = s.first[p];
  const meta = `${since ? 'Trainiert seit ' + new Date(since).toLocaleDateString('de-DE') : 'Noch keine Einträge'} · als Nächstes ${esc(dl(nextDay(p), p))}`;
  const ring = `<div class="pf-ring">${avatar(p, 114)}${own ? `<label class="pf-cam" aria-label="Profilbild ändern">${ICON.cam.replace('width="22" height="22"', 'width="16" height="16"')}<input type="file" id="av-file" accept="image/*" hidden></label>` : ''}</div>`;
  const bar = `<section class="card"><div class="rowbetween"><span class="eyebrow">Trainings nach Tag</span><span class="mono muted small">${tot}</span></div>
      <div class="daybar">${tot ? DAYS.map((d, i) => counts[i] ? `<i class="t-${DAY_TONE[d]}" style="flex:${counts[i]}"></i>` : '').join('') : ''}</div>
      <div class="legend mono">${DAYS.map((d, i) => `<span>${esc(dl(d, p))} ${counts[i]}</span>`).join('')}</div></section>`;
  if (own) {
    return `<div class="pf">${ring}<h1 class="display">${esc(p)}</h1><span class="mono muted small">${meta}</span></div>
      <div class="stat2">
        <div class="card"><span class="val">${tot}</span><span class="eyebrow">Trainings</span></div>
        <a class="card" href="#gewicht"><span class="val">${lb ? fmtN(lb.kg) + '<small> kg</small>' : '–'}</span><span class="eyebrow">Körpergewicht${pb ? ` · ${lb.kg - pb.kg >= 0 ? '+' : '−'}${fmtN(Math.abs(lb.kg - pb.kg))}` : ''}</span></a>
      </div>
      ${bar}
      <a class="vaultcard glass" href="#vault"><span class="ic">${ICON.lock}</span><span style="flex:1;display:flex;flex-direction:column;gap:2px"><b>Vault</b><span class="small muted">${vmeta() ? 'Private Bilder · nur für dich' : 'Private Fortschrittsbilder · Code festlegen'}</span></span>${ICON.right}</a>`;
  }
  const recent = ws.slice().reverse().slice(0, 3);
  return `<div class="pf">${ring}<h1 class="display">${esc(p)}</h1><span class="mono muted small">${meta}</span></div>
    <div class="stat2">
      <div class="card"><span class="val">${tot}</span><span class="eyebrow">Trainings</span></div>
      <div class="card"><span class="val">${ws.filter(w => new Date(w.ts) >= wk).length}<small> / 3</small></span><span class="eyebrow">Diese Woche</span></div>
    </div>
    ${bar}
    ${recent.length ? `<section class="card" style="padding:4px 16px"><div class="feed">${recent.map(feedItem).join('')}</div></section>` : ''}`;
}
async function setAvatar(file) {
  try {
    let q = 0.8, data = '';
    const c = await resizeImage(file, 220, true);
    do { data = c.toDataURL('image/jpeg', q); q -= 0.1; } while (data.length > 40000 && q > 0.3);
    if (data.length > 40000) { toast('Das Bild ist zu groß. Bitte ein anderes wählen.'); return; }
    addEvent('avatar', { img: data }, 'Profilbild aktualisiert');
    toast('Profilbild gespeichert'); render();
  } catch (e) { toast('Das Bild konnte nicht gelesen werden.'); }
}

/* ---------- Vault ---------- */
const PIN_TITLE = { unlock: 'Gib deinen Code ein', set1: 'Lege einen 4-stelligen Code fest', set2: 'Code zur Bestätigung wiederholen', old: 'Aktuellen Code eingeben', new1: 'Neuen 4-stelligen Code eingeben', new2: 'Neuen Code wiederholen', import: 'Code des Backups eingeben' };
function pinPad() {
  const mode = VAULT.mode;
  const dots = [0, 1, 2, 3].map(i => `<i class="${i < VAULT.pin.length ? 'on' : ''}"></i>`).join('');
  const k = n => `<button class="key" data-act="pin" data-v="${n}">${n}</button>`;
  return `<div class="lock"><span class="ic glass">${ICON.lock}</span><h1 class="display" style="font-size:40px">Vault</h1>
    <span class="muted">${PIN_TITLE[mode]}</span>
    <div class="pins ${VAULT.bad ? 'bad' : ''}" aria-label="${VAULT.pin.length} von 4 Ziffern eingegeben">${dots}</div>
    ${VAULT.msg ? `<span class="${/Falsch|stimmen|Zu viele/.test(VAULT.msg) ? 'err' : 'muted'}">${esc(VAULT.msg)}</span>` : ''}
    <div class="pad">${k(1)}${k(2)}${k(3)}${k(4)}${k(5)}${k(6)}${k(7)}${k(8)}${k(9)}<a class="key plain" href="#${mode === 'old' || mode.startsWith('new') ? 'einstellungen' : 'profil'}">Abbrechen</a>${k(0)}<button class="key plain" data-act="pin-del" aria-label="Letzte Ziffer löschen">${ICON.del}</button></div>
    ${mode === 'set1' && !VAULT.restore ? `<a class="lnk" href="#vault-wiederherstellen" style="font-weight:600">Schon einen Vault? Wiederherstellen</a>` : ''}
    <span class="small muted" style="max-width:300px">${VAULT.restore ? `Schlüssel passt. Lege jetzt den Code für dieses Handy fest${VAULT.restore.n ? `, danach werden ${VAULT.restore.n} ${VAULT.restore.n === 1 ? 'Bild' : 'Bilder'} geladen` : ''}.` : mode === 'set1' || mode === 'set2' ? 'Den Code brauchst du bei jedem Öffnen auf diesem Handy.' : 'Nur mit deinem Code lesbar. Niemand sonst sieht deine Bilder.'}</span></div>`;
}
function viewRecoveryKey() {
  return `<div class="lock"><span class="ic glass">${ICON.key}</span><h1 class="display" style="font-size:26px">Dein Wiederherstellungs&shy;schlüssel</h1>
    <span class="muted" style="max-width:330px">Damit holst du deine Bilder auf ein neues Handy. Speichere ihn jetzt an einem sicheren Ort, z. B. in Apple Passwörter oder einer gesperrten Notiz.</span>
    <div class="rkey mono" id="rk-show">${VAULT.showKey.split('-').map(g => `<span>${g}</span>`).join('')}</div>
    <button class="btn glass" data-act="rk-copy" style="min-width:200px">Kopieren</button>
    <button class="btn primary" data-act="rk-done" style="min-width:260px">Ich habe ihn gespeichert</button>
    <span class="small muted" style="max-width:320px">Ohne diesen Schlüssel lassen sich die Bilder bei einem Handywechsel nicht wiederherstellen. Gib ihn niemandem, auch nicht ${esc(partner())}.</span></div>`;
}
function viewRestore() {
  return `<div class="form">
    <h1 class="display" style="font-size:30px">Vault wieder&shy;herstellen</h1>
    <p class="muted" style="margin:0">Gib deinen Wiederherstellungsschlüssel ein. Danach legst du einen Code für dieses Handy fest und deine Bilder werden aus der Tabelle geladen.</p>
    <label>Wiederherstellungsschlüssel<textarea class="inp mono" id="rk-in" rows="2" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></textarea></label>
    <div class="err" id="rk-err" hidden></div>
    <button class="btn primary" id="rk-go" data-act="rk-restore">Weiter</button>
  </div>`;
}
function viewVault() {
  if (!vmeta() && !VAULT.importData) { if (VAULT.mode !== 'set2') VAULT.mode = 'set1'; return pinPad(); }
  if (!VAULT.key || VAULT.mode !== 'unlock') return pinPad();
  if (VAULT.showKey) return viewRecoveryKey();
  const list = VAULT.entries || [];
  const items = list.map(e => `<div class="en">
      <div class="rowbetween"><b class="mono" style="font-size:14px">${fmtLong(e.date + 'T12:00')}</b><span class="mono muted small">${relDay(e.date + 'T12:00')}</span></div>
      <div class="photo"><img data-vimg="${esc(e.id)}" alt="Fortschrittsbild vom ${esc(e.date)}">${e.bw ? `<span class="bwtag">${fmtN(e.bw)} kg</span>` : ''}</div>
      ${e.note ? `<p class="quote">${esc(e.note)}</p>` : ''}
      ${VAULT.del === e.id ? `<div class="confirm"><b>Bild endgültig löschen?</b><div class="btnrow"><button class="btn small danger" data-act="v-del-yes" data-id="${esc(e.id)}">Löschen</button><button class="btn small ghost" data-act="v-del-no">Abbrechen</button></div></div>` : `<button class="addset" data-act="v-del" data-id="${esc(e.id)}" style="align-self:flex-start;color:var(--dim)">Löschen</button>`}
    </div>`).join('');
  return `<div class="rowbetween" style="align-items:flex-end"><div style="display:flex;flex-direction:column;gap:6px"><h1 class="display" style="font-size:40px">Vault</h1><span class="mono muted small">${list.length} ${list.length === 1 ? 'Bild' : 'Bilder'}${list.length ? ' · seit ' + new Date(list[list.length - 1].date + 'T12:00').toLocaleDateString('de-DE') : ''}</span></div><a class="btn primary small" href="#vault-neu">${ICON.plus} Foto</a></div>
    ${VAULT.msg ? `<span class="muted small">${esc(VAULT.msg)}</span>` : ''}
    ${list.length ? `<div class="tl">${items}</div>` : `<section class="card"><div class="empty">Noch keine Bilder. Mit „Foto“ legst du dein erstes Fortschrittsbild an. Tipp: gleiche Stelle, gleiches Licht, gleiche Pose.</div></section>`}`;
}
function viewVaultNew() {
  const bw = st().bw[cfg.me]; const lb = bw[bw.length - 1];
  return `<form class="form" id="vaultform" novalidate>
    <h1 class="display" style="font-size:30px">Neuer Eintrag</h1>
    <div class="pickphoto glass">${VAULT.photoUrl ? `<img src="${VAULT.photoUrl}" alt="Gewähltes Foto">` : `${ICON.cam}<b>Foto aufnehmen oder auswählen</b><span class="small muted">Tipp: gleiche Stelle, gleiches Licht, gleiche Pose</span>`}
      <input type="file" id="vn-file" accept="image/*" aria-label="Foto aufnehmen oder auswählen"></div>
    <div class="grid2"><label>Datum<input class="inp mono" type="date" id="vn-date" name="date" value="${todayStr()}" max="${todayStr()}"></label>
      <label>Gewicht (kg)<input class="inp mono" id="vn-bw" name="bw" inputmode="decimal" value="${lb ? fmtIn(lb.kg) : ''}" placeholder="optional"></label></div>
    <label>Notiz<textarea id="vn-note" name="note" rows="3" maxlength="2000" placeholder="z. B. Pump nach B&T, Brust oben voller"></textarea></label>
    <div class="err" id="vn-err" hidden></div>
    <button class="btn primary" id="vn-save" type="submit">Im Vault speichern</button>
    <span class="small muted" style="text-align:center">Wird verschlüsselt gespeichert und in eurer Tabelle gesichert. Lesbar nur mit deinem Schlüssel, ${esc(partner())} sieht es nie.</span>
  </form>`;
}

/* ---------- Körpergewicht ---------- */
function viewBodyweight() {
  const list = st().bw[cfg.me];
  const pts = list.map(b => ({ t: +new Date(b.ts), v: b.kg }));
  return `<h1 class="display" style="font-size:30px">Körpergewicht</h1>
    <section class="card form">
      <label>Neuer Eintrag<div class="bwin" style="display:flex;gap:8px"><span class="field" style="flex:1"><input id="bw-in" inputmode="decimal" autocomplete="off" placeholder="z. B. 82,4" aria-label="Körpergewicht in kg"><span>kg</span></span><button class="btn small primary" data-act="bw-save">Eintragen</button></div></label>
      <span class="help">Am besten einmal pro Woche morgens vor dem Frühstück. Dein Körpergewicht siehst nur du in der App.</span>
    </section>
    <section class="card chart"><b>Verlauf (kg)</b>${chartSvg([{ color: '#fff', points: pts }], 'Körpergewicht')}</section>
    <section class="card">${list.length ? list.slice().reverse().map(b => `<div class="sess"><div class="top"><span class="mono">${fmtDate(b.ts)}</span><span class="mono" style="color:var(--fg)">${fmtN(b.kg)} kg</span></div></div>`).join('') : '<div class="empty">Noch kein Eintrag.</div>'}</section>`;
}

/* ---------- Notizen ---------- */
function viewNotes() {
  const items = [];
  st().workouts.forEach(w => (w.data.entries || []).forEach(en => { if (en.note) items.push({ w, en }); }));
  items.reverse();
  const shown = items.filter(x => notesFilter === 'Alle' || x.w.person === notesFilter);
  const seg = `<div class="seg" role="group" aria-label="Filter">${['Alle', ...PEOPLE].map(f => `<button data-act="nfilter" data-v="${f}" aria-pressed="${notesFilter === f}">${f === cfg.me ? 'Meine' : f}</button>`).join('')}</div>`;
  return seg + (shown.length ? shown.map(({ w, en }) => `<a class="card" href="#uebung:${encodeURIComponent(en.exId)}" style="text-decoration:none;color:var(--fg);gap:8px">
      <div style="display:flex;align-items:center;gap:8px">${dayChip(w.data.day, w.person)}<b style="flex:1;min-width:0">${esc(en.name)}</b><span class="mono muted small">${fmtDate(w.ts)}</span></div>
      <p class="quote" style="font-size:16px">${esc(en.note)}</p>
      <div class="who small muted">${avatar(w.person, 20)}${w.person === cfg.me ? 'Du' : esc(w.person)} · <span class="mono">${fmtSets(en.type, en.sets)}</span></div></a>`).join('')
    : '<section class="card"><div class="empty">Noch keine kommentierten Übungen. Im Training kannst du zu jeder Übung eine Notiz schreiben.</div></section>');
}

/* ---------- Planänderungen (Glocke) ---------- */
function viewBell() {
  const list = bellItems(), other = partner(), s = st();
  const label = { open: 'Neu', dismissed: 'Ausgeblendet', diverged: 'Weicht ab' };
  const items = list.map(x => {
    const c = x.pc, inDraft = draft && draft.day === x.day;
    return `<section class="card" style="gap:14px">
      <div style="display:flex;align-items:center;gap:10px">${avatar(c.person, 36)}<div style="flex:1;display:flex;flex-direction:column"><b>${esc(c.person)}</b><span class="mono muted small">${fmtDate(c.ts)} · ${fmtTime(c.ts)}${x.status === 'diverged' ? ' · du hast den Tag danach geändert' : ''}</span></div><span class="pill ${x.status}">${label[x.status]}</span></div>
      <div style="display:flex;align-items:center;gap:8px">${dayChip(x.day, cfg.me, 'lg')}<b style="font-size:16px">${esc(s.plans[c.person][x.day].title)}</b></div>
      ${diffList(x.diff)}
      <span class="small muted">Deine abweichenden Übungen und persönlichen Werte bleiben erhalten.</span>
      <div class="btnrow"><button class="btn primary" data-act="accept" data-id="${esc(c.id)}">In meinen Plan übernehmen</button>
        ${x.status === 'open' ? `<button class="btn" data-act="dismiss" data-id="${esc(c.id)}">Ausblenden</button>` : ''}</div>
      ${inDraft ? `<button class="btn ghost" data-act="accept-draft" data-id="${esc(c.id)}">Übernehmen und ins laufende Training</button><span class="small muted">Eingaben bleiben erhalten. Übungen mit Einträgen, die wegfallen, bleiben im Training als „Nicht mehr im Plan“.</span>` : ''}
    </section>`;
  });
  const mine = DAYS.map(d => s.lastChange[cfg.me + '|' + d]).filter(Boolean);
  const mineHtml = mine.map(c => {
    const same = !sharedDiff(s.plans[other][c.data.day], s.plans[cfg.me][c.data.day]).length;
    return `<div class="sess"><div class="top"><span style="display:flex;gap:8px;align-items:center;color:var(--fg)">${dayChip(c.data.day)}<b>${esc(c.data.title)}</b></span><span class="pill ${same ? 'accepted' : ''}">${same ? `bei ${esc(other)} gleich` : `bei ${esc(other)} offen`}</span></div><span class="mono muted small">zuletzt gespeichert ${fmtDate(c.ts)}, ${fmtTime(c.ts)}</span></div>`;
  }).join('');
  return `<h1 class="display" style="font-size:30px">Plan&shy;änderungen</h1>
    <p class="muted small" style="margin:0">Wenn ${esc(other)} gemeinsame Übungen ändert, siehst du es hier. Abweichende Übungen und persönliche Werte lösen keine Meldung aus.</p>
    ${items.join('') || `<section class="card"><div class="empty">Keine Unterschiede. Eure gemeinsamen Übungen sind gleich.</div></section>`}
    ${mine.length ? `<div class="sec-title"><h2>Deine Änderungen</h2></div><section class="card">${mineHtml}</section>` : ''}`;
}
function acceptChange(changeId, intoDraft) {
  const s = st(), c = s.changes[changeId]; if (!c) return;
  const merged = mergePlan(s.plans[cfg.me][c.data.day], s.plans[c.person][c.data.day]);
  addEvent('plan_decision', { changeId, decision: 'accepted', result: merged }, `Änderung von ${c.person} an ${dl(c.data.day)} übernommen`);
  if (builder && !Object.values(builder.dirty).some(Boolean)) builder = null;
  if (intoDraft && draft && draft.day === c.data.day) { applyToDraft(merged); toast(`${dl(c.data.day)} übernommen, auch ins laufende Training`); location.hash = '#training'; return; }
  toast(`${dl(c.data.day)} übernommen. Gilt ab dem nächsten Training.`);
  render();
}
function dismissChange(changeId) {
  const c = st().changes[changeId]; if (!c) return;
  addEvent('plan_decision', { changeId, decision: 'dismissed' }, `Änderung von ${c.person} an ${dl(c.data.day)} ausgeblendet`);
  toast('Ausgeblendet. Du kannst sie später noch übernehmen.');
  render();
}

/* ---------- Plan-Builder ---------- */
function ensureBuilder() {
  if (builder && Object.values(builder.dirty).some(Boolean)) return;
  const cur = builder ? builder.day : nextDay(cfg.me);
  builder = { day: cur, work: clone(st().plans[cfg.me]), dirty: {} };
}
function viewPlan() {
  ensureBuilder();
  const b = builder, d = b.day, w = b.work[d], other = partner();
  const seg = `<div class="seg" role="group" aria-label="Trainingstag">${DAYS.map(k => `<button data-act="bday" data-v="${k}" aria-pressed="${k === d}"><i class="dot t-${DAY_TONE[k]}" style="width:9px;height:9px;margin-right:6px;vertical-align:1px"></i>${esc(b.work[k].short || DAY_SHORT[k])}${b.dirty[k] ? '<i class="mark"></i>' : ''}</button>`).join('')}</div>`;
  const rows = w.exercises.map((x, i) => `<div class="prow">
      <div class="n"><b>${esc(x.name)}</b><span class="small muted">${TYPE_LABEL[x.type]} · ${x.sets}×${x.min}–${x.max}${x.type === 'time' ? ' s' : ''}${x.type !== 'time' && x.step ? ` · +${fmtN(x.step)} kg` : ''}</span>
        ${x.personal || x.warmup ? `<span class="tags">${x.personal ? '<span class="tag">Nur ich</span>' : ''}${x.warmup ? '<span class="tag">Aufwärmsatz</span>' : ''}</span>` : ''}</div>
      <div class="tools"><button class="tool" data-act="bmove" data-i="${i}" data-v="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button><button class="tool" data-act="bmove" data-i="${i}" data-v="1" aria-label="Nach unten" ${i === w.exercises.length - 1 ? 'disabled' : ''}>${ICON.down}</button></div>
      <div class="acts"><button data-act="bedit" data-i="${i}">Bearbeiten</button><button data-act="breplace" data-i="${i}">Austauschen</button><button class="del" data-act="bremove" data-i="${i}">Entfernen</button></div>
    </div>`).join('');
  const changes = b.dirty[d] ? diffPlan(st().plans[cfg.me][d], w, false) : [];
  return `${seg}
    <section class="card form"><div class="dayinputs">
      <label>Name des Trainingstags<input class="inp" id="b-title" data-b="title" value="${esc(w.title)}" maxlength="40"></label>
      <label>Kürzel<input class="inp" id="b-short" data-b="short" value="${esc(w.short || DAY_SHORT[d])}" maxlength="6" autocapitalize="characters"></label>
    </div></section>
    <section class="card" style="padding:4px 16px 16px">${rows || '<div class="empty">Noch keine Übungen an diesem Tag.</div>'}
      <button class="btn ghost" data-act="badd" style="margin-top:8px">+ Übung hinzufügen</button></section>
    <p class="small muted" style="margin:0 2px">${esc(other)} bekommt nur Änderungen an gemeinsamen Übungen gemeldet: Übung, Art, Reihenfolge, Sätze, Wiederholungen, Aufwärmsatz, Name und Kürzel des Tages. Steigerung, Ausführung und Links sind persönlich. Übungen mit „Nur ich“ lösen nie eine Meldung aus.</p>
    ${changes.length ? `<section class="card"><b>Ungespeicherte Änderungen</b>${diffList(changes)}</section>` : ''}
    ${b.dirty[d] ? `<div style="height:56px"></div><div class="savebar"><span>${esc(w.short || DAY_SHORT[d])} geändert</span><button class="btn ghost" data-act="bdiscard">Verwerfen</button><button class="btn primary" data-act="bsave">Speichern</button></div>` : ''}`;
}
function markDirty() { builder.dirty[builder.day] = diffPlan(st().plans[cfg.me][builder.day], builder.work[builder.day], false).length > 0; }
const sheetHead = (eyebrow, title) => `<div class="shead"><button type="button" class="iconbtn" data-act="mclose" aria-label="Zurück ohne Speichern">${ICON.left}</button><span class="shead-t"><span class="eyebrow">${eyebrow}</span><b>${title}</b></span></div>`;
function exerciseForm(mode, i) {
  const w = builder.work[builder.day];
  const old = mode === 'add' ? null : w.exercises[i];
  const x = mode === 'edit' ? old : { id: '', name: '', type: old ? old.type : 'kg', sets: old ? old.sets : 3, min: old ? old.min : 8, max: old ? old.max : 12, step: old ? old.step : 2.5, cue: '', video: '', image: '', warmup: false, personal: old ? old.personal : false };
  const title = mode === 'add' ? 'Neue Übung' : mode === 'edit' ? 'Übung bearbeiten' : 'Übung austauschen';
  $('#modal').innerHTML = `<div class="backdrop" data-act="mclose-bg"><form class="sheet full form" id="exform" data-mode="${mode}" data-i="${i ?? ''}" novalidate>
    ${sheetHead(`${esc(w.short || DAY_SHORT[builder.day])} · ${esc(w.title || '')}`, title)}
    <h2>${title}</h2>
    ${mode === 'replace' ? `<p class="help" style="margin:0">Ersetzt <b>${esc(old.name)}</b>. Deren bisherige Einträge bleiben im Archiv erhalten.</p>` : ''}
    ${mode === 'edit' ? `<p class="help" style="margin:0">Änderungen hier gelten für dieselbe Übung, ihr Verlauf läuft weiter. Für eine andere Übung nutze „Austauschen“.</p>` : ''}
    <label>Name<input class="inp" id="f-name" name="name" value="${esc(x.name)}" maxlength="60" required></label>
    <label>Art<select id="f-type" name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}${k === 'bw' ? ' (Wdh., optional ± kg)' : k === 'time' ? ' (Sekunden)' : ' (kg + Wdh.)'}</option>`).join('')}</select></label>
    <div class="grid3"><label>Sätze<input class="inp" id="f-sets" name="sets" inputmode="numeric" value="${x.sets}"></label>
      <label><span id="f-unit-min">${x.type === 'time' ? 'Sek. von' : 'Wdh. von'}</span><input class="inp" id="f-min" name="min" inputmode="numeric" value="${x.min}"></label>
      <label>bis<input class="inp" id="f-max" name="max" inputmode="numeric" value="${x.max}"></label></div>
    <label class="chk" id="f-warm-l" ${x.type === 'kg' ? '' : 'hidden'}><input type="checkbox" id="f-warmup" name="warmup" ${x.warmup ? 'checked' : ''}><span>Aufwärmsatz<small>Ein Satz mit 60 % × 6 vor den Arbeitssätzen. Wird mit ${esc(partner())} abgeglichen.</small></span></label>
    <label class="chk"><input type="checkbox" id="f-personal" name="personal" ${x.personal ? 'checked' : ''}><span>Abweichende Übung (nur ich)<small>Gehört nicht zum gemeinsamen Training und löst bei ${esc(partner())} nie eine Meldung aus.</small></span></label>
    <div class="persbox"><div class="eyebrow">Persönlich · wird nicht abgeglichen</div>
      <label id="f-step-l" ${x.type === 'time' ? 'hidden' : ''}><span id="f-step-t">${x.type === 'bw' ? 'Steigerung Zusatzgewicht in kg (0 = keine)' : 'Steigerung in kg'}</span><input class="inp" id="f-step" name="step" inputmode="decimal" value="${fmtIn(x.step || 0)}"><span class="help">Wird vorgeschlagen, wenn alle Sätze die obere Wdh.-Zahl erreichen.</span></label>
      <label>Ausführung<textarea id="f-cue" name="cue" rows="3" maxlength="500">${esc(x.cue)}</textarea></label>
      <label>Video-Link (optional)<input class="inp" id="f-video" name="video" type="url" inputmode="url" value="${esc(x.video)}" placeholder="https://www.youtube.com/watch?v=…"><span class="help">Leer lassen: Die App sucht passende Videos auf YouTube.</span></label>
      <label>Bild-Link (optional)<input class="inp" id="f-image" name="image" type="url" inputmode="url" value="${esc(x.image)}" placeholder="https://…/bild.jpg"></label>
    </div>
    <div class="err" id="f-err" hidden></div>
    <div class="sbar"><button class="btn primary" type="submit">${mode === 'replace' ? 'Austauschen' : 'Übernehmen'}</button></div>
  </form></div>`;
  setTimeout(() => { const n = $('#f-name'); if (n && mode !== 'edit') n.focus(); }, 50);
}
function submitExercise(form) {
  const f = new FormData(form), mode = form.dataset.mode, i = +form.dataset.i;
  const w = builder.work[builder.day];
  const name = String(f.get('name') || '').trim();
  const type = f.get('type');
  const sets = int(f.get('sets')), min = int(f.get('min')), max = int(f.get('max'));
  const err = m => { const e = $('#f-err'); e.textContent = m; e.hidden = false; };
  if (!name) return err('Bitte gib einen Namen ein.');
  if (!sets || sets > 10) return err('Sätze: bitte eine Zahl von 1 bis 10.');
  if (!min || !max || min > max) return err('Bitte gib eine gültige Spanne an, z. B. 8 bis 12.');
  const url = v => { v = String(v || '').trim(); return /^https?:\/\//i.test(v) ? v : ''; };
  const data = { name, type, sets, min, max, step: type === 'time' ? 0 : Math.max(0, num(f.get('step'))), cue: String(f.get('cue') || '').trim(), video: url(f.get('video')), image: url(f.get('image')), warmup: type === 'kg' && f.get('warmup') === 'on', personal: f.get('personal') === 'on' };
  if (mode === 'edit') Object.assign(w.exercises[i], data);
  else if (mode === 'add') w.exercises.push({ id: 'u-' + uid().slice(0, 8), ...data });
  else { const old = w.exercises[i]; w.exercises.splice(i, 1, { id: 'u-' + uid().slice(0, 8), replaces: old.id, ...data }); }
  $('#modal').innerHTML = ''; markDirty(); render();
}
function savePlan() {
  const d = builder.day, w = builder.work[d];
  w.short = (w.short || '').trim() || DAY_SHORT[d];
  const changes = diffPlan(st().plans[cfg.me][d], w, false);
  if (!changes.length) { builder.dirty[d] = false; render(); return; }
  const notify = sharedDiff(st().plans[cfg.me][d], w).length > 0 && sharedDiff(st().plans[partner()][d], w).length > 0;
  addEvent('plan_change', { day: d, title: w.title, short: w.short, exercises: clone(w.exercises), changes }, `${w.short} geändert: ${changes.map(diffText).join('; ')}`);
  builder.dirty[d] = false;
  toast(notify ? `${w.short} gespeichert. ${partner()} bekommt einen Hinweis.` : `${w.short} gespeichert.`);
  render();
}

/* ---------- Einstellungen & Einrichtung ---------- */
function viewSettings() {
  const waiting = pending.filter(p => !seenIds.has(p.id)).length;
  const sv = scriptVersion == null ? '–' : scriptVersion >= SCRIPT_MIN ? `Version ${scriptVersion} ✓` : `Version ${scriptVersion} – bitte aktualisieren`;
  const hasVault = !!vmeta();
  return `<h1 class="display" style="font-size:30px">Einstellungen</h1>
    <div class="secl">Profil</div>
    <div class="rows glass"><label class="row" style="min-height:72px">${avatar(cfg.me, 46)}<span style="display:flex;flex-direction:column"><b>${esc(cfg.me)}</b><span class="small muted">Profilbild sehen beide</span></span><span class="v" style="color:var(--fg);font-family:var(--body);font-weight:600">Ändern</span><input type="file" id="av-file2" accept="image/*" hidden></label></div>
    <div class="secl">Vault</div>
    <div class="rows glass">
      ${hasVault ? `<button class="row" data-act="v-change">Vault-Code ändern<span class="v">• • • •</span></button>
      <button class="row" data-act="v-showkey">Wiederherstellungsschlüssel<span class="v"${vmeta().saved ? '' : ' style="color:var(--warn)"'}>${vmeta().saved ? 'anzeigen' : 'noch nicht notiert'}</span></button>
      <div class="row">Sicherung in der Tabelle<span class="v">${vaultCloudText()}</span></div>
      <button class="row" data-act="v-export">Backup als Datei<span class="v">sichern</span></button>` : `<a class="row" href="#vault">Vault einrichten<span class="v">Code festlegen</span></a>
      <a class="row" href="#vault-wiederherstellen">Vault wiederherstellen<span class="v">mit Schlüssel</span></a>`}
      <label class="row">Backup-Datei laden<span class="v">Datei wählen</span><input type="file" id="v-import" accept="application/json,.json" hidden></label>
    </div>
    <div class="secl">Sync mit Google-Tabelle</div>
    <section class="card form">
      <label>Sync-Adresse<input class="inp" id="s-url" value="${esc(cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" autocomplete="off"></label>
      <label>Sync-Schlüssel<input class="inp" id="s-key" value="${esc(cfg.key)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="err" id="s-err" hidden></div>
      <button class="btn primary" data-act="s-save">Speichern & synchronisieren</button>
    </section>
    <div class="rows glass">
      <div class="row">Google-Skript<span class="v">${sv}</span></div>
      <div class="row">Letzter Sync<span class="v">${lastSync ? fmtDate(lastSync) + ', ' + fmtTime(lastSync) : '–'}</span></div>
      <div class="row">Einträge<span class="v">${events.length} synchronisiert, ${waiting} wartend</span></div>
      <div class="row">App-Version<span class="v">${APP_VERSION}</span></div>
    </div>
    <div class="secl">Gerät</div>
    <section class="card form" style="gap:12px">
      <label class="tgl"><span>Entwickleroptionen</span><input type="checkbox" role="switch" id="dev-tgl" ${LS.get('dev', false) ? 'checked' : ''}><i aria-hidden="true"></i></label>
      ${LS.get('dev', false) ? `<b>Person wechseln</b><span class="small muted">Nur nötig, wenn diese App auf dem falschen Handy eingerichtet wurde. Ein laufendes Training wird dabei verworfen, der Vault gesperrt.</span>
      <div class="pick">${PEOPLE.map(p => `<button data-act="s-me" data-v="${p}" aria-pressed="${cfg.me === p}">${p}</button>`).join('')}</div>` : ''}
    </section>
    <section class="card"><b>Daten auf diesem Handy zurücksetzen</b>
      <span class="small muted">Löscht nur die Kopie des Trainingslogs auf diesem Handy. Beim nächsten Sync wird alles aus der Tabelle neu geladen. Der Vault bleibt erhalten.${waiting ? ` <b>${waiting} noch nicht gesendete Einträge gehen dabei verloren.</b>` : ''}</span>
      ${resetAsk ? `<div class="btnrow"><button class="btn small danger" data-act="reset-yes">Ja, zurücksetzen</button><button class="btn small ghost" data-act="reset-no">Abbrechen</button></div>` : `<button class="btn danger" data-act="reset-ask">Zurücksetzen</button>`}
    </section>`;
}
function vaultCloudText() {
  const m = vmeta(), c = vcloud();
  if (!m || m.v !== 2) return 'nach dem nächsten Öffnen';
  if (!cfg.url) return 'Tabelle nicht verbunden';
  if (scriptVersion != null && scriptVersion < 3) return 'Skript-Version 3 nötig';
  if (vaultSyncing) return 'läuft …';
  if (!c) return 'noch nicht gesichert';
  if (c.err) return c.err === 'vault_denied' ? 'Zugang abgelehnt' : 'zuletzt fehlgeschlagen';
  return `${c.n} ${c.n === 1 ? 'Bild' : 'Bilder'} · ${fmtDate(c.at)}, ${fmtTime(c.at)}`;
}
let setupMe = null;
function viewSetup() {
  return `<div class="setup">
    <div><div class="eyebrow">Willkommen</div><h1 class="display">Hantel&shy;buch</h1></div>
    <p style="margin:0" class="muted">Dein Trainingsplan für Brust & Trizeps, Rücken & Bizeps und Beine & Bauch. Fortschritte von Manu und Rob werden über eine gemeinsame Google-Tabelle abgeglichen.</p>
    <div class="form"><label>Wer bist du?</label><div class="pick">${PEOPLE.map(p => `<button data-act="setup-me" data-v="${p}" aria-pressed="${setupMe === p}">${p}</button>`).join('')}</div></div>
    <div class="form">
      <label>Sync-Adresse<input class="inp" id="u-url" placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" autocomplete="off"></label>
      <label>Sync-Schlüssel<input class="inp" id="u-key" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="help">Beides findest du in der Google-Tabelle auf dem Blatt „Info“.</span></label>
      <div class="err" id="u-err" hidden></div>
      <button class="btn primary" data-act="setup-go">Verbinden</button>
      <button class="btn ghost" data-act="setup-local">Erst ohne Sync ausprobieren</button>
    </div></div>`;
}
async function testAndSave(url, key, errEl) {
  url = url.trim(); key = key.trim();
  const show = m => { errEl.textContent = m; errEl.hidden = false; };
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) { show('Die Sync-Adresse muss mit https://script.google.com/ beginnen.'); return false; }
  if (!key) { show('Bitte gib den Sync-Schlüssel ein.'); return false; }
  const prev = { ...cfg }; cfg.url = url; cfg.key = key;
  try { await call({ action: 'ping' }); }
  catch (e) { cfg.url = prev.url; cfg.key = prev.key; show(e.code === 'unauthorized' ? 'Der Sync-Schlüssel stimmt nicht.' : 'Keine Verbindung zur Tabelle. Prüfe die Adresse und deine Internetverbindung.'); return false; }
  LS.set('cfg', cfg); return true;
}

/* ---------- Ereignisse ---------- */
const readSetInputs = (i, j) => {
  const s = draft.items[i].sets[j], rIn = document.getElementById(`r-${i}-${j}`), wIn = document.getElementById(`w-${i}-${j}`);
  if (wIn) s.w = wIn.value; if (rIn) s.r = rIn.value; return s;
};
const actions = {
  start: () => startTraining(false),
  'start-normal': () => startTraining(true),
  'skip-ask': () => { skipAsk = true; render(); },
  'skip-no': () => { skipAsk = false; render(); },
  'skip-yes': () => { const d = nextDay(cfg.me); addEvent('skip', { day: d }, `${dl(d)} übersprungen`); skipAsk = false; toast(`${dl(d)} übersprungen`); render(); },
  sync: () => sync({ overlay: true }),
  check: t => {
    const i = +t.dataset.i, j = +t.dataset.j, x = draft.items[i].ex, s = readSetInputs(i, j);
    if (!s.done && x.type === 'kg' && !num(s.w)) { toast('Trag zuerst das Gewicht ein.'); const w = document.getElementById(`w-${i}-${j}`); if (w) w.focus(); return; }
    if (!s.done && !int(s.r)) { const mine = lastAny(cfg.me, x.id); s.r = String(draft.deload ? x.min : mine && mine.type === x.type && mine.sets[j] ? mine.sets[j].r : x.max); }
    s.done = !s.done; saveDraft(); rerenderCard(i);
  },
  sign: t => { const i = +t.dataset.i, s = readSetInputs(i, +t.dataset.j); s.neg = !s.neg; saveDraft(); rerenderCard(i); },
  wu: t => { const it = draft.items[+t.dataset.i]; it.wu[0] = !it.wu[0]; saveDraft(); rerenderCard(+t.dataset.i); },
  feel: t => { const it = draft.items[+t.dataset.i]; it.feel = it.feel === t.dataset.v ? '' : t.dataset.v; saveDraft(); rerenderCard(+t.dataset.i); },
  'plateau-down': t => {
    const i = +t.dataset.i, it = draft.items[i], pr = progression(it.ex);
    if (pr.base == null) return;
    const w = roundTo(it.ex.type === 'kg' ? pr.base * 0.9 : deloadW(pr.base), stepOf(it.ex));
    it.sets.forEach(s => { if (!s.done) { s.w = w ? fmtIn(w) : ''; s.neg = w < 0; } });
    saveDraft(); rerenderCard(i); toast('Gewicht für heute um 10 % reduziert');
  },
  addset: t => { const i = +t.dataset.i, it = draft.items[i]; it.sets.forEach((s, j) => readSetInputs(i, j)); const l = it.sets[it.sets.length - 1]; it.sets.push({ w: l ? l.w : '', neg: l ? l.neg : false, r: '', done: false }); saveDraft(); rerenderCard(i); },
  delset: t => { const i = +t.dataset.i, it = draft.items[i]; if (it.sets.length <= 1) return; it.sets.forEach((s, j) => readSetInputs(i, j)); it.sets.pop(); saveDraft(); rerenderCard(i); },
  'swap-open': t => swapForm(+t.dataset.i),
  'swap-follow': t => {
    const sw = st().swaps.find(e => e.id === t.dataset.id), i = +t.dataset.i; if (!sw) return;
    doSwap(i, clone(sw.data.to), { id: sw.data.fromId, name: sw.data.fromName }, sw.person, false); render(); toast('Getauscht');
  },
  'swap-ignore': t => { draft.swapIgnored.push(t.dataset.id); saveDraft(); render(); },
  'finish-ask': () => finishSheet(),
  'finish-yes': () => finishTraining(),
  'discard-ask': () => discardSheet(),
  'discard-yes': () => { draft = null; saveDraft(); $('#modal').innerHTML = ''; toast('Training verworfen'); location.hash = '#start'; },
  'bw-save': () => {
    const el = $('#bw-in'), v = num(el && el.value);
    if (v < 30 || v > 300) { toast('Bitte ein Gewicht zwischen 30 und 300 kg eingeben.'); return; }
    addEvent('bodyweight', { kg: Math.round(v * 10) / 10 }, `Körpergewicht ${fmtN(v)} kg`); toast('Körpergewicht gespeichert'); render();
  },
  vtab: t => { verlaufTab = t.dataset.v; render(); },
  calmove: t => { cal.m += +t.dataset.v; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } render(); },
  calday: t => { cal.sel = t.dataset.v; render(); },
  nfilter: t => { notesFilter = t.dataset.v; render(); },
  accept: t => acceptChange(t.dataset.id, false),
  'accept-draft': t => acceptChange(t.dataset.id, true),
  dismiss: t => dismissChange(t.dataset.id),
  bday: t => { builder.day = t.dataset.v; render(); },
  bmove: t => { const a = builder.work[builder.day].exercises, i = +t.dataset.i, j = i + +t.dataset.v; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; markDirty(); render(); },
  bedit: t => exerciseForm('edit', +t.dataset.i),
  breplace: t => exerciseForm('replace', +t.dataset.i),
  badd: () => exerciseForm('add'),
  bremove: t => { const a = builder.work[builder.day].exercises; const x = a.splice(+t.dataset.i, 1)[0]; markDirty(); render(); toast(`${x.name} entfernt. Speichern nicht vergessen.`); },
  bdiscard: () => { builder.work[builder.day] = clone(st().plans[cfg.me][builder.day]); builder.dirty[builder.day] = false; render(); },
  bsave: () => savePlan(),
  'w-edit': t => { const w = st().workouts.find(x => x.id === t.dataset.id); if (!w || w.person !== cfg.me) return; wedit = { id: w.id, entries: clone(w.data.entries) }; workoutForm(); },
  'we-add': t => { readWorkoutForm(); const en = wedit.entries[+t.dataset.i], l = en.sets[en.sets.length - 1]; en.sets.push({ w: l ? l.w : '', r: '' }); workoutForm(); },
  'we-del': t => { readWorkoutForm(); const en = wedit.entries[+t.dataset.i]; if (en.sets.length) en.sets.pop(); workoutForm(); },
  'w-del': t => { wDelAsk = t.dataset.id; render(); },
  'w-del-no': () => { wDelAsk = null; render(); },
  'w-del-yes': t => {
    const w = st().workouts.find(x => x.id === t.dataset.id); if (!w || w.person !== cfg.me) return;
    addEvent('workout_edit', { ref: w.id, deleted: true }, `${dl(w.data.day)} vom ${fmtDate(w.ts)} gelöscht`);
    wDelAsk = null; toast('Training gelöscht'); location.hash = '#verlauf';
  },
  mclose: () => { $('#modal').innerHTML = ''; },
  'mclose-bg': (t, e) => { if (e.target === t) $('#modal').innerHTML = ''; },
  pin: t => { if (VAULT.pin.length >= 4) return; VAULT.pin += t.dataset.v; VAULT.msg = ''; if (VAULT.pin.length === 4) { render(); pinComplete(); } else render(); },
  'pin-del': () => { VAULT.pin = VAULT.pin.slice(0, -1); render(); },
  'v-lock': () => { lockVault(); location.hash = '#profil'; },
  'v-del': t => { VAULT.del = t.dataset.id; render(); },
  'v-del-no': () => { VAULT.del = null; render(); },
  'rk-copy': async () => { try { await navigator.clipboard.writeText(VAULT.showKey); toast('Schlüssel kopiert'); } catch (e) { const r = document.createRange(); r.selectNodeContents($('#rk-show')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Markiert. Jetzt über „Kopieren“ kopieren.'); } },
  'rk-done': () => { const m = vmeta(); if (m) { m.saved = true; LS.set('vault.' + cfg.me, m); } VAULT.showKey = null; loadVault().then(render); },
  'rk-restore': () => startRestore(),
  'v-showkey': () => { lockVault(); VAULT.wantKey = true; location.hash = '#vault'; render(); },
  'v-del-yes': async t => { await deleteVaultEntry(t.dataset.id); if (VAULT.urls[t.dataset.id]) { URL.revokeObjectURL(VAULT.urls[t.dataset.id]); delete VAULT.urls[t.dataset.id]; } VAULT.del = null; await loadVault(); toast('Bild gelöscht'); render(); },
  'v-change': () => { lockVault(); VAULT.mode = 'old'; location.hash = '#vault'; render(); },
  'v-export': () => exportVault(),
  's-save': async () => { const ok = await testAndSave($('#s-url').value, $('#s-key').value, $('#s-err')); if (ok) { toast('Verbunden'); sync({ overlay: true }); } },
  's-me': t => { cfg.me = t.dataset.v; LS.set('cfg', cfg); builder = null; draft = null; saveDraft(); lockVault(); invalidate(); toast(`Du bist jetzt ${cfg.me}`); render(); },
  'reset-ask': () => { resetAsk = true; render(); },
  'reset-no': () => { resetAsk = false; render(); },
  'reset-yes': () => { events = []; pending = []; lastSeq = 0; lastSync = null; seenIds = new Set(); saveLog(); LS.set('lastSync', null); resetAsk = false; invalidate(); builder = null; sync({ overlay: true }); render(); },
  'setup-me': t => { setupMe = t.dataset.v; render(); },
  'setup-go': async () => {
    const err = $('#u-err');
    if (!setupMe) { err.textContent = 'Bitte wähle zuerst aus, wer du bist.'; err.hidden = false; return; }
    const ok = await testAndSave($('#u-url').value, $('#u-key').value, err);
    if (!ok) return;
    cfg.me = setupMe; LS.set('cfg', cfg); location.hash = '#start'; render(); sync({ overlay: true });
  },
  'setup-local': () => {
    const err = $('#u-err');
    if (!setupMe) { err.textContent = 'Bitte wähle zuerst aus, wer du bist.'; err.hidden = false; return; }
    cfg = { me: setupMe, url: '', key: '' }; LS.set('cfg', cfg); location.hash = '#start'; render();
  }
};
document.addEventListener('click', e => {
  if (e.target.id === 'vn-file') VAULT.picking = Date.now(); // Kamera/Fotoauswahl: Vault währenddessen nicht sperren
  const t = e.target.closest('[data-act]');
  if (!t || !actions[t.dataset.act]) return;
  if (t.tagName === 'BUTTON' && t.type !== 'submit') e.preventDefault();
  actions[t.dataset.act](t, e);
});
document.addEventListener('submit', e => {
  if (e.target.id === 'exform') { e.preventDefault(); submitExercise(e.target); }
  if (e.target.id === 'swapform') { e.preventDefault(); submitSwap(e.target); }
  if (e.target.id === 'wform') { e.preventDefault(); saveWorkoutEdit(); }
  if (e.target.id === 'vaultform') { e.preventDefault(); saveVaultEntry(e.target); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'f-type') t.dispatchEvent(new Event('input', { bubbles: true }));
  if ((t.id === 'av-file' || t.id === 'av-file2') && t.files[0]) setAvatar(t.files[0]);
  if (t.id === 'v-import' && t.files[0]) readBackupFile(t.files[0]);
  if (t.id === 'dev-tgl') { LS.set('dev', t.checked); render(); }
  if (t.id === 'vn-file' && t.files[0]) {
    if (VAULT.photoUrl) URL.revokeObjectURL(VAULT.photoUrl);
    VAULT.picking = 0; VAULT.photo = t.files[0]; VAULT.photoUrl = URL.createObjectURL(t.files[0]);
    const box = t.closest('.pickphoto'); let img = box.querySelector('img');
    box.querySelectorAll('svg, b, span').forEach(n => n.remove());
    if (!img) { img = document.createElement('img'); img.alt = 'Gewähltes Foto'; box.prepend(img); }
    img.src = VAULT.photoUrl;
  }
});
let draftTimer;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && draft) {
    const i = +t.dataset.i, j = +t.dataset.j;
    draft.items[i].sets[j][t.dataset.f] = t.value;
    if (t.dataset.f === 'w' && j === 0) { const el = document.getElementById(`wu-${i}`); if (el) el.textContent = warmupLabel(draft.items[i]); }
    clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300);
  } else if (t.dataset.note != null && draft) {
    draft.items[+t.dataset.note].note = t.value;
    clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300);
  } else if ((t.dataset.b === 'title' || t.dataset.b === 'short') && builder) {
    builder.work[builder.day][t.dataset.b] = t.dataset.b === 'short' ? t.value.toUpperCase().slice(0, 6) : t.value.trimStart();
    const was = builder.dirty[builder.day]; markDirty();
    if (was !== builder.dirty[builder.day]) { const id = t.id, pos = t.selectionStart; render(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  } else if (t.id === 'f-type') {
    $('#f-step-l').hidden = t.value === 'time';
    $('#f-warm-l').hidden = t.value !== 'kg';
    $('#f-step-t').textContent = t.value === 'bw' ? 'Steigerung Zusatzgewicht in kg (0 = keine)' : 'Steigerung in kg';
    $('#f-unit-min').textContent = t.value === 'time' ? 'Sek. von' : 'Wdh. von';
  } else if (t.id === 'sw-name') {
    const k = knownExercises().get(t.value.trim().toLowerCase());
    if (k) { const sel = $('#sw-type'); if (sel) sel.value = k.type; }
  }
});
window.addEventListener('hashchange', () => { $('#modal').innerHTML = ''; render(); });

/* ---------- Start der App ---------- */
let hiddenAt = Date.now();
// Fragt bei GitHub nach einer neuen Version. Nicht während eines Trainings, damit nichts mitten im Satz neu lädt.
function checkUpdate() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || (view === 'training' && draft)) return;
  if (Date.now() - (checkUpdate.last || 0) < 60000) return;
  checkUpdate.last = Date.now();
  navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (draft) saveDraft(); if ((VAULT.key || VAULT.photo) && Date.now() - VAULT.picking > 180000) { lockVault(); if (view.startsWith('vault')) location.hash = '#profil'; } return; }
  checkUpdate();
  const away = Date.now() - hiddenAt;
  if (cfg.me && cfg.url && away > 60000) sync({ overlay: away > 5 * 60000 && view !== 'training' });
});
window.addEventListener('online', () => { if (cfg.me && cfg.url) sync({ quiet: true }); });
setInterval(() => {
  if (view === 'training' && draft) { const c = $('#tp-count'); if (c) c.textContent = trainCountText(); }
  if (view === 'training' && draft && cfg.url && document.visibilityState === 'visible' && !syncing && Date.now() - (setInterval.last || 0) > 60000) { setInterval.last = Date.now(); sync({ quiet: true }); }
}, 15000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(checkUpdate, 3000);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; if (draft) saveDraft(); location.reload(); } });
}

try { draft = normalizeDraft(draft); } catch (e) { draft = null; }
render();
if (cfg.me && cfg.url) sync({ overlay: true });
