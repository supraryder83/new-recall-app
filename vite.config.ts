import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  envPrefix: ['VITE_', 'GEMINI_', 'GOOGLE_'],
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
})
