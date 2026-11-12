// Schritt 3: Mein Plan / Crew-Plan, Tage, Notizen (privat/Crew), feste Bibliothek mit eigenen Übungen
import { makeDb, serve } from './mocksb.mjs';
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = '/home/claude/hantelbuch-v0.01', OUT = '/tmp/claude-0/-home-claude/99c271a0-0469-5ca9-be56-a6d31b215667/scratchpad/shots/e2e3';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const db = await makeDb({ importFiles: ['../imp_test/02-import-daten.sql'] });
await db.exec("insert into public.legacy_claims (legacy_name, code_hash) values ('Manu', encode(extensions.digest('MANU1234','sha256'),'hex')), ('Rob', encode(extensions.digest('ROBB5678','sha256'),'hex')) on conflict (legacy_name) do update set code_hash = excluded.code_hash, claimed_by = null");
const sbs = await serve(db);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const web = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(8780);
const b = await chromium.launch();
const errs = [], checks = [];
const check = (name, cond, info = '') => checks.push(`${cond ? 'ok  ' : 'FEHLER'} ${name}${info !== '' ? ' · ' + info : ''}`);
const q1 = async (sql, p) => (await db.query(sql, p)).rows;
async function phone(who) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(who + ': ' + e.message + ' ' + (e.stack || '').split('\n')[1])); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(who + ' console: ' + m.text()); });
  await p.goto('http://localhost:8780/'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('built.sb.url', 'http://localhost:54321'); }); await p.reload(); await p.waitForTimeout(400); return p;
}
async function onboard(p, email, code) {
  await p.click('[data-act="onb-go"][data-v="email"]'); await p.fill('#onb-in', email); await p.click('[data-act="onb-send"]');
  await p.waitForSelector('.otpboxes'); await p.type('#onb-in', '123456');
  await p.waitForSelector('[data-act="onb-claim"]'); await p.fill('#onb-in', code); await p.click('[data-act="onb-claim"]'); await p.waitForSelector('text=Willkommen zurück');
  await p.click('[data-act="onb-go"][data-v="profile"]'); await p.click('[data-act="onb-name"]'); await p.waitForSelector('.wz'); await p.click('[data-act="onb-goalok"]');
  await p.waitForSelector('[data-onb="ok"]'); await p.check('[data-onb="ok"]'); await p.click('[data-act="onb-privacy"]'); await p.waitForSelector('.buddyid'); await p.click('[data-act="onb-done"][data-v="later"]'); await p.waitForTimeout(2500);
}
const syncAll = p => p.evaluate(async () => { await sync({ quiet: true }); await notesSync(); });
const go = async (p, h, ms = 600) => { await p.evaluate(h => { location.hash = h; }, h); await p.waitForTimeout(ms); };
let n = 0; const shot = async (p, name, full = false) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };

const m = await phone('Manu'); await onboard(m, 'manu@test.de', 'MANU1234');
const r = await phone('Rob'); await onboard(r, 'rob@test.de', 'ROBB5678');
await syncAll(m); await syncAll(r); await m.reload(); await m.waitForTimeout(1500); await syncAll(m);
const ids = await m.evaluate(() => ({ me: cfg.me, rob: others()[0], crew: !!(CREW && CREW.id) }));
check('Manu ist in einer Crew mit Rob', ids.crew && !!ids.rob);
const legacy = await q1("select scope, count(*)::int n from public.notes where id like 'legacy-%' group by scope");
check('Altnotizen übernommen, alle als Crew-Notizen', legacy.length === 1 && legacy[0].scope === 'crew', JSON.stringify(legacy));

// 1) Plan-Tab: Crew-Plan
await go(m, '#plan'); await m.evaluate(() => { planKind = 'crew'; builder = null; render(); }); await shot(m, 'plan-crew');
const chipsCrew = await m.$$eval('.dchip:not(.add)', els => els.map(e => e.textContent.trim()));
check('Crew-Plan zeigt drei Tage', chipsCrew.length === 3, chipsCrew.join(' '));
// 2) Mein Plan: neuer Tag „S&A“
await m.click('[data-act="pkind"][data-v="mine"]'); await m.waitForTimeout(300); await shot(m, 'plan-mein');
await m.click('[data-act="bday-add"]'); await m.waitForSelector('#dayform'); await shot(m, 'plan-neuer-tag');
await m.fill('#dn-title', 'Schultern & Arme'); await m.fill('#dn-short', 'S&A'); await m.click('#dayform button[type=submit]'); await m.waitForTimeout(500);
await m.evaluate(() => { const L = libGet('seitheben'); builder.work[builder.day].exercises.push(exFromLib(L)); markDirty(); savePlan(); });
await m.waitForTimeout(400); await shot(m, 'plan-mein-4-tage');
const meinDays = await m.evaluate(() => pdays(cfg.me, 'mine').map(d => dl(d, cfg.me, 'mine')));
const crewDays = await m.evaluate(() => pdays(cfg.me, 'crew').map(d => dl(d, cfg.me, 'crew')));
check('Mein Plan hat 4 Tage, Crew-Plan bleibt bei 3', meinDays.length === 4 && crewDays.length === 3, meinDays.join(' ') + ' / ' + crewDays.join(' '));
await syncAll(m); await syncAll(r);
const robSeesMine = await r.evaluate(id => !!st().mine[id], ids.me);
check('Rob sieht Manus Mein Plan nicht', !robSeesMine);
check('Rob bekommt keine Glocke für Mein Plan', (await r.evaluate(() => bellItems().every(x => !x.diff.map(diffText).join().includes('S&A')))));
// 3) Umbenennen-Dialog
await m.click('[data-act="bday-edit"]'); await m.waitForSelector('#dayform'); await shot(m, 'plan-umbenennen'); await m.evaluate(() => closeModal());

// 4) Training im Crew-Plan mit privater und Crew-Notiz
await go(m, '#start'); await m.evaluate(() => { startKind = 'crew'; render(); }); await shot(m, 'start-crew');
await m.evaluate(() => startTraining(false, undefined, 'crew')); await m.waitForTimeout(500);
await m.evaluate(() => { const it = draft.items[0]; it.sets.forEach(s => { s.w = '60'; s.r = '8'; s.done = true; }); it.note = 'Linke Schulter beobachten.'; it.cnote = 'Bank 3 wackelt, lieber Bank 1 nehmen.'; it.nscope = 'crew'; saveDraft(); render(); });
await shot(m, 'training-crew-notiz', true);
await m.evaluate(() => finishTraining()); await m.waitForTimeout(800); await syncAll(m);
const nrows = await q1("select scope, plan, body from public.notes where id not like 'legacy-%' order by scope");
check('Training speichert private und Crew-Notiz', nrows.length === 2 && nrows[0].scope === 'crew' && nrows[1].scope === 'private', JSON.stringify(nrows.map(x => x.scope)));
const wrow = (await q1("select data->>'date' d, data->>'plan' p from public.events where type='workout' order by seq desc limit 1"))[0];
check('Training hat Datum und Plan', !!wrow.d && wrow.p === 'crew', JSON.stringify(wrow));
// 5) Zweites Training am selben Tag wird verhindert
await go(m, '#start'); await shot(m, 'start-heute-schon');
await m.evaluate(() => startTraining(false, undefined, 'mine')); await m.waitForTimeout(300);
check('Zweites Training am Tag gesperrt', await m.evaluate(() => !draft));
// 6) Rob sieht nur die Crew-Notiz
await syncAll(r); await go(r, '#plan'); await r.evaluate(() => { planKind = 'crew'; builder = null; render(); });
const exN = await m.evaluate(() => st().workouts.filter(w => w.person === cfg.me).pop().data.entries[0].exId);
const robNotes = await r.evaluate(id => notesFor(id, 'crew'), exN);
check('Rob sieht Manus Crew-Notiz, nicht die private', robNotes.crew.some(x => x.body.includes('Bank 3')) && !robNotes.priv.some(x => x.body.includes('Schulter')), JSON.stringify(robNotes.crew.map(x => x.body)) + ' db:' + JSON.stringify(await q1("select id, scope, user_id, crew_id, ex_id from public.notes where id not like 'legacy-%'")));
await shot(r, 'rob-plan-crew');
// 7) Notizen-Ansichten und Fokus aus dem Training
await go(m, '#notizen:crew'); await shot(m, 'notizen-crew');
await go(m, '#notizen:mine'); await shot(m, 'notizen-mein');
await r.evaluate(() => startTraining(false, undefined, 'crew')); await r.waitForTimeout(400); await shot(r, 'rob-training', true);
await go(r, '#notizen:crew:' + exN, 900); await shot(r, 'rob-notizen-fokus');
check('Fokus: andere Karten abgedunkelt, Zurück ins Training', (await r.$$('.xcard.ndim')).length >= 0 && (await r.$('a[href="#training"]')) !== null);
await r.evaluate(() => { draft = null; saveDraft(); });
// 8) Notiz bearbeiten und Melden-Menü
const myCrewNote = await m.evaluate(() => liveNotes().find(n => n.scope === 'crew' && n.user_id === cfg.me && !n.id.startsWith('legacy-')).id);
await go(m, '#plan'); await m.evaluate(() => { planKind = 'crew'; builder = null; render(); });
await m.evaluate(id => openNoteMenu(id), myCrewNote); await shot(m, 'notiz-menue');
await m.evaluate(id => openNoteMenu(id, 'edit'), myCrewNote); await m.fill('#ne-body', 'Bank 3 wackelt. Lieber Bank 1.'); await m.click('#noteedit button[type=submit]'); await m.waitForTimeout(300); await syncAll(m);
check('Notiz bearbeitet', (await q1('select body, edited_at from public.notes where id=$1', [myCrewNote]))[0].edited_at !== null);

// 9) Bibliothek: fest, Vorlage, eigene Übung
await go(m, '#bibliothek'); await shot(m, 'bibliothek');
await m.evaluate(() => libForm(libGet('dips'))); await m.waitForTimeout(300); await shot(m, 'bibliothek-uebung');
check('Grundbestand nur lesbar', await m.isVisible('[data-act="lib-tpl"]') && !(await m.$('#libform')));
await m.click('[data-act="lib-tpl"]'); await m.waitForSelector('#libform');
await m.fill('#lf-name', 'Dips mit Gewicht'); await m.waitForTimeout(200);
check('Nur Name geändert: Speichern gesperrt', await m.evaluate(() => $('#libform .sbar .btn.primary').disabled));
await shot(m, 'eigene-uebung-gesperrt');
await m.fill('#libform input[name=sets]', '4'); await m.waitForTimeout(200);
check('Mehr geändert: Speichern frei', await m.evaluate(() => !$('#libform .sbar .btn.primary').disabled));
await m.click('#libform .sbar .btn.primary'); await m.waitForTimeout(800); console.log('LIBQ', await m.evaluate(() => JSON.stringify(LIBQ).slice(0, 300)), await m.evaluate(() => ($('#toast') || {}).textContent)); await syncAll(m);
const own = await q1("select id, owner is not null o, crew_id is not null c, data->>'Name' n from public.library where owner is not null");
check('Eigene Übung in der Datenbank, für die Crew', own.length === 1 && own[0].c && own[0].n === 'Dips mit Gewicht', JSON.stringify(own));
await go(m, '#bibliothek'); await m.evaluate(() => { LIBV.group = 'Eigene'; render(); }); await shot(m, 'bibliothek-eigene');
// gleicher Name wie im Grundbestand gesperrt
await m.evaluate(() => libForm(null, { name: 'Dips (Brust-Fokus)' })); await m.fill('#libform input[name=sets]', '5'); await m.click('#libform .sbar .btn.primary'); await m.waitForTimeout(300);
check('Name aus dem Grundbestand gesperrt', (await m.textContent('#lf-err')).includes('gibt es schon'), await m.textContent('#lf-err'));
await m.evaluate(() => closeModal());
await syncAll(r); const robLib = await r.evaluate(() => libAll().filter(L => L.owner).map(L => L.name));
check('Rob sieht die eigene Übung seiner Crew', robLib.includes('Dips mit Gewicht'), robLib.join(','));

// 10) Crew-Plan: neuer Tag geht als Vorschlag an Rob
await go(m, '#plan'); await m.evaluate(() => { planKind = 'crew'; builder = null; render(); });
await m.click('[data-act="bday-add"]'); await m.fill('#dn-title', 'Ganzkörper'); await m.fill('#dn-short', 'GK'); await m.click('#dayform button[type=submit]'); await m.waitForTimeout(500);
await syncAll(m); await syncAll(r);
const bell = await r.evaluate(() => bellItems().map(x => x.diff.map(diffText).join('; ')));
check('Rob bekommt den neuen Tag über die Glocke', bell.some(t => t.includes('Neuer Trainingstag: GK')), bell.join(' | '));
await go(r, '#glocke'); await shot(r, 'rob-glocke-neuer-tag');
await r.evaluate(() => acceptChange(bellItems().find(x => x.diff.some(d => d.k === 'addday')).pc.id)); await r.waitForTimeout(300);
check('Rob übernimmt: 4 Tage im Crew-Plan', (await r.evaluate(() => pdays(cfg.me, 'crew').length)) === 4);
// Tag wieder löschen
await m.evaluate(() => { builder = null; render(); builder.day = PD(builder.work).find(d => builder.work[d].short === 'GK'); render(); });
await m.click('[data-act="bday-edit"]'); await m.click('[data-act="bday-del"]'); await shot(m, 'tag-loeschen'); await m.click('[data-act="bday-del-yes"]'); await m.waitForTimeout(400);
await syncAll(m); await syncAll(r);
const bell2 = await r.evaluate(() => bellItems().map(x => x.diff.map(diffText).join('; ')));
check('Rob bekommt das Löschen über die Glocke', bell2.some(t => t.includes('gelöscht')), bell2.join(' | '));
// Rotation folgt dem zuletzt genutzten Plan
check('Rotation: Start zeigt den Crew-Plan (zuletzt genutzt)', (await m.evaluate(() => curPlan())) === 'crew');
await go(m, '#verlauf'); await shot(m, 'verlauf');
await go(m, '#profil'); await shot(m, 'profil');

console.log(checks.join('\n'));
console.log('Fehler:', errs.slice(0, 12));
await b.close(); web.close(); sbs.close(); process.exit(0);
