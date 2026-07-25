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
      // We register the worker ourselves (src/pwa/updates.js) so the app can
      // detect a new deploy and OFFER a reload instead of breaking silently.
      injectRegister: null,
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
        // A new deploy renames every hashed asset. If the shell (index.html)
        // were served from the precache, an old shell would ask for asset
        // filenames that no longer exist → "Failed to fetch dynamically
        // imported module". So the shell must never come from the cache while
        // the network is reachable. That needs BOTH of these:
        //   • no navigateFallback — it binds navigations to the precached shell;
        //   • directoryIndex/cleanUrls off — otherwise Workbox's precache route
        //     answers "/" with the precached "index.html" BEFORE any runtime
        //     route runs (this was the actual cause of the stale shell).
        // Navigations then hit the NetworkFirst route below, which falls back
        // to the precached shell only when the network is genuinely gone.
        navigateFallback: null,
        directoryIndex: null,
        // Drop precaches from previous deploys instead of letting them pile up.
        cleanupOutdatedCaches: true,
        // Activate the new worker immediately and take over open tabs; the app
        // then shows a "neue Version verfügbar" prompt rather than reloading
        // under the author's fingers.
        skipWaiting: true,
        clientsClaim: true,
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
            // The app shell: always ask the network first so a fresh deploy's
            // index.html (with its new asset hashes) wins. Offline — or when
            // the network stalls — fall back to the last good copy, and to the
            // precached shell if this browser has never loaded one.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
              precacheFallback: { fallbackURL: '/index.html' },
            },
          },
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
