import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 1. Resolve active root directory (e.g. deploy/current/) and parent directory (deploy/)
  const rootDir = process.cwd();
  const parentDir = path.resolve(rootDir, '..');

  // 2. Frontend prefixes designated for client exposure
  const frontendPrefixes = ['VITE_', 'GEMINI_', 'GOOGLE_'];

  // 3. Explicitly read environment variables from parent directory (../) in addition to root directory (./)
  const parentClientEnv = loadEnv(mode, parentDir, frontendPrefixes);
  const rootClientEnv = loadEnv(mode, rootDir, frontendPrefixes);

  // Merge environments: parent deploy/.env provides base configuration, root can override/supplement
  const mergedClientEnv = { ...parentClientEnv, ...rootClientEnv };

  // Also load all environment variables (including server secrets) from both locations into process.env
  const parentAllEnv = loadEnv(mode, parentDir, '');
  const rootAllEnv = loadEnv(mode, rootDir, '');
  const mergedAllEnv = { ...parentAllEnv, ...rootAllEnv };

  // Populate process.env for Node plugins, server middleware, and background workers
  for (const [key, val] of Object.entries(mergedAllEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }

  // Ensure variables meant for the frontend prefixed with VITE_ are properly exposed to import.meta.env
  const defineClientEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(mergedClientEnv)) {
    defineClientEnv[`import.meta.env.${key}`] = JSON.stringify(val);
  }

  return {
    envPrefix: frontendPrefixes,
    define: defineClientEnv,
    plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Canada Recall Alert',
        short_name: 'RecallAlert',
        description: 'Canadian Product & Food Safety Recall Alerts, Barcode Scanner & Multimodal AI Verification',
        theme_color: '#dc2626',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        importScripts: ['/sw-push.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/recalls-rappels\.canada\.ca\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'canada-recalls-feed-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 86400 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    }),
    {
      name: 'recall-pipeline-plugin',
      async configureServer(server) {
        const { handlePipelineApiRequest } = await import('./src/server/api.ts');
        const { startSyncWorker } = await import('./src/server/worker.ts');

        server.middlewares.use((req, res, next) => {
          handlePipelineApiRequest(req, res, next);
        });

        // Initialize 6-hour background worker
        try {
          startSyncWorker({ runOnStartupIfDue: false });
        } catch (err) {
          console.warn('[Vite] Could not start sync worker in dev server:', err);
        }
      }
    }
  ],
  server: {
    proxy: {
      '/api/recalls': {
        target: 'https://recalls-rappels.canada.ca',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api\/recalls/, '/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json')
      }
    }
  }
};
});

