#!/usr/bin/env node
/**
 * serve.mjs — dependency-free static file server for local development.
 *
 * Opening the app from the file:// scheme works for playing with it, but some
 * browser features behave differently without an HTTP origin. This server
 * exists so contributors have a real origin without adding a dependency to
 * `npx serve` or similar.
 *
 * Usage: node tools/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const APP_FILE = 'Form-909 Warp IDM Drum Machine.html';
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.map': 'application/json; charset=utf-8',
};

/** Reject any path that escapes ROOT after normalisation. */
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = resolve(join(ROOT, normalize(decoded)));
  return candidate.startsWith(ROOT) ? candidate : null;
}

const server = createServer(async (req, res) => {
  try {
    // There is no index.html — the application is a file with spaces in its
    // name — so `/` resolves to it directly rather than 404ing.
    const ROOT_ROUTE = `/${APP_FILE}`;
    const requested = req.url === '/' ? ROOT_ROUTE : req.url;
    let filePath = safePath(requested);

    // GitHub Pages-style convenience: / → the app itself.
    if (filePath === null) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    // No catch-all fallback: an unknown path is a 404, not the application.
    // Serving the app for arbitrary routes made traversal attempts look
    // successful (200 with the app body) instead of correctly failing.
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found');
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      // The app is self-contained; caching aggressively only confuses local edits.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(`500 ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Form 909-WARP → http://localhost:${PORT}/`);
  console.log(`  Serving ${ROOT}\n`);
});
