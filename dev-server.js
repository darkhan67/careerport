// Local development server with zero dependencies.
// Serves /public like Vercel (clean URLs) and runs the /api functions.
// Usage: node dev-server.js   (reads keys from .env if present)
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[2] && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnv(path.join(root, '.env'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Adds the Express-style helpers that Vercel provides on `res`.
function withHelpers(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function serveStatic(pathname, res) {
  const clean = path.normalize(decodeURIComponent(pathname));
  const candidates = [clean, `${clean}.html`, path.join(clean, 'index.html')];
  for (const candidate of candidates) {
    const file = path.join(publicDir, candidate);
    if (!file.startsWith(publicDir)) continue;
    try {
      if ((await stat(file)).isFile()) {
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        return res.end(await readFile(file));
      }
    } catch {
      // try the next candidate
    }
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', TYPES['.html']);
  res.end(await readFile(path.join(publicDir, '404.html')).catch(() => 'Not found'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice('/api/'.length).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(root, 'api', `${name}.js`);
      if (!name || !existsSync(file)) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const { default: handler } = await import(pathToFileURL(file).href);
      req.body = await readBody(req);
      return await handler(req, withHelpers(res));
    }
    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Server error');
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`CareerPort is running at http://localhost:${port}`));
