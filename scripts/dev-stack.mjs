#!/usr/bin/env node
/* Local full stack for the ops dashboard and the tenant pages (ADR 0018).
 *
 *   npm run dev:stack            -> http://127.0.0.1:8790
 *
 * `npm run dev` (server.py + dev_api.py) is the fast path for game work, but it
 * is a Python stand-in for the backend. The ops dashboard needs the REAL one:
 * the ops_* functions, the reviewed-preset rule, RLS and the JWT role switch.
 * So this boots what the integration tests boot — a real Postgres with every
 * migration and the real PostgREST binary — and serves the real `api/*.mjs`
 * handlers in front of it, plus the static game with the /play/<slug>/ rewrite
 * vercel.json performs.
 *
 * Supabase Storage is the one piece with no local binary. A small in-memory
 * stand-in answers the two calls api/ops-assets.mjs and the browser make (sign
 * an upload URL, PUT the bytes) and serves the public URL. Nothing is persisted:
 * stopping the process discards the database and every upload.
 *
 * Point the ops dashboard at it with:
 *   GAME_API_URL=http://127.0.0.1:8790  OPS_ADMIN_KEY=dev-ops-key
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startStack, JWT_SECRET, playWinningRound, LEGACY_TENANT } from '../tests/integration/support/stack.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8790);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OPS_ADMIN_KEY = process.env.OPS_ADMIN_KEY || 'dev-ops-key';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};
const TENANT_PATH = /^\/play\/([a-z0-9][a-z0-9-]{1,39})(\/.*)?$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

console.log('starting Postgres + PostgREST (first run downloads PostgREST)…');
const stack = await startStack({ postgrest: true });

Object.assign(process.env, {
  SUPABASE_REST_URL: stack.restUrl,
  SUPABASE_URL: ORIGIN,
  SUPABASE_JWT_SECRET: JWT_SECRET,
  SUPABASE_SERVICE_KEY: 'dev-service-key',
  OPS_ADMIN_KEY,
  ADMIN_KEY: process.env.ADMIN_KEY || 'dev-admin-key',
});

/* A little McDonald's history, so the cross-tenant overview has something to
   show. Real rounds through the real functions, not inserted rows. */
for (let i = 0; i < 6; i++) {
  await playWinningRound(stack.admin, LEGACY_TENANT, {
    phone: `10077700${String(i).padStart(2, '0')}`,
    device: `dev-device-${i}`,
    score: 1200 + i * 150,
  }).catch((e) => console.warn('seed round skipped:', e.message));
}

/** @type {Map<string, {type: string, body: Buffer}>} */
const storage = new Map();

const handlers = new Map();
async function apiHandler(name) {
  if (!handlers.has(name)) {
    const file = join(ROOT, 'api', `${name}.mjs`);
    await stat(file);
    handlers.set(name, (await import(pathToFileURL(file).href)).default);
  }
  return handlers.get(name);
}

const readRaw = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

async function send(res, response) {
  const headers = Object.fromEntries(response.headers);
  res.writeHead(response.status, { ...CORS, ...headers });
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(res, path) {
  let rel = decodeURIComponent(path);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', ORIGIN);
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

    const api = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
    if (api) {
      // The same rewrite vercel.json performs: five admin paths, one function.
      const admin = /^admin-([a-z]+)$/.exec(api[1]);
      if (admin) {
        url.searchParams.set('section', admin[1]);
        api[1] = 'admin';
      }
      let handler;
      try {
        handler = await apiHandler(api[1]);
      } catch {
        return res.writeHead(404).end();
      }
      const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : await readRaw(req);
      const request = new Request(url, {
        method: req.method,
        headers: /** @type {Record<string, string>} */ (req.headers),
        body,
      });
      return send(res, await handler(request));
    }

    // ---- Storage stand-in -------------------------------------------------
    const sign = /^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (sign && req.method === 'POST') {
      const token = randomUUID();
      storage.set(`pending:${sign[1]}/${sign[2]}`, { type: token, body: Buffer.alloc(0) });
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ url: `/object/upload/sign/${sign[1]}/${sign[2]}?token=${token}` }));
    }
    if (sign && req.method === 'PUT') {
      const pending = storage.get(`pending:${sign[1]}/${sign[2]}`);
      if (!pending || pending.type !== url.searchParams.get('token')) {
        return res.writeHead(403, CORS).end();
      }
      storage.delete(`pending:${sign[1]}/${sign[2]}`);
      storage.set(`${sign[1]}/${sign[2]}`, {
        type: String(req.headers['content-type'] ?? 'application/octet-stream'),
        body: await readRaw(req),
      });
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Key: `${sign[1]}/${sign[2]}` }));
    }
    const pub = /^\/storage\/v1\/object\/public\/(.+)$/.exec(url.pathname);
    if (pub) {
      const obj = storage.get(pub[1]);
      if (!obj) return res.writeHead(404, CORS).end();
      res.writeHead(200, { ...CORS, 'Content-Type': obj.type });
      return res.end(obj.body);
    }

    // ---- The game, with the vercel.json tenant rewrite ---------------------
    const tenant = TENANT_PATH.exec(url.pathname);
    if (tenant) {
      if (tenant[2] === undefined) {
        return res.writeHead(307, { Location: `/play/${tenant[1]}/${url.search}` }).end();
      }
      return serveStatic(res, tenant[2]);
    }
    return serveStatic(res, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nClaimLabs dev stack on ${ORIGIN}`);
  console.log(`  game (McDonald's)   ${ORIGIN}/`);
  console.log(`  tenant pages        ${ORIGIN}/play/<slug>/`);
  console.log(`  ops dashboard env   GAME_API_URL=${ORIGIN} OPS_ADMIN_KEY=${OPS_ADMIN_KEY}\n`);
});

const shutdown = async () => {
  server.close();
  await stack.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
