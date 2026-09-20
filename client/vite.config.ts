import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest (a service worker we write ourselves, precaching wired
      // in via self.__WB_MANIFEST) instead of generateSW, so it can also
      // handle push/notificationclick for web push notifications — generateSW
      // only ever produces a precaching worker with no room for custom event
      // listeners.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Training Dashboard',
        short_name: 'Training',
        description: 'Track workouts, progress, and training goals',
        theme_color: '#f9f9f7',
        background_color: '#f9f9f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
