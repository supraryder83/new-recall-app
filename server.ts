import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------------
// Release/symlink deployment environment configuration:
// When running in deploy/current/, __dirname is deploy/current/,
// so path.resolve(__dirname, '../.env') points directly to deploy/.env.
// ---------------------------------------------------------------------------------
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { handlePipelineApiRequest } from './src/server/api.ts';
import { startSyncWorker } from './src/server/worker.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.resolve(__dirname, 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // 1. API routes (/api/*)
  if (url.startsWith('/api/')) {
    // Health Canada live open data proxy fallback
    if (url.startsWith('/api/recalls')) {
      const targetUrl = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';
      fetch(targetUrl, { headers: { Accept: 'application/json' } })
        .then((upstream) => upstream.arrayBuffer())
        .then((buf) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(Buffer.from(buf));
        })
        .catch((err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy fetch failed', details: err.message }));
        });
      return;
    }

    return handlePipelineApiRequest(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });
  }

  // 2. Static files from dist/ (SPA)
  const cleanPath = url.split('?')[0];
  let filePath = path.join(DIST_DIR, cleanPath === '/' ? 'index.html' : cleanPath);

  // If path doesn't exist or is a directory, serve index.html for SPA routing (e.g. /recalls/:id)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Canada Recall Alert</h1><p>Building or static files not found. Run <code>npm run build</code>.</p>');
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Canada Recall Alert production server running on http://localhost:${PORT}`);
  console.log(`[Server] Environment loaded from: ${fs.existsSync(path.resolve(__dirname, '../.env')) ? path.resolve(__dirname, '../.env') : 'current directory'}`);

  // Initialize background 6-hour sync worker
  try {
    startSyncWorker({ runOnStartupIfDue: false });
  } catch (err) {
    console.warn('[Server] Could not start sync worker:', err);
  }
});
