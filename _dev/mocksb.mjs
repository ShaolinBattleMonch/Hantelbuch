// Lokaler Supabase-Ersatz für Tests: PGlite mit den echten Skripten 01/02/06,
// dazu ein kleiner Server, der die von supabase-js genutzten Endpunkte nachbildet
// (Auth per E-Mail-Code 123456, REST-Teilmenge, RPC). Zeilenrechte über set role + jwt.claim.sub.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import http from 'http'; import fs from 'fs'; import crypto from 'crypto';

export async function makeDb({ importFiles = [] } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  const S = '/home/claude/hantelbuch-v0.01/_dev/supabase/';
  await db.exec(fs.readFileSync(new URL('prelude.sql', import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(S + '01-schema.sql', 'utf8').replace(/create extension if not exists pg_cron[^;]*;/, ''));
  await db.exec(fs.readFileSync(S + '02-anpassung.sql', 'utf8'));
  await db.exec(fs.readFileSync(S + '06-update-3.0.sql', 'utf8'));
  await db.exec(fs.readFileSync(S + '07-anmeldung.sql', 'utf8'));
  await db.exec(fs.readFileSync(S + '08-datenschutz.sql', 'utf8'));
  for (const f of importFiles) await db.exec(fs.readFileSync(f, 'utf8'));
  return db;
}

const b64u = b => Buffer.from(b).toString('base64url');
const jwt = sub => `${b64u('{"alg":"none"}')}.${b64u(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 * 24 }))}.x`;
const subOf = h => { try { const t = (h || '').replace(/^Bearer /, '').split('.')[1]; return JSON.parse(Buffer.from(t, 'base64url')).sub || null; } catch (e) { return null; } };
const qid = s => '"' + String(s).replace(/"/g, '""') + '"';

export function serve(db, port = 54321) {
  const users = new Map(); // email -> id
  const FILES = new Map(); // bucket/pfad -> Buffer
  let q = Promise.resolve(); // Abfragen nacheinander (eine Verbindung)
  const run = (sub, fn) => { const p = q.catch(() => {}).then(async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub || ''}', false); set role ${sub ? 'authenticated' : 'anon'};`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }); q = p; return p; };
  const lit = (v, params) => { params.push(v); return '$' + params.length; };
  function where(sp, params) {
    const out = [];
    for (const [k, v] of sp) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.(.*)$/s.exec(v); if (!m) continue;
      const [, not, op, raw] = m; const c = qid(k); let e;
      if (op === 'is') e = `${c} is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
      else if (op === 'in') { const vals = raw.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')); e = `${c}::text in (${vals.map(x => lit(x, params)).join(',') || 'null'})`; }
      else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') e = `${c} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${lit(raw, params)}::text::${/^-?[0-9.]+$/.test(raw) ? 'numeric' : 'timestamptz'}`;
      else e = `${c}::text ${{ eq: '=', neq: '<>', like: 'like', ilike: 'ilike' }[op]} ${lit(raw.replace(/\*/g, '%'), params)}`;
      out.push(not ? `not (${e})` : e);
    }
    return out.length ? ' where ' + out.join(' and ') : '';
  }
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const srv = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c);
    const sub = subOf(req.headers.authorization);
    // ---- Speicher (Dateien im Arbeitsspeicher, Regeln wie in Skript 01) ----
    const sm = /^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (sm) {
      const bucket = sm[1], name = decodeURIComponent(sm[2] || ''), key = bucket + '/' + name, raw = Buffer.concat(chunks);
      const ownFolder = n => n.split('/')[0] === sub;
      if (!sub) return send(res, 401, { message: 'no' });
      if (req.method === 'POST' || req.method === 'PUT') {
        if (!ownFolder(name)) return send(res, 403, { statusCode: '403', message: 'new row violates row-level security policy' });
        if (FILES.has(key) && req.method === 'POST' && req.headers['x-upsert'] !== 'true') return send(res, 409, { statusCode: '409', message: 'The resource already exists' });
        FILES.set(key, raw); return send(res, 200, { Key: key, Id: key });
      }
      if (req.method === 'DELETE') {
        const prefixes = JSON.parse(raw.toString() || '{}').prefixes || [];
        const out = []; for (const n of prefixes) if (ownFolder(n) && FILES.delete(bucket + '/' + n)) out.push({ name: n });
        return send(res, 200, out);
      }
      if (req.method === 'GET') {
        let ok = ownFolder(name);
        if (!ok && bucket === 'spots') ok = (await run(sub, () => db.query('select public.can_read_spot_file($1) ok', [name]))).rows[0].ok;
        if (!ok && bucket === 'avatars') ok = (await run(sub, () => db.query('select public.can_see_folder($1, $2) ok', name.split('/')))).rows[0].ok;
        if (!ok || !FILES.has(key)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }); return res.end(FILES.get(key));
      }
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null;
    try {
      // ---- Auth ----
      if (url.pathname === '/auth/v1/otp') return send(res, 200, {});
      if (url.pathname === '/auth/v1/verify' || (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token')) {
        let email = body && body.email, id;
        if (url.pathname.endsWith('token')) { id = body.refresh_token; email = [...users].find(([, v]) => v === id)?.[0]; }
        else {
          if (body.token !== '123456') return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
          id = users.get(email);
          if (!id) { id = crypto.randomUUID(); users.set(email, id); await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]); }
        }
        const user = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
        return send(res, 200, { access_token: jwt(id), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: id, user });
      }
      if (url.pathname === '/auth/v1/user') { if (!sub) return send(res, 401, { msg: 'no' }); return send(res, 200, { id: sub, email: [...users].find(([, v]) => v === sub)?.[0], aud: 'authenticated', role: 'authenticated' }); }
      if (url.pathname === '/auth/v1/logout') return send(res, 204);
      // ---- RPC ----
      const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
      if (rpc) {
        const args = body || {}; const params = []; const named = Object.entries(args).map(([k, v]) => `${qid(k)} => ${lit(typeof v === 'object' && v !== null ? JSON.stringify(v) : v, params)}`);
        const r = await run(sub, () => db.query(`select * from public.${qid(rpc[1])}(${named.join(', ')})`, params));
        const rows = r.rows; const f = r.fields.length === 1 && r.fields[0].name === rpc[1];
        return send(res, 200, f ? (rows.length === 1 ? rows[0][rpc[1]] : rows.map(x => x[rpc[1]])) : rows);
      }
      // ---- Tabellen ----
      const tm = /^\/rest\/v1\/(\w+)$/.exec(url.pathname); if (!tm) return send(res, 404, { msg: 'unbekannt ' + url.pathname });
      const t = 'public.' + qid(tm[1]); const sp = url.searchParams; const params = [];
      const prefer = req.headers.prefer || ''; const wantRet = prefer.includes('return=representation');
      if (req.method === 'GET' || req.method === 'HEAD') {
        let sql = `select * from ${t}${where(sp, params)}`;
        if (sp.get('order')) sql += ' order by ' + sp.get('order').split(',').map(o => { const [c, d, n] = o.split('.'); return `${qid(c)} ${d === 'desc' ? 'desc' : 'asc'}${n === 'nullslast' ? ' nulls last' : ''}`; }).join(', ');
        if (sp.get('limit')) sql += ' limit ' + (+sp.get('limit'));
        if (sp.get('offset')) sql += ' offset ' + (+sp.get('offset'));
        const r = await run(sub, () => db.query(sql, params));
        const sel = sp.get('select'); let rows = r.rows;
        if (sel && sel !== '*') { const cols = sel.split(','); rows = rows.map(x => Object.fromEntries(cols.map(c => [c, x[c]]))); }
        const one = (req.headers.accept || '').includes('vnd.pgrst.object');
        if (one) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'not one row' });
        return send(res, 200, rows, { 'content-range': `0-${rows.length - 1}/*` });
      }
      if (req.method === 'POST') {
        const list = Array.isArray(body) ? body : [body]; const out = [];
        const ignore = prefer.includes('resolution=ignore-duplicates'); const merge = prefer.includes('resolution=merge-duplicates');
        for (const row of list) {
          const cols = Object.keys(row); const ps = [];
          const vals = cols.map(c => lit(row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c], ps));
          let sql = `insert into ${t} (${cols.map(qid).join(',')}) values (${vals.join(',')})`;
          const oc = sp.get('on_conflict');
          if (ignore) sql += oc ? ` on conflict (${oc.split(',').map(qid).join(',')}) do nothing` : ' on conflict do nothing';
          else if (merge && oc) sql += ` on conflict (${oc.split(',').map(qid).join(',')}) do update set ${cols.filter(c => !oc.split(',').includes(c)).map(c => `${qid(c)} = excluded.${qid(c)}`).join(', ') || qid(cols[0]) + ' = excluded.' + qid(cols[0])}`;
          if (wantRet) sql += ' returning *';
          const r = await run(sub, () => db.query(sql, ps)); if (wantRet) out.push(...r.rows);
        }
        return send(res, 201, wantRet ? out : undefined);
      }
      if (req.method === 'PATCH') {
        const cols = Object.keys(body); const sets = cols.map(c => `${qid(c)} = ${lit(body[c] !== null && typeof body[c] === 'object' ? JSON.stringify(body[c]) : body[c], params)}`);
        const r = await run(sub, () => db.query(`update ${t} set ${sets.join(', ')}${where(sp, params)} returning *`, params));
        return send(res, 200, wantRet ? r.rows : undefined);
      }
      if (req.method === 'DELETE') {
        const r = await run(sub, () => db.query(`delete from ${t}${where(sp, params)} returning *`, params));
        return send(res, 200, wantRet ? r.rows : undefined);
      }
      return send(res, 405, {});
    } catch (e) {
      const m = String(e.message || e);
      const code = e.code || (m.includes('duplicate key') ? '23505' : m.includes('row-level security') ? '42501' : 'P0001');
      return send(res, code === '42501' ? 403 : code === '23505' ? 409 : 400, { code, message: m, details: null, hint: null });
    }
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}

if (process.argv[1] && process.argv[1].endsWith('mocksb.mjs')) {
  const db = await makeDb({ importFiles: process.argv.slice(2) });
  await serve(db); console.log('Mock-Supabase läuft auf http://localhost:54321');
}
