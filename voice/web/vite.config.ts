import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite`'s CLI defaults `root` to the current working directory, not the
// directory of this config file — and `mock:web`/`build:web` are invoked
// from the repo root via `--config voice/web/vite.config.ts`. Pin `root`
// explicitly so `index.html` and `src/` resolve relative to this directory
// regardless of where the command is run from.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  // Tailwind is here only because Brutalkit peer-depends on it: its
  // stylesheet expects `@import "tailwindcss"` to have run first. The design
  // itself is plain CSS over Brutalkit's tokens, per the handoff.
  plugins: [react(), tailwindcss()],
  build: {
    // Outside `voice/web` on purpose: this is the build *output*, served by
    // `voice/http-server.ts`, not part of the source tree it's built from.
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Dev-server HMR still needs the real API/session/SSE server, which
      // this does not replace — run `pnpm dev:web:api` alongside `pnpm
      // dev:web` and requests to /api/* are forwarded to it.
      '/api': {
        target: 'http://127.0.0.1:4173',
        changeOrigin: false,
      },
    },
  },
})
