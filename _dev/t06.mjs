import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
const db = new PGlite({ extensions: { pgcrypto } });
const S = '../supabase/';
await db.exec(fs.readFileSync('prelude.sql', 'utf8'));
await db.exec(fs.readFileSync(S + '01-schema.sql', 'utf8').replace(/create extension if not exists pg_cron[^;]*;/, ''));
await db.exec(fs.readFileSync(S + '02-anpassung.sql', 'utf8'));
const s06 = fs.readFileSync(S + '06-update-3.0.sql', 'utf8');
await db.exec(s06); await db.exec(s06); console.log('06 zweimal ok');
const U = { A: '00000000-0000-0000-0000-00000000000a', B: '00000000-0000-0000-0000-00000000000b', C: '00000000-0000-0000-0000-00000000000c' };
for (const k in U) await db.query('insert into auth.users (id) values ($1)', [U[k]]);
const as = async (u, sql, params = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u || ''}', false); set role ${u ? 'authenticated' : 'anon'};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
let F = 0; const ok = (n, c) => { if (!c) F++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const fails = async (n, f) => { try { await f(); ok(n + ' (müsste scheitern)', false); } catch (e) { ok(n + ' → ' + e.message.slice(0, 70), true); } };
await as(U.A, "update public.profiles set name='Manu' where id=$1", [U.A]); await as(U.B, "update public.profiles set name='Rob' where id=$1", [U.B]); await as(U.C, "update public.profiles set name='Lena' where id=$1", [U.C]);
for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) { await as(U[x], 'select public.send_friend_request($1)', [U[y]]); await as(U[y], 'select public.respond_friend_request($1, true)', [U[x]]); }
// Wochenziel
await as(U.A, 'select public.set_week_goal(5)');
ok('Wochenziel ohne Training sofort', (await db.query('select week_goal from public.profiles where id=$1', [U.A])).rows[0].week_goal === 5);
await as(U.A, `insert into public.events (id, ts, type, data) values ('w1', now(), 'workout', '{"date":"2026-11-12","entries":[{"exId":"bank","sets":[]}]}')`);
const d = (await as(U.A, 'select public.set_week_goal(3) d')).rows[0].d;
const p = (await db.query('select week_goal, week_goal_next, week_goal_from from public.profiles where id=$1', [U.A])).rows[0];
ok('Wochenziel nach Training ab Montag ' + d, p.week_goal === 5 && p.week_goal_next === 3 && String(p.week_goal_from).length > 0);
await fails('Wochenziel 7', () => as(U.A, 'select public.set_week_goal(7)'));
await fails('Zweites Training am selben Tag', () => as(U.A, `insert into public.events (id, ts, type, data) values ('w2', now(), 'workout', '{"date":"2026-11-12"}')`));
await as(U.A, `insert into public.events (id, ts, type, data) values ('w3', now(), 'workout', '{"date":"2026-11-13"}')`);
ok('Training am nächsten Tag geht', true);
// privat
await as(U.A, `insert into public.events (id, ts, type, data, private) values ('pm1', now(), 'plan_change', '{}', true)`);
ok('B sieht A-Training, aber nicht privaten Plan', JSON.stringify((await as(U.B, 'select id from public.events where user_id=$1 order by id', [U.A])).rows.map(r => r.id)) === '["w1","w3"]');
// Crew
const crew = (await as(U.A, "select public.create_crew('Eisen') c")).rows[0].c;
await as(U.A, 'select public.invite_to_crew($1)', [U.B]); await as(U.B, 'select public.join_crew($1)', [crew]);
await as(U.A, 'select public.invite_to_crew($1)', [U.C]); await as(U.C, 'select public.join_crew($1)', [crew]);
// Notizen
await as(U.A, "insert into public.notes (id, scope, ex_id, body) values ('n1', 'private', 'bank', 'Schulter beobachten')");
await as(U.A, "insert into public.notes (id, scope, crew_id, ex_id, body) values ('n2', 'crew', $1, 'bank', 'Griff enger')", [crew]);
ok('B sieht nur Crew-Notiz', JSON.stringify((await as(U.B, 'select id from public.notes')).rows.map(r => r.id)) === '["n2"]');
await fails('Notiz mit gesperrtem Wort', () => as(U.B, "insert into public.notes (id, scope, crew_id, ex_id, body) values ('n3', 'crew', $1, 'bank', 'sieg heil')", [crew]));
await fails('Crew-Notiz in fremde Crew', () => as(U.B, "insert into public.notes (id, scope, crew_id, ex_id, body) values ('n4', 'crew', gen_random_uuid(), 'bank', 'x')"));
await as(U.B, "update public.notes set body='geändert' where id='n2'");
ok('B kann fremde Notiz nicht ändern', (await db.query("select body from public.notes where id='n2'")).rows[0].body === 'Griff enger');
await as(U.A, "update public.notes set body='Griff etwas enger', edited_at=now() where id='n2'");
ok('A ändert eigene Notiz', (await db.query("select body from public.notes where id='n2'")).rows[0].body === 'Griff etwas enger');
// Bibliothek
await db.query(`insert into public.library (id, owner, data) values ('bankdips', null, '{"name":"Bankdips"}')`);
await fails('Grundbestand ändern', async () => { const r = await as(U.A, `update public.library set data='{"name":"X"}' where id='bankdips' returning id`); if (!r.rows.length) throw new Error('keine Zeile geändert'); });
await fails('Eigene Übung gleicher Name', () => as(U.A, `insert into public.library (id, owner, data) values ('own1', $1, '{"name":"bankdips "}')`, [U.A]));
await as(U.A, `insert into public.library (id, owner, crew_id, data) values ('own2', $1, $2, '{"name":"Bankdips mit Gewicht"}')`, [U.A, crew]);
ok('C sieht Crew-Übung', (await as(U.C, "select id from public.library where id='own2'")).rows.length === 1);
await as(U.C, `insert into public.events (id, ts, type, data) values ('wc', now(), 'workout', '{"date":"2026-11-12","entries":[{"exId":"own2"}]}')`);
await as(U.C, "insert into public.notes (id, scope, crew_id, ex_id, body) values ('nc', 'crew', $1, 'own2', 'Gürtel mitnehmen')", [crew]);
await fails('C ändert As Übung', async () => { const r = await as(U.C, `update public.library set data='{"name":"Y"}' where id='own2' returning id`); if (!r.rows.length) throw new Error('keine Zeile'); });
// Austritt
await as(U.C, 'select public.leave_crew()');
ok('C sieht genutzte Crew-Übung weiter', (await as(U.C, "select id from public.library where id='own2'")).rows.length === 1);
ok('C hat Notiz privat mitgenommen', (await as(U.C, "select id, scope from public.notes where user_id=$1 order by id", [U.C])).rows.map(r => r.id + ':' + r.scope).join() === 'nc:crew,nc-p:private');
ok('A sieht Cs Crew-Notiz weiter', (await as(U.A, "select id from public.notes where id='nc'")).rows.length === 1);
ok('C sieht Crew-Notizen nicht mehr', (await as(U.C, "select id from public.notes where id='n2'")).rows.length === 0);
// Blockieren in der Crew
await as(U.B, "insert into public.messages (id, crew_id, iv, ct) values ('cm', $1, 'iv', 'ct')", [crew]);
await as(U.B, 'select public.block_user($1)', [U.A]);
ok('B (Mitglied) hat Crew verlassen', (await db.query('select * from public.crew_members where user_id=$1', [U.B])).rows.length === 0);
ok('A sieht keine Ereignisse von B mehr', (await as(U.A, 'select id from public.events where user_id=$1', [U.B])).rows.length === 0);
ok('A sieht Bs Crew-Notizen nicht', (await as(U.A, 'select id from public.notes where user_id=$1', [U.B])).rows.length === 0);
ok('A sieht Bs Crew-Nachricht nicht', (await as(U.A, "select id from public.messages where id='cm'")).rows.length === 0);
// Chef entfernt
await as(U.A, 'select public.invite_to_crew($1)', [U.C]); await as(U.C, 'select public.join_crew($1)', [crew]);
await fails('Mitglied entfernt Chef', () => as(U.C, 'select public.remove_from_crew($1)', [U.A]));
await as(U.A, 'select public.remove_from_crew($1)', [U.C]);
ok('Chef hat C entfernt', (await db.query('select * from public.crew_members where user_id=$1', [U.C])).rows.length === 0);
// Melden, Feedback
await as(U.A, "insert into public.reports (target_type, target_id, reason) values ('note', 'nc', 'Spam')");
await as(U.A, "insert into public.feedback (kind, text) values ('uebung', 'Bankdips mit Gewicht in die Bibliothek')");
ok('Melden Notiz + Übungsvorschlag', true);
// Alte Chats
await db.query("insert into public.legacy_claims (legacy_name, code_hash) values ('Manu', encode(extensions.digest('TESTCODE1','sha256'),'hex')), ('Rob', encode(extensions.digest('TESTCODE2','sha256'),'hex')) on conflict do nothing");
await db.query("insert into public.legacy_messages values ('lm1','Manu','Rob',now(),'abc'),('lm2','Rob','Manu',now(),'def')");
await as(U.A, "select public.claim_legacy('Manu', 'testcode1')");
let lm = (await as(U.A, 'select * from public.my_legacy_messages()')).rows;
ok('A bekommt nur eigene gesendete, Empfänger noch offen', lm.length === 1 && lm[0].id === 'lm1' && lm[0].recipient === null);
await as(U.B, "select public.claim_legacy('Rob', 'testcode2')");
lm = (await as(U.A, 'select * from public.my_legacy_messages()')).rows;
ok('Nach Robs Übernahme ist Empfänger bekannt', lm[0].recipient === U.B);
await as(U.B, "select public.drop_legacy_message('lm1')");
ok('B kann As alte Nachricht nicht löschen', (await db.query("select * from public.legacy_messages where id='lm1'")).rows.length === 1);
await as(U.A, "select public.drop_legacy_message('lm1')");
ok('A löscht nach Neu-Verschlüsselung', (await db.query("select * from public.legacy_messages where id='lm1'")).rows.length === 0);
const ex = (await as(U.A, 'select public.export_my_data() x')).rows[0].x;
ok('Export enthält Notizen', Array.isArray(ex.notes) && ex.notes.length >= 2);
await db.exec("update public.profiles set week_goal_from = current_date where id = '" + U.A + "'"); await db.exec('select public.daily_cleanup()');
ok('Nacht: neues Wochenziel übernommen', (await db.query('select week_goal, week_goal_next from public.profiles where id=$1', [U.A])).rows[0].week_goal === 3);
console.log(F ? F + ' FEHLER' : 'alles ok');
