import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tsLibs } from './ts-libs-plugin'

// `vite`'s CLI defaults `root` to the current working directory, not the
// directory of this config file — and `mock:web`/`build:web` are invoked
// from the repo root via `--config voice/web/vite.config.ts`. Pin `root`
// explicitly so `index.html` and `src/` resolve relative to this directory
// regardless of where the command is run from.
const root = fileURLToPath(new URL('.', import.meta.url))

// The API server upgrades itself to HTTPS whenever `local/certs/` holds a
// mkcert pair (`readTlsMaterial` in voice/http-server.ts), so the proxy target's
// scheme is not a constant — it is whatever that same directory decides. This
// read mirrors that one.
//
// Hardcoding `http://` here meant every `/api` call through `pnpm dev:web`
// returned 502 for anyone who had followed AGENTS.md's HTTPS instructions —
// i.e. exactly the Safari and Arc users the certs exist for. The dev server
// looked up, the app looked broken, and nothing said why.
const certs = fileURLToPath(new URL('../../local/certs/', import.meta.url))
const apiIsHttps = existsSync(`${certs}cert.pem`) && existsSync(`${certs}key.pem`)

// ...but the inference is only right when the API is *this* machine's `pnpm
// dev:web:api`. Point the dev server at a deployed instance instead — a
// container from `deploy/compose.yaml`, say, which cannot see `local/certs`
// because `.dockerignore` excludes it and therefore serves plain HTTP — and
// the same `local/certs` that makes the inference true here makes it wrong
// there. The symptom is not a helpful one: every `/api` call fails with
// `EPROTO ... packet length too long` from the proxy, and the app renders
// "The prompt could not be loaded on screen", which reads as a server bug.
//
// So: inferred by default, overridden by being told. Same rule `VOICE_MODE`
// follows — the guess is a convenience, never the only way to say it.
//
//   VOICE_API_ORIGIN=http://127.0.0.1:4173 pnpm dev:web
const apiOrigin = process.env.VOICE_API_ORIGIN?.trim() || `${apiIsHttps ? 'https' : 'http'}://127.0.0.1:4173`

export default defineConfig({
  root,
  // Tailwind is here only because Brutalkit peer-depends on it: its
  // stylesheet expects `@import "tailwindcss"` to have run first. The design
  // itself is plain CSS over Brutalkit's tokens, per the handoff.
  // `tsLibs` serves `virtual:ts-libs` — the TypeScript standard library as
  // text, for the Practice editor's language service. It resolves out of the
  // installed `typescript` at build time; see `ts-libs-plugin.ts` for why not
  // a CDN and why not a vendored copy.
  plugins: [react(), tailwindcss(), tsLibs()],
  // Workers are bundled by a *separate* rolldown pass with its own plugin
  // list, so a plugin registered above is simply not present when the assist
  // Worker is compiled — `virtual:ts-libs` fails to resolve and the whole build
  // dies. The top-level registration is still needed for `pnpm dev:web`, which
  // serves the worker through the main pipeline.
  worker: { plugins: () => [tsLibs()] },
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
        target: apiOrigin,
        changeOrigin: false,
        // mkcert signs with a locally-installed CA that Node does not trust by
        // default, so verification would reject a certificate the browser
        // itself accepts. This is a proxy to loopback; there is nothing on the
        // wire to protect.
        secure: false,
        // SSE. Without this the interviewer's stream is buffered by the proxy
        // and arrives all at once at the end of a turn, or not at all.
        ws: true,
      },
    },
  },
})
