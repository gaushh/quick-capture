import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              /*
               * Keep Node packages external so Rolldown does not shim `require('fs')` inside an ESM
               * Electron main bundle (that crash on startup).
               */
              /*
               * `electron` must stay external — the npm package is the launcher, not the API.
               * Bundling it breaks named imports (`BrowserWindow`, etc.) in the main process.
               */
              external: ['electron', 'openai'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
