import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Installable PWA with an offline-capable app shell.
// The service worker (Workbox, generated) precaches the built assets so the
// shell loads with no network; all writing data lives in IndexedDB.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'SmartWriting — Schreiben & Worldbuilding',
        short_name: 'SmartWriting',
        description:
          'Multi-project writing & worldbuilding PWA. Write chapters, track characters and places — local-first.',
        theme_color: '#4f46e5',
        background_color: '#0f1117',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // The heavy PDF library + fonts (pdfmake / vfs_fonts) are loaded on
        // demand — only when the user triggers a PDF export. Keep them OUT of
        // the startup precache, then cache-on-first-use so offline PDF still
        // works after one online export.
        globIgnores: ['**/pdfmake.min-*.js', '**/vfs_fonts-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(pdfmake\.min|vfs_fonts)-[^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-lib',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
