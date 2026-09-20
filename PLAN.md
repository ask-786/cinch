# Cinch — Build Plan

**Media tools that never leave your device.**

A browser-only media utility that puts FFmpeg's common operations behind a plain-language
interface. Drop a file, pick what you want to happen, get the result. No server, no upload,
no account, no database. Deployable as static files.

Planned 2026-09-20. Every technical claim in "Verified facts" below was measured by executing
the actual WASM binary, not recalled from memory.

---

## 1. Non-negotiable constraints

- All processing happens in the browser via FFmpeg compiled to WebAssembly.
- No backend, no server-side processing, no database, no accounts.
- The user's media never leaves the device. This is the product, not a feature.
- FFmpeg runs in a Web Worker. The UI thread never blocks.
- The build output is static files.
- FFmpeg terminology stays hidden unless the user opens Advanced.

---

## 2. Stack

| Piece | Choice | Note |
|---|---|---|
| Framework | Angular 22 (zoneless, standalone, signals) | Zoneless is the v22 scaffold default |
| Styling | Tailwind CSS 4 | `ng new --style=tailwind` wires postcss automatically |
| Components | Hand-built on Tailwind | No Spartan, no Material — see D20 |
| Tests | Vitest (v22 default) | Argument builders only |
| FFmpeg | `@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/core` **and** `@ffmpeg/core-mt` 0.12.10 | Both cores shipped, chosen per job |
| Hosting | Portable `dist/`, host-agnostic | Header configs for Netlify/Vercel/nginx + service-worker fallback |

**Framework note:** the brief mandates Angular. Confirmed decision is to build on Angular and
raise it at the Stage 4 checkpoint if it causes real friction, rather than switching blind.

---

## 3. Verified facts about the FFmpeg core

Measured by running `ffmpeg-core.wasm` under Node and reading the shipped schemas. These drive
several decisions below and are worth keeping.

**Build:** FFmpeg 5.1.4, emcc 3.1.40, `--enable-gpl`, SIMD128 on, no asm.
Licensed **GPL-2.0-or-later** — the deployed site distributes GPL binaries and must carry the notice.

**Compiled in:** libx264, libx265, libvpx (VP8 + VP9), libtheora, libwebp, libmp3lame, libopus,
libvorbis, native AAC, flac, alac, pcm, ac3 · libass, libfribidi, libfreetype, libzimg ·
all of scale, crop, fps, palettegen, paletteuse, volume, afade, atempo, concat, zscale,
subtitles, ass, drawtext, overlay, loudnorm, thumbnail, reverse, amix.

**Not available:** AV1 **encode** (decode only, and slow — no dav1d) · libfdk_aac · libvmaf · fontconfig.

**Memory — the counterintuitive one:**

| Core | Heap | Growth | Needs isolation |
|---|---|---|---|
| Single-thread | 32 MB → **2048 MB** | yes | no |
| Multi-thread | **1024 MB fixed** | **no** (shared memory can't grow) | yes (COOP/COEP) |

MT is roughly 3–5× faster but has **half** the headroom. Big jobs are safer single-threaded.

**Filesystem:** MEMFS and **WORKERFS** only. No IDBFS, no NODEFS. WORKERFS accepts a `File`
directly and reads it in chunks via `FileReaderSync`, so input never enters JS memory — but it is
**read-only**, so output must land in MEMFS. **Output size is the real memory constraint, not input size.**

**Cancellation is not supported.** The `AbortSignal` only rejects the JS promise; the WASM keeps
running, and the worker's `exec` is synchronous so it cannot receive a message mid-run.
`terminate()` is the only kill switch, and it wipes the filesystem.

**Progress is unreliable.** The event carries only `{progress, time}`, where `progress` is
`out_time ÷ input#0 duration`. Measured failures: caps at 0.248 then snaps to 1 on a trim,
overshoots to 1.998 on a two-input concat, goes negative on lavfi sources, and emits
`461168601842.7` when `AV_NOPTS_VALUE` leaks through. Must be sanitized and recomputed.

**Gotcha:** `@ffmpeg/ffmpeg` 0.12.15 still defaults `CORE_URL` to unpkg `@ffmpeg/core@0.12.9`.
Always pass explicit `coreURL`/`wasmURL`. Core files must be **unhashed assets** with stable URLs,
since those are runtime strings the bundler cannot rewrite.

**Measured during Stage 3–4 (Chrome, 8 logical cores), not part of the original survey:**

- **The MT core needs an explicit `-threads`.** Left to itself, libx264 picks a thread count
  that **hangs the core forever** — only `terminate()` recovers. `-threads 8` hangs, `-threads 6`
  throws inside the core, `-threads 4` works and is **2.6× faster** than single-threaded
  (6.0 s vs 15.7 s for a 6 s 720p clip). Cinch caps MT at 4 threads.
- **A failed MT exec poisons the instance.** Every later call throws
  `TypeError: Cannot read properties of undefined (reading 'startsWith')` — the core's own
  `catch (e) { if (!e.message.startsWith("Aborted")) ... }` on an error with no `message`.
  So a thrown exec terminates the instance, and the job retries once on the single-threaded core.
- **MT is fine for stream copy and audio encoding** (`-c copy` 127 ms, AAC 341 ms) — the
  thread trouble is specific to encoders that spawn their own threads.
- **`time` in progress events is microseconds** (`6_013_968` for a 6.01 s output), and
  `progress` overshoots to `1.0023` at the end of a plain transcode.

**Angular specifics:** `ng serve` supports a `headers` option in `angular.json` (not a CLI flag),
so cross-origin isolation works in dev with no proxy. Worker bundling is automatic for the literal
form `new Worker(new URL('./x.worker.ts', import.meta.url))` — a computed URL is silently left
untransformed with no warning. `webWorkerTsConfig` is vestigial; no `tsconfig.worker.json` needed.

---

## 4. Architecture

```
  UI (Angular components, signals)
        │
  Operation registry  ──  descriptor + options schema per operation
        │
  Argument builder    ──  pure function, options → string[]   ← unit tested
        │
  Worker API layer    ──  typed messages, progress, lifecycle
        │
  ffmpeg.worker.ts    ──  core selection, WORKERFS mount, exec
        │
  FFmpeg WASM
        │
  Output  →  streamed to disk (File System Access) or Blob download
```

```
src/
  app/
    core/            worker client, ffmpeg lifecycle, capability detection, errors
    features/        home, video, audio, image, subtitle, processing
    components/      drop zone, media info, quality slider, progress, disclosure
  media/
    models/          MediaFile, MediaInfo, Operation, JobResult
    operations/      one descriptor + argument builder per operation
    ffmpeg/          arg helpers, codec tables, probe parsing
    file-system/     WORKERFS mount, save-to-disk, size preflight
  workers/            (reserved — see the note below)
```

**Where the worker actually is:** `@ffmpeg/ffmpeg`'s `FFmpeg` class spawns its own module
worker and runs every `exec`, `ffprobe` and WORKERFS mount inside it, so the UI thread only
posts messages. Cinch wraps that class in `app/core/ffmpeg-client.ts` rather than nesting it
inside a second worker of our own: a nested worker would buy nothing here and costs portability.
The client is the only file that knows this, so moving it later is a one-file change.

Rules: no FFmpeg strings inside components. Argument builders are pure and testable. Adding an
operation means adding one descriptor file.

---

## 5. Decisions

Resolved during design review. `D` numbers are referenced from the build stages.

| # | Decision | Chosen |
|---|---|---|
| D1 | Threading | Ship both cores, feature-detect `crossOriginIsolated` |
| D2 | Hosting | Portable static build + header configs + service-worker fallback |
| D3 | WASM delivery | Self-host. Required for COEP anyway, and the privacy claim must be literally true |
| D4 | Large files | WORKERFS zero-copy mount for input; in-memory fallback; size preflight |
| D5 | Probing | Native metadata instantly, FFmpeg probe in background on intent |
| D6 | Scope | All video/audio/image operations, plus subtitles (D13) |
| D7 | Multi-file | Multi-input operations yes; sequential queue; **no batch** in v1 |
| D8 | Routing | Routed per operation for lazy chunks and shareable links; guard redirects on refresh |
| D9 | Design | Tailwind 4, quiet native-utility feel, dark mode with manual override |
| D10 | Testing | Unit tests on argument builders and option mapping. No e2e |
| D11 | Framework | Angular (brief mandates it); revisit at Stage 4 checkpoint if it fights |
| D12 | Core routing | **Per job**: MT when estimated output < 250 MB and source ≤ 1080p, else ST |
| D13 | Subtitles | In scope — extract, convert, and burn-in. Ship a `.ttf` since there is no fontconfig |
| D14 | Cancel | `terminate()` + reload, WASM cached, replacement instance pre-warmed |
| D14b | Progress | Compute our own from `time` ÷ known output duration; sanitize every event; `-stats_period 0.1` |
| D15 | Output | `showSaveFilePicker` streaming where supported, Blob download fallback. No OPFS persistence |
| D16 | Compression | Two modes: quality slider **and** target size. Presets: Email 25 MB, Discord 10 MB, Small/Balanced/High |
| D17 | Errors | Pattern table over common failures + cheap preflight on known-bad combinations + explicit OOM path |
| D18 | Mobile | Responsive, with a stated file-size cap rather than a crashed tab |
| D19 | Name | **Cinch.** GPL/FFmpeg attribution in an About/Licenses footer |
| D20 | Components | Hand-built. Spartan is mature enough but the components that matter here aren't in any library |
| D21 | Advanced mode | Read-only generated command + copy button emitting a real desktop `ffmpeg` line |
| D22 | Compatibility | Offer H.265 with a plain warning; never default to it. Default MP4/H.264/AAC plays everywhere |
| D23 | Operation model | Declarative descriptors with generated forms; custom component escape hatch for trim, crop, GIF |
| D24 | Multi-file UX | Dropping several files reveals combine operations; reorder by drag |
| D25 | Delivery | Staged with a runnable checkpoint after compression works end to end |

### Settled parameters

- **Quality slider → CRF**, per encoder: x264 `34→16` (default 60 ≈ CRF 23), VP9 `40→22`, x265 `39→21`.
- **Encoder speed**: x264 `veryfast` default; "take longer for better quality" switches to `medium`.
- **Audio**: AAC 128k Good / 192k High / 96k Small. Opus for WebM.
- **Formats**: video MP4, WebM, MKV, MOV · audio MP3, M4A, Opus, WAV, FLAC, OGG · image PNG, JPG, WebP.
- **Probe**: `ffprobe -print_format json` written to a file and read back. No stderr scraping.
- **Prewarm**: fetch the 32 MB core into Cache API on idle; instantiate only on intent.
- **Preflight**: warn above 500 MB desktop input; hard cap mobile at 150 MB.

---

## 6. Build stages

### Stage 1 — Foundation
- [x] `ng new` Angular 22, zoneless, standalone, Tailwind 4, Vitest
- [x] COOP/COEP headers in `angular.json` dev server
- [x] Design tokens, dark mode, base layout
- [x] Hand-built primitives: button, select, slider, dialog, progress, disclosure
- [x] Routing shell with lazy feature chunks
- [x] Landing page with privacy message
- [x] `.gitignore`, README

### Stage 2 — File handling
- [x] Drop zone with drag state, plus file picker fallback
- [x] Multi-file drop detection (D24)
- [x] Type validation and friendly rejection
- [x] Size preflight and mobile cap (D18)
- [x] Instant native metadata via `HTMLVideoElement` / `AudioContext` (D5)
- [x] File info panel with a Details disclosure

### Stage 3 — FFmpeg in a worker
- [x] Self-host both cores as unhashed assets (D3)
- [x] Typed worker client (`core/ffmpeg-client.ts`, see the architecture note)
- [x] Worker client service: load, exec, progress, terminate
- [x] Capability detection and per-job core routing (D1, D12)
- [x] WORKERFS mount for input (D4)
- [x] Cache API prewarm on idle
- [x] `ffprobe` JSON probing, merged into the info panel
- [x] Progress sanitizer and duration-based recomputation (D14b)

### Stage 4 — Compression end to end **← checkpoint, runnable**
- [x] `VideoCompressionOptions` model and argument builder
- [x] Unit tests for the builder
- [x] Quality mode: slider → per-encoder CRF
- [x] Target-size mode: bitrate math with presets
- [x] Live size estimation
- [x] Processing screen: progress, elapsed, ETA, cancel, logs
- [x] Results screen: original vs output, percent saved, download
- [x] Save via `showSaveFilePicker` with Blob fallback (D15) — written, not yet exercised end to end
- [x] Advanced disclosure showing the generated command (D21)
- [ ] **Stop here. Run it. React to the feel before generalizing.**

### Stage 5 — Generalize
- [ ] Operation descriptor interface and registry
- [ ] Generated option forms from schema
- [ ] Custom-component escape hatch (D23)
- [ ] Job queue, one active job
- [ ] Error taxonomy with pattern table and OOM path (D17)
- [ ] Refactor compression onto the registry to prove the abstraction

### Stage 6 — Operations

**Video**
- [ ] Compress (Stage 4) · [ ] Convert format · [ ] Resize · [ ] Crop · [ ] Trim
- [ ] Change FPS · [ ] Change quality · [ ] Change bitrate

**Extract**
- [ ] Extract audio · [ ] Extract frames · [ ] Create GIF · [ ] Generate thumbnails

**Audio**
- [ ] Convert format · [ ] Trim · [ ] Change bitrate · [ ] Change sample rate
- [ ] Change volume · [ ] Fade in/out · [ ] Merge audio

**Images**
- [ ] Images → video · [ ] Video → images · [ ] GIF conversion

**Subtitles**
- [ ] Extract · [ ] Convert format · [ ] Burn in (ships a `.ttf`)

### Stage 7 — Polish
- [ ] Empty, loading, and error states throughout
- [ ] Responsive pass down to phone width
- [ ] Chain output into another operation
- [ ] Operation settings serialized into the URL
- [ ] Temp file cleanup and object URL release
- [ ] About / Licenses footer with GPL and FFmpeg attribution (D19)
- [ ] Host header configs and service-worker isolation fallback (D2)
- [ ] Production build and static deploy verification

---

## 7. Known risks

| Risk | Mitigation |
|---|---|
| OOM on large outputs — 1–2 GB ceiling | Preflight estimate, ST routing for big jobs, explicit OOM error path |
| Cancel costs a worker teardown | WASM cached, replacement pre-warmed, honest UI wording |
| Progress events are unreliable | Sanitize and recompute against a probed duration |
| 32 MB core download on first use | Idle prefetch into Cache API, brotli, clear loading state |
| H.265 output may not play | Plain warning, never the default (D22) |
| GPL obligations | Licenses footer, link to source |
| Angular friction | Reassess at the Stage 4 checkpoint (D11) |
