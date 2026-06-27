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
      includeAssets: [
        'favicon-32.png',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ],
      manifest: {
        name: 'Lumini Writing — Schreiben & Worldbuilding',
        short_name: 'Lumini',
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
        // The heavy PDF library + fonts (pdfmake / vfs_fonts) and the 3D map
        // builder (three.js / react-three-fiber, in the MapBuilder chunk) are
        // loaded on demand — only when the user triggers a PDF export or opens
        // the map. Keep them OUT of the startup precache, then cache-on-first-
        // use so offline still works after one online use. NewFavIcon.png is the
        // 2048px icon source (consumed into the icons below) — never precache it.
        globIgnores: [
          '**/pdfmake.min-*.js',
          '**/vfs_fonts-*.js',
          '**/MapBuilder-*.js',
          '**/NewFavIcon.png',
        ],
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
          {
            urlPattern: /\/assets\/MapBuilder-[^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-3d',
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
