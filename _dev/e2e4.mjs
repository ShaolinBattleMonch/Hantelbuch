// Schritt 4: Buddies, Crew mit drei Personen, Crew-Chat, Spots, Wochenziel, Glocke für die Crew, Blockieren
import { makeDb, serve } from './mocksb.mjs';
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = '/home/claude/hantelbuch-v0.01', OUT = '/tmp/claude-0/-home-claude/99c271a0-0469-5ca9-be56-a6d31b215667/scratchpad/shots/e2e4';
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
async function onboard(p, email, code, name) {
  await p.click('[data-act="onb-go"][data-v="email"]'); await p.fill('#onb-in', email); await p.click('[data-act="onb-send"]');
  await p.waitForSelector('.otpboxes'); await p.type('#onb-in', '123456');
  if (code) { await p.waitForSelector('[data-act="onb-claim"]'); await p.fill('#onb-in', code); await p.click('[data-act="onb-claim"]'); await p.waitForSelector('text=Willkommen zurück'); await p.click('[data-act="onb-go"][data-v="profile"]'); }
  await p.waitForSelector('[data-onb="name"]'); if (name) await p.fill('[data-onb="name"]', name);
  await p.click('[data-act="onb-name"]'); await p.waitForSelector('.wz'); await p.click('[data-act="onb-goalok"]');
  await p.waitForSelector('[data-onb="ok"]'); await p.check('[data-onb="ok"]'); await p.click('[data-act="onb-privacy"]'); await p.waitForSelector('.buddyid'); await p.click('[data-act="onb-done"][data-v="later"]'); await p.waitForTimeout(2500);
}
const syncAll = p => p.evaluate(async () => { await sync({ quiet: true }); await notesSync(); await chatSync(); await spotSync(); });
const go = async (p, h, ms = 600) => { await p.evaluate(h => { location.hash = h; }, h); await p.waitForTimeout(ms); };
let n = 0; const shot = async (p, name, full = false) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };

const m = await phone('Manu'); await onboard(m, 'manu@test.de', 'MANU1234');
const r = await phone('Rob'); await onboard(r, 'rob@test.de', 'ROBB5678');
const l = await phone('Lena'); await onboard(l, 'lena@test.de', null, 'Lena');
check('Lena: keine Übernahme-Frage, neues Konto', (await q1("select count(*)::int n from public.profiles where name='Lena' and legacy_name is null"))[0].n === 1);
for (const p of [m, r, l]) await syncAll(p);
const ids = { m: await m.evaluate(() => cfg.me), r: await r.evaluate(() => cfg.me), l: await l.evaluate(() => cfg.me) };
const mBuddy = (await q1('select buddy_id from public.profiles where id=$1', [ids.m]))[0].buddy_id;

// 1) Lena sucht Manu über die ID und schickt eine Anfrage
await go(l, '#buddies'); await shot(l, 'lena-buddies-leer');
await l.fill('#bud-q', mBuddy); await l.waitForTimeout(800); await shot(l, 'lena-suche');
check('Suche findet Manu', (await l.textContent('main')).includes('Manu'));
await l.click('[data-act="bud-send"]'); await l.waitForTimeout(800);
check('Anfrage gespeichert', (await q1("select count(*)::int n from public.friendships where status='pending'"))[0].n === 1);
// 2) Manu nimmt an, gründet keine neue Crew (hat schon eine) und lädt Lena ein
await syncAll(m); await go(m, '#buddies'); await shot(m, 'manu-buddies-anfrage');
check('Tableiste zeigt Zähler für die Anfrage', (await m.$('.tabbar .badge')) !== null);
await m.click('[data-act="bud-accept"]'); await m.waitForTimeout(800);
check('Manu und Lena befreundet', (await q1("select count(*)::int n from public.friendships where status='accepted'"))[0].n === 2);
check('Manu ist Crew-Chef', await m.evaluate(() => isOwner()));
await go(m, '#crew'); await m.click('[data-act="crew-invite"]'); await m.waitForTimeout(300); await shot(m, 'crew-einladen');
await m.click('[data-act="crew-invite-yes"]'); await m.waitForTimeout(800);
await syncAll(l); await go(l, '#buddies'); await shot(l, 'lena-crew-einladung');
await l.click('[data-act="crew-join"]'); await l.waitForTimeout(1000);
check('Crew hat 3 Mitglieder', (await q1('select count(*)::int n from public.crew_members'))[0].n === 3);
for (const p of [m, r, l]) await syncAll(p);
await go(m, '#crew'); await shot(m, 'crew-info');
await go(l, '#buddies'); await shot(l, 'lena-buddies-crew');
// Lena sieht ältere Trainings von Manu und Rob (nachgeladen)
const lenaSees = await l.evaluate(() => st().workouts.filter(w => w.person !== cfg.me).length), allW = await m.evaluate(() => st().workouts.length);
check('Lena sieht alle älteren Trainings der Crew', lenaSees === allW, lenaSees + ' von ' + allW);
// Manu: Lenas Einträge nachladen (neu in PEOPLE)
check('Manus Liste enthält Lena', await m.evaluate(id => PEOPLE.includes(id), ids.l));
await syncAll(l); await syncAll(m);
check('Lena übernimmt den Crew-Plan, keine alten Änderungen in der Glocke', (await l.evaluate(() => bellItems().filter(x => x.status === 'open').length)) === 0 && (await m.evaluate(() => bellItems().filter(x => x.status === 'open' && x.pc.person !== cfg.me).every(x => x.diff.length))), await l.evaluate(() => bellItems().map(x => x.diff.map(diffText).join(';')).join(' | ')));

// 3) Crew-Chat
await go(m, '#chat:' + encodeURIComponent('crew:' + (await m.evaluate(() => CREW.id))));
await m.fill('#chat-in', 'Heute 18 Uhr Beine?'); await m.press('#chat-in', 'Enter'); await m.waitForTimeout(1200); await m.evaluate(() => chatSync()); await m.waitForTimeout(500);
for (const p of [r, l]) await p.evaluate(() => chatSync());
const rc = await r.evaluate(() => chatWith(crewKey()).map(x => x.text)), lc = await l.evaluate(() => chatWith(crewKey()).map(x => x.text));
check('Rob und Lena lesen den Crew-Chat', rc.includes('Heute 18 Uhr Beine?') && lc.includes('Heute 18 Uhr Beine?'), rc.join('|') + ' / ' + lc.join('|'));
await l.evaluate(() => chatSend(crewKey(), 'Bin dabei!')); await l.waitForTimeout(800); await l.evaluate(() => chatSync()); await m.evaluate(() => chatSync());
await go(m, '#chat:' + encodeURIComponent(await m.evaluate(() => crewKey())), 900); await shot(m, 'crew-chat');
const plain = await q1("select count(*)::int n from public.messages where crew_id is not null and ct like '%Beine%'");
check('Crew-Nachrichten verschlüsselt', plain[0].n === 0);
await go(m, '#chats'); await shot(m, 'chats');

// 4) Spot von Rob an alle
await r.evaluate(async () => { const c = document.createElement('canvas'); c.width = 60; c.height = 80; c.getContext('2d').fillStyle = '#e0f'; c.getContext('2d').fillRect(0, 0, 60, 80);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg')); await SDB.put('gallery', { id: uid(), person: cfg.me, created: new Date().toISOString(), meta: { kind: 'none' }, img: await blob.arrayBuffer(), shared: false, up: false }); await loadSpots(); await spotSync(); });
const sp = await q1('select s.id, (select count(*)::int from public.spot_recipients r where r.spot_id = s.id) n from public.spots s');
check('Spot hochgeladen, 2 Empfänger', sp.length === 1 && sp[0].n === 2, JSON.stringify(sp));
for (const p of [m, l]) await p.evaluate(() => spotSync());
const inbox = await Promise.all([m, l].map(p => p.evaluate(async () => (await SDB.all('inbox')).length)));
check('Manu und Lena haben den Spot', inbox[0] === 1 && inbox[1] === 1, inbox.join(','));
await go(m, '#start', 900); await shot(m, 'start-spotring');

// 5) Wochenziel und Flammen
await go(m, '#profil'); await shot(m, 'profil-eigen');
await m.click('[data-act="id-sheet"]'); await m.waitForTimeout(300); await shot(m, 'buddy-id-qr');
check('QR-Code wird gezeichnet', (await m.$('#modal svg[aria-label="QR-Code"]')) !== null); await m.evaluate(() => closeModal());
await m.click('[data-act="goal-open"]'); await m.waitForTimeout(200); await m.click('[data-act="goal-pick"][data-v="5"]'); await shot(m, 'wochenziel'); await m.click('[data-act="goal-save"]'); await m.waitForTimeout(800);
const wg = (await q1('select week_goal, week_goal_next, week_goal_from from public.profiles where id=$1', [ids.m]))[0];
check('Wochenziel gilt ab nächstem Montag', wg.week_goal_next === 5 && !!wg.week_goal_from, JSON.stringify(wg));
await go(m, '#start'); await m.evaluate(() => { FLAME_OPEN.add(cfg.me); render(); }); await m.evaluate(() => document.getElementById('flammen').scrollIntoView()); await shot(m, 'flammen');
check('Flammen-Liste zeigt x/Ziel', /\d\/\d/.test(await m.textContent('.fl-list')));
await go(m, '#profil:' + ids.l); await shot(m, 'profil-lena');

// 6) Glocke: Rob ändert den Crew-Plan, Manu und Lena bekommen es
await r.evaluate(() => { planKind = 'crew'; builder = null; location.hash = '#plan'; }); await r.waitForTimeout(400);
await r.evaluate(() => { const w = builder.work[builder.day]; w.exercises.splice(0, 1); markDirty(); savePlan(); }); await r.waitForTimeout(500);
for (const p of [r, m, l]) await syncAll(p);
const bm = await m.evaluate(id => bellItems().filter(x => x.pc.person === id && x.status === 'open').length, ids.r);
const bl = await l.evaluate(id => bellItems().filter(x => x.pc.person === id && x.status === 'open').length, ids.r);
check('Manu und Lena bekommen Robs Planänderung', bm >= 1 && bl >= 1, `${bm} / ${bl}`);
await go(l, '#glocke'); await shot(l, 'lena-glocke');

// 7) Melden und Blockieren: Lena blockiert Rob (gleiche Crew, kein Chef) → Lena verlässt die Crew
await go(l, '#profil:' + ids.r); await l.click('[data-act="bud-menu"]'); await l.waitForTimeout(200); await shot(l, 'buddy-menue');
await l.click('[data-act="bud-block"]'); await l.waitForTimeout(200); await shot(l, 'blockieren'); await l.click('[data-act="bud-block-yes"]'); await l.waitForTimeout(1200);
check('Lena hat die Crew verlassen', (await q1('select count(*)::int n from public.crew_members where user_id=$1', [ids.l]))[0].n === 0);
check('Block gespeichert', (await q1('select count(*)::int n from public.blocks'))[0].n === 1);
await syncAll(l); check('Lena sieht Rob nicht mehr', await l.evaluate(id => !PEOPLE.includes(id), ids.r));
await syncAll(m); check('Manu ist noch mit Lena befreundet', await m.evaluate(id => PEOPLE.includes(id), ids.l));
// Nachricht melden
await r.evaluate(() => chatSync()); const mid = await r.evaluate(() => chatWith(crewKey()).find(x => x.from !== cfg.me).id);
await go(r, '#chat:' + encodeURIComponent(await r.evaluate(() => crewKey())), 600);
await r.evaluate(id => { const b = document.createElement('button'); b.dataset.act = 'cm-report'; b.dataset.id = id; document.body.appendChild(b); b.click(); }, mid); await r.waitForTimeout(300); await shot(r, 'nachricht-melden');
await r.click('[data-act="cm-report-yes"]'); await r.waitForTimeout(600);
check('Meldung mit Inhalt gespeichert', (await q1("select count(*)::int n from public.reports where target_type='message' and content is not null"))[0].n === 1);
await go(r, '#scanner', 800); await shot(r, 'scanner');

console.log(checks.join('\n'));
console.log('Fehler:', errs.slice(0, 12));
await b.close(); web.close(); sbs.close(); process.exit(0);
