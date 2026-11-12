// Schritt 5: Privatsphäre, Einwilligungen, Export, Konto löschen, Feedback, Rechtliches
import { makeDb, serve } from './mocksb.mjs';
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = '/home/claude/hantelbuch-v0.01', OUT = '/tmp/claude-0/-home-claude/99c271a0-0469-5ca9-be56-a6d31b215667/scratchpad/shots/e2e5';
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
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const m = await c.newPage(); m.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1])); m.on('console', x => { if (x.type() === 'error' && !/Failed to load resource/.test(x.text())) errs.push('console: ' + x.text()); });
await m.goto('http://localhost:8780/'); await m.evaluate(() => { localStorage.clear(); localStorage.setItem('built.sb.url', 'http://localhost:54321'); }); await m.reload(); await m.waitForTimeout(400);
async function login(code) {
  await m.click('[data-act="onb-go"][data-v="email"]'); await m.fill('#onb-in', 'manu@test.de'); await m.click('[data-act="onb-send"]');
  await m.waitForSelector('.otpboxes'); await m.type('#onb-in', '123456');
  if (!code) { await m.waitForTimeout(2500); return; }
  await m.waitForSelector('[data-act="onb-claim"]'); await m.fill('#onb-in', code); await m.click('[data-act="onb-claim"]'); await m.waitForSelector('text=Willkommen zurück');
  await m.click('[data-act="onb-go"][data-v="profile"]'); await m.click('[data-act="onb-name"]'); await m.waitForSelector('.wz'); await m.click('[data-act="onb-goalok"]');
  await m.waitForSelector('[data-onb="ok"]'); await m.check('[data-onb="ok"]'); await m.click('[data-act="onb-privacy"]'); await m.waitForSelector('.buddyid'); await m.click('[data-act="onb-done"][data-v="later"]'); await m.waitForTimeout(2500);
}
const go = async (h, ms = 600) => { await m.evaluate(h => { location.hash = h; }, h); await m.waitForTimeout(ms); };
let n = 0; const shot = async (name, full = false) => { await m.waitForTimeout(250); await m.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }); };
await login('MANU1234');
const me = await m.evaluate(() => cfg.me);
check('Datenschutz-Einwilligung aus der Anmeldung gespeichert', (await q1("select count(*)::int n from public.consents where kind='privacy' and granted"))[0].n === 1);

// Körpergewicht: erst Einwilligung
await go('#gewicht'); await m.fill('#bw-in', '88,4'); await m.click('[data-act="bw-save"]'); await m.waitForTimeout(300); await shot('gesundheit-einwilligung');
check('Ohne Einwilligung kein Eintrag', (await m.evaluate(() => pending.filter(e => e.type === 'bodyweight').length)) === 0);
await m.click('[data-act="health-yes"]'); await m.waitForTimeout(800); await m.evaluate(() => sync({ quiet: true })); await m.waitForTimeout(600);
const bw = (await q1("select count(*)::int n from public.events where user_id=$1 and type='bodyweight'", [me]))[0].n;
check('Nach Einwilligung gespeichert', bw >= 1 && (await q1("select count(*)::int n from public.consents where kind='health' and granted"))[0].n === 1, bw + ' Einträge');
// Vault anlegen braucht die Einwilligung nicht erneut
await go('#privatsphaere'); await shot('privatsphaere');
await m.click('[data-act="health-withdraw"]'); await m.waitForTimeout(200); await shot('widerrufen');
await m.click('[data-act="health-del"]'); await m.waitForTimeout(1000);
check('Widerruf löscht Körpergewicht', (await q1("select count(*)::int n from public.events where user_id=$1 and type='bodyweight'", [me]))[0].n === 0);
check('Widerruf gespeichert', await m.evaluate(() => !hasConsent('health')));
await go('#profil'); await go('#vault', 800);
check('Vault ohne Einwilligung: erst fragen', await m.isVisible('[data-act="health-yes"]')); await m.evaluate(() => closeModal());
// Statistik
await m.click('#stats-tgl').catch(() => {}); await go('#privatsphaere'); await m.click('label:has(#stats-tgl)'); await m.waitForTimeout(600);
check('Statistik-Einwilligung', (await q1("select granted from public.consents where kind='analytics' order by id desc limit 1"))[0]?.granted === true);
await go('#plan'); await go('#buddies'); await m.evaluate(() => flushUsage()); await m.waitForTimeout(400);
check('Nutzung gezählt (nur Bereiche)', (await q1('select count(*)::int n from public.usage_events'))[0].n >= 2, JSON.stringify(await q1('select name from public.usage_events')));
await m.evaluate(() => statsSheet()); await shot('statistik-abfrage'); await m.evaluate(() => closeModal());
// Export
await go('#daten'); await m.click('[data-act="data-export"]'); await m.waitForTimeout(800); await shot('deine-daten');
const exp = await m.evaluate(async () => { const t = JSON.parse(await DATA.file.text()); return { ev: t.data.events.length, prof: !!t.data.profile, notes: Array.isArray(t.data.notes) }; });
check('Export enthält Profil, Trainings und Notizen', exp.prof && exp.ev > 5 && exp.notes, JSON.stringify(exp));
// Feedback
await go('#feedback'); await m.click('[data-act="fb-kind"][data-v="fehler"]'); await m.fill('#fb-text', 'Beim Wischen springt die Liste.'); await shot('feedback'); await m.click('[data-act="fb-send"]'); await m.waitForTimeout(600);
check('Feedback gespeichert', (await q1("select count(*)::int n from public.feedback where kind='fehler'"))[0].n === 1);
// Rechtliches
await go('#ueber'); await shot('ueber');
await go('#rechtliches:datenschutz'); await shot('datenschutz', true);
// Konto löschen, abmelden, wieder anmelden, zurücknehmen
await go('#daten'); await m.click('[data-act="del-ask"]'); await m.waitForTimeout(200); await shot('konto-loeschen');
await m.click('[data-act="del-yes"]'); await m.waitForTimeout(2000);
check('Löschung beantragt und abgemeldet', (await q1('select deleted_at is not null d from public.profiles where id=$1', [me]))[0].d && await m.isVisible('[data-act="onb-go"]'));
await login(null); await m.waitForTimeout(800); await shot('loeschung-beantragt');
check('Nach Anmeldung: Hinweis auf beantragte Löschung', (await m.evaluate(() => location.hash)) === '#daten' && (await m.textContent('main')).includes('Löschung beantragt'));
await m.click('[data-act="del-cancel"]'); await m.waitForTimeout(800);
check('Löschung zurückgenommen', (await q1('select deleted_at is null d from public.profiles where id=$1', [me]))[0].d);

console.log(checks.join('\n'));
console.log('Fehler:', errs.slice(0, 12));
await b.close(); web.close(); sbs.close(); process.exit(0);
