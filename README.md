# Cinch

**Media tools that never leave your device.**

Cinch is a browser-only front end for FFmpeg. Drop in a video, audio file or image, pick what
you want to happen, get the result back. The file is processed by FFmpeg compiled to
WebAssembly, running in a worker inside the tab — there is no server, no upload, no account.

See [PLAN.md](./PLAN.md) for the full design, the measured facts about the WASM build, and the
build stages.

## Requirements

- Node 24.15+ (`.nvmrc` pins 24.21.0 — `nvm use`)
- pnpm 12 (`corepack` picks it up from `packageManager` in `package.json`)

## Running it

```bash
pnpm install
pnpm start      # http://localhost:4200
```

The dev server sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (configured under `serve.options.headers` in
`angular.json`). Those headers turn on `crossOriginIsolated`, which is what lets the
multi-threaded FFmpeg core use `SharedArrayBuffer`. Without them the app still works, just on
the slower single-threaded core.

```bash
pnpm build      # static files in dist/cinch
pnpm test       # unit tests (Vitest)
```

## Layout

```
src/
  app/
    core/         theme, worker client, capability detection
    components/   hand-built UI primitives
    features/     routed pages, one lazy chunk each
  media/          models, operation descriptors, argument builders
  workers/        the FFmpeg worker
```

The rule that keeps this honest: **no FFmpeg strings inside components**. Operations are
described by data, arguments are produced by pure functions, and those functions are what the
tests cover.

## License

Cinch ships an FFmpeg build compiled with `--enable-gpl`, so the distributed application is
covered by the **GNU General Public License, version 2 or later**. The attribution and license
notice live on the About page.
