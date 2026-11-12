// Schritt 2: Vault-Sicherung, Chat-Schlüssel, Übernahme alter Chats, zweites Handy mit Wiederherstellung
import { makeDb, serve } from './mocksb.mjs';
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { webcrypto as wc } from 'crypto';
const ROOT = '/home/claude/hantelbuch-v0.01', OUT = '/tmp/claude-0/-home-claude/99c271a0-0469-5ca9-be56-a6d31b215667/scratchpad/shots/e2e2';
fs.mkdirSync(OUT, { recursive: true });
const OLD = 'alter-sync-schluessel-test';
const db = await makeDb({ importFiles: ['../imp_test/02-import-daten.sql'] });
await db.exec("insert into public.legacy_claims (legacy_name, code_hash) values ('Manu', encode(extensions.digest('MANU1234','sha256'),'hex')), ('Rob', encode(extensions.digest('ROBB5678','sha256'),'hex')) on conflict (legacy_name) do update set code_hash = excluded.code_hash, claimed_by = null");
// alte Chats, verschlüsselt wie in 2.2.1
const base = await wc.subtle.importKey('raw', new TextEncoder().encode(OLD), 'HKDF', false, ['deriveKey']);
const ok = await wc.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('hantelbuch-chat'), info: new TextEncoder().encode('chat') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const encOld = async o => { const iv = wc.getRandomValues(new Uint8Array(12)); const ct = await wc.subtle.encrypt({ name: 'AES-GCM', iv }, ok, new TextEncoder().encode(JSON.stringify(o))); return Buffer.from(iv).toString('base64') + '.' + Buffer.from(ct).toString('base64'); };
const t0 = new Date(Date.now() - 2 * 864e5).toISOString(), t1 = new Date(Date.now() - 864e5).toISOString(), told = new Date(Date.now() - 40 * 864e5).toISOString();
await db.exec('truncate public.legacy_messages');
await db.query('insert into public.legacy_messages values ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)', [
  'alt-1', 'Manu', 'Rob', t0, await encOld({ text: 'Alte Nachricht von Manu' }),
  'alt-2', 'Rob', 'Manu', t1, await encOld({ text: 'Alte Antwort von Rob' }),
  'alt-3', 'Manu', 'Rob', told, await encOld({ text: 'Zu alt' })]);
const sbs = await serve(db);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const web = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(8780);
const b = await chromium.launch();
const errs = []; const checks = [];
const check = (name, cond, info = '') => { checks.push(`${cond ? 'ok  ' : 'FEHLER'} ${name}${info !== '' ? ' · ' + info : ''}`); };
async function phone(who, legacy) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(who + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(who + ' console: ' + m.text()); });
  await p.goto('http://localhost:8780/');
  await p.evaluate(([legacy, OLD, t0]) => {
    localStorage.clear(); localStorage.setItem('built.sb.url', 'http://localhost:54321');
    if (legacy) {   // Handy mit 2.2.1: alte Konfiguration und lokale Chats unter dem Namen
      localStorage.setItem('hb.cfg', JSON.stringify({ me: legacy, url: 'https://script.google.com/x', key: OLD }));
      localStorage.setItem('hb.chat.msgs.' + legacy, JSON.stringify([{ id: 'lokal-1', from: legacy, to: legacy === 'Manu' ? 'Rob' : 'Manu', ts: t0, text: 'Nur lokal aus 2.2.1' }]));
    }
  }, [legacy, OLD, t0]);
  await p.reload(); await p.waitForTimeout(500); return p;
}
async function onboard(p, email, code) {
  await p.click('[data-act="onb-go"][data-v="email"]'); await p.fill('#onb-in', email); await p.click('[data-act="onb-send"]');
  await p.waitForSelector('.otpboxes'); await p.type('#onb-in', '123456');
  if (!code) { await p.waitForTimeout(2500); return; }
  await p.waitForSelector('[data-act="onb-claim"]'); await p.fill('#onb-in', code); await p.click('[data-act="onb-claim"]'); await p.waitForSelector('text=Willkommen zurück');
  await p.click('[data-act="onb-go"][data-v="profile"]'); await p.click('[data-act="onb-name"]'); await p.waitForSelector('.wz'); await p.click('[data-act="onb-goalok"]');
  await p.waitForSelector('[data-onb="ok"]'); await p.check('[data-onb="ok"]'); await p.click('[data-act="onb-privacy"]'); await p.waitForSelector('.buddyid'); await p.click('[data-act="onb-done"][data-v="later"]'); await p.waitForTimeout(2500);
}
const syncAll = p => p.evaluate(async () => { await sync({ quiet: true }); await chatSync(); await vaultSync(); });
const msgs = p => p.evaluate(() => { loadChat(); return CHAT.msgs.map(m => `${pname(m.from)}→${pname(m.to)}: ${m.text}${m.pend ? ' (wartet)' : ''}`); });

// 1) Manu übernimmt zuerst (Rob noch nicht da: Manus alte Nachricht wartet)
const m = await phone('Manu', 'Manu'); await onboard(m, 'manu@test.de', 'MANU1234'); await syncAll(m);
check('Manu: Chat-Schlüssel angelegt', (await db.query("select count(*)::int n from public.keys")).rows[0].n === 1);
check('Manu: alte Nachricht wartet auf Rob', (await db.query("select count(*)::int n from public.legacy_messages where id='alt-1'")).rows[0].n === 1);
check('Manu: zu alte Nachricht verworfen', (await db.query("select count(*)::int n from public.legacy_messages where id='alt-3'")).rows[0].n === 0);
check('Manu: lokale 2.2.1-Nachricht aufgehoben', (await m.evaluate(() => CHAT.hold.length)) === 1);

// 2) Rob übernimmt: seine alte Nachricht geht sofort neu verschlüsselt an Manu
const r = await phone('Rob', 'Rob'); await onboard(r, 'rob@test.de', 'ROBB5678'); await syncAll(r);
check('Rob: alte Nachricht neu verschlüsselt', (await db.query("select count(*)::int n from public.messages where id='alt-2'")).rows[0].n === 1);
const plain = (await db.query("select ct from public.messages where id='alt-2'")).rows[0];
check('Server sieht keinen Klartext', plain && !String(plain.ct).includes('Antwort'));
// 3) Manu öffnet die App erneut: seine wartende Nachricht wird übernommen, Robs kommt an
await m.reload(); await m.waitForTimeout(1500); await syncAll(m); await m.evaluate(() => chatSync());
check('Manu: alte Nachricht übernommen', (await db.query("select count(*)::int n from public.legacy_messages")).rows[0].n === 0);
const mm = await msgs(m); check('Manu liest Robs alte Nachricht', mm.some(x => x.includes('Alte Antwort von Rob')), mm.join(' | '));
check('Manu: lokale 2.2.1-Nachricht jetzt sichtbar', mm.some(x => x.includes('Nur lokal')));
// 4) neue Nachricht Manu → Rob
await m.evaluate(() => chatSend(others()[0], 'Heute Beine?')); await m.waitForTimeout(1500);
await r.evaluate(() => chatSync()); await r.waitForTimeout(500);
const rm = await msgs(r); check('Rob liest neue und alte Nachrichten von Manu', rm.some(x => x.includes('Heute Beine?')) && rm.some(x => x.includes('Alte Nachricht von Manu')), rm.join(' | '));
await r.goto('http://localhost:8780/#chats'); await r.waitForTimeout(800); await r.screenshot({ path: `${OUT}/01-rob-chats.png` });
const mid = await r.evaluate(() => others()[0]); await r.goto('http://localhost:8780/#chat:' + encodeURIComponent(mid)); await r.waitForTimeout(800); await r.screenshot({ path: `${OUT}/02-rob-chat.png` });

// 5) Manu legt einen Vault an und speichert ein Bild; Sicherung inkl. Chat-Schlüssel
const rk = await m.evaluate(async () => {
  const raw = crypto.getRandomValues(new Uint8Array(20)); const k = await rawKeys(raw);
  LS.set('vault.' + cfg.me, await wrapMeta('2468', raw, true)); await unlocked({ dk: k.dk, raw, token: k.token, gk: k.gk });
  const em = await encJSON(VAULT.key, { date: todayStr(), note: 'Test', bw: 82 }); const ei = await encBytes(VAULT.key, new Uint8Array([1, 2, 3, 4]));
  await IDB.put({ id: 'bild-1', person: cfg.me, created: new Date().toISOString(), miv: em.iv, meta: em.ct.buffer, iiv: ei.iv, img: ei.ct.buffer, up: false });
  await new Promise(res => setTimeout(res, 800)); const s = await vaultSync(); return { key: rkEncode(raw), s };
});
check('Vault-Sync ok', rk.s && rk.s.ok, JSON.stringify(rk.s));
const vrows = (await db.query("select id from public.vault order by id")).rows.map(x => x.id);
check('Vault: Bild und Chat-Schlüssel gesichert', vrows.includes('bild-1') && vrows.includes('k-chat'), vrows.join(','));
await m.goto('http://localhost:8780/#einstellungen'); await m.waitForTimeout(800); await m.screenshot({ path: `${OUT}/03-manu-einstellungen.png`, fullPage: true });

// 6) Manu auf einem neuen Handy: Konto bekannt, Chats warten auf den Vault, Wiederherstellung mit Schlüssel
const m2 = await phone('Manu2', null); await onboard(m2, 'manu@test.de', null); await m2.evaluate(() => chatSync());
check('Neues Handy: Chat wartet auf Vault', (await m2.evaluate(() => CK.state)) === 'vault');
await m2.goto('http://localhost:8780/#chats'); await m2.waitForTimeout(800); await m2.screenshot({ path: `${OUT}/04-neues-handy-chats.png` });
await m2.goto('http://localhost:8780/#vault-wiederherstellen'); await m2.waitForTimeout(500);
await m2.fill('#rk-in', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'); await m2.click('#rk-go'); await m2.waitForTimeout(800);
check('Falscher Schlüssel abgelehnt', (await m2.textContent('#rk-err')).includes('passt nicht'), await m2.textContent('#rk-err'));
await m2.fill('#rk-in', rk.key); await m2.click('#rk-go'); await m2.waitForTimeout(800);
await m2.evaluate(async () => { VAULT.pin = '1357'; await pinComplete(); VAULT.pin = '1357'; await pinComplete(); });
await m2.waitForTimeout(2500);
const st2 = await m2.evaluate(() => ({ n: (VAULT.entries || []).length, ck: CK.state }));
check('Neues Handy: Bild wiederhergestellt', st2.n === 1, JSON.stringify(st2));
check('Neues Handy: Chat-Schlüssel aus dem Vault', st2.ck === 'ok');
await m2.evaluate(() => chatSync()); await m2.waitForTimeout(500);
const m2m = await msgs(m2); check('Neues Handy liest die Chats', m2m.some(x => x.includes('Heute Beine?')) && m2m.some(x => x.includes('Alte Antwort von Rob')), m2m.join(' | '));
// 7) Abmelden
await m2.goto('http://localhost:8780/#einstellungen'); await m2.waitForTimeout(500); await m2.click('[data-act="logout-ask"]'); await m2.click('[data-act="logout-yes"]'); await m2.waitForTimeout(800);
check('Abmelden führt zur Anmeldung', await m2.isVisible('[data-act="onb-go"]'));
await m2.screenshot({ path: `${OUT}/05-abgemeldet.png` });

console.log(checks.join('\n'));
console.log('Fehler:', errs.slice(0, 10));
await b.close(); web.close(); sbs.close(); process.exit(0);
