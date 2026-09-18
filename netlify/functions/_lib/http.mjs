/* ============================================================
   One handler shape for three runtimes.

   Every function here is written against the Web platform: it takes a
   `Request` and returns a `Response`. Netlify invokes functions exactly that
   way, and so do the integration tests and scripts/dev-stack.mjs.

   Vercel's Node runtime does not: it calls `(req, res)` with Node's
   IncomingMessage/ServerResponse. Deployed unwrapped, every endpoint died on
   its first line with "req.headers.get is not a function" or "Invalid URL"
   (the Node request carries a path, not an absolute URL).

   `webHandler` bridges the two. The wrapper takes two parameters on purpose —
   that is what tells Vercel's builder this is a Node-style function — and
   detects at call time which world it is in: a real ServerResponse means
   Node, anything else (Netlify's context, or nothing at all) means the
   request was already a Request.
   ============================================================ */

const isNodeResponse = (res) => Boolean(res) && typeof res.setHeader === 'function';

function nodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
  });
}

/** Node's headers are a plain object, and repeated ones arrive as arrays. */
function toHeaders(raw) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, String(v));
  }
  return headers;
}

/**
 * @param {(req: Request) => Promise<Response>} handler
 * @returns {(req: any, res?: any) => Promise<Response>}
 */
export function webHandler(handler) {
  return async function handle(req, res) {
    if (!isNodeResponse(res)) return handler(req);

    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const method = req.method ?? 'GET';
    const request = new Request(`${proto}://${host}${req.url}`, {
      method,
      headers: toHeaders(req.headers),
      body: method === 'GET' || method === 'HEAD' ? undefined : await nodeBody(req),
    });

    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
    // Returned for callers that want it; Vercel ignores a Node handler's return.
    return response;
  };
}
