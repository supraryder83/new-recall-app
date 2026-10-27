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
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, 'dist');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const RECALLS_CACHE_FILE = path.join(DATA_DIR, 'recalls-cache.json');
const INITIAL_BUNDLED_FILE = path.resolve(process.cwd(), 'public/data/initial-recalls.json');

// In-memory cache for the 16MB Health Canada Open Data feed
let cachedRecallsBuffer: Buffer | null = null;
let lastCacheFetchTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getLocalFallbackRecalls(): Buffer | null {
  try {
    if (fs.existsSync(RECALLS_CACHE_FILE)) {
      return fs.readFileSync(RECALLS_CACHE_FILE);
    }
    if (fs.existsSync(INITIAL_BUNDLED_FILE)) {
      return fs.readFileSync(INITIAL_BUNDLED_FILE);
    }
    const distBundled = path.join(DIST_DIR, 'data/initial-recalls.json');
    if (fs.existsSync(distBundled)) {
      return fs.readFileSync(distBundled);
    }
  } catch (err) {
    console.warn('[Server] Error reading local fallback recalls:', err);
  }
  return null;
}

// Background refresh of Health Canada feed
async function refreshRecallsFeed(): Promise<Buffer | null> {
  const targetUrl = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'CanadaRecallAlert-Backend/1.0'
      }
    });
    clearTimeout(timeout);

    if (upstream.ok) {
      const arrayBuf = await upstream.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length > 1000) {
        cachedRecallsBuffer = buf;
        lastCacheFetchTime = Date.now();
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFile(RECALLS_CACHE_FILE, buf, (err) => {
          if (err) console.warn('[Server] Could not persist recalls cache:', err.message);
        });
        console.log(`[Server] Cached Health Canada recalls feed (${(buf.length / 1024 / 1024).toFixed(1)} MB).`);
        return buf;
      }
    }
  } catch (err: any) {
    console.warn('[Server] Background refresh of recalls feed failed:', err.message);
  }
  return null;
}

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

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // 1. API routes (/api/*)
  if (url.startsWith('/api/')) {
    // Health Canada live open data proxy with instant caching
    if (url.startsWith('/api/recalls')) {
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        });
        return res.end();
      }

      // Check cache validity
      const isCacheFresh = cachedRecallsBuffer && (Date.now() - lastCacheFetchTime < CACHE_TTL_MS);

      if (isCacheFresh && cachedRecallsBuffer) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=1800'
        });
        return res.end(cachedRecallsBuffer);
      }

      // If buffer empty, check local disk file immediately for instant response
      if (!cachedRecallsBuffer) {
        cachedRecallsBuffer = getLocalFallbackRecalls();
      }

      if (cachedRecallsBuffer) {
        // Trigger background refresh if stale
        if (Date.now() - lastCacheFetchTime >= CACHE_TTL_MS) {
          refreshRecallsFeed();
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=1800'
        });
        return res.end(cachedRecallsBuffer);
      }

      // If no local cache exists, fetch directly
      try {
        const freshBuf = await refreshRecallsFeed();
        if (freshBuf) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=1800'
          });
          return res.end(freshBuf);
        }
      } catch (err: any) {
        // Continue to error below
      }

      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({ error: 'Proxy fetch failed', message: 'Unable to load recall data feed' }));
    }

    return handlePipelineApiRequest(req, res, () => {
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
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

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] Error: Port ${PORT} is already in use by another process.`);
  } else if (err.code === 'EACCES') {
    console.error(`[Server] Error: Permission denied on ${HOST}:${PORT}.`);
  } else {
    console.error('[Server] Server error:', err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Canada Recall Alert production server running on http://${HOST}:${PORT}`);
  console.log(`[Server] Environment loaded from: ${fs.existsSync(path.resolve(__dirname, '../.env')) ? path.resolve(__dirname, '../.env') : 'current directory'}`);

  // Prime recalls cache in background on startup
  refreshRecallsFeed();

  // Initialize background 6-hour sync worker
  try {
    startSyncWorker({ runOnStartupIfDue: false });
  } catch (err) {
    console.warn('[Server] Could not start sync worker:', err);
  }
});
