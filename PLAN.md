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

| Piece      | Choice                                                                      | Note                                                              |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Framework  | Angular 22 (zoneless, standalone, signals)                                  | Zoneless is the v22 scaffold default                              |
| Styling    | Tailwind CSS 4                                                              | `ng new --style=tailwind` wires postcss automatically             |
| Components | Hand-built on Tailwind                                                      | No Spartan, no Material — see D20                                 |
| Tests      | Vitest (v22 default)                                                        | Argument builders only                                            |
| FFmpeg     | `@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/core` **and** `@ffmpeg/core-mt` 0.12.10 | Both cores shipped, chosen per job                                |
| Hosting    | Portable `dist/`, host-agnostic                                             | Header configs for Netlify/Vercel/nginx + service-worker fallback |

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

**Not available:** AV1 **encode** (decode only, and slow — no dav1d) · libfdk_aac · libvmaf · fontconfig · **vidstab** (so no real stabilisation; only the weaker `deshake`).

**Full inventory, measured 2026-09-20** by running the shipped core with `-filters`, `-muxers`
and `-encoders`: **473 filters, 176 muxers, 194 encoders**. Everything the operations below need
is present, including `transpose`/`hflip`/`vflip`, `setpts`/`atempo`/`asetrate`, `reverse`/`areverse`,
`loudnorm`/`dynaudnorm`, `silenceremove`, `drawtext`/`overlay`, `yadif`/`bwdif`, `pad`, `hstack`/`vstack`/`xstack`,
`showwavespic`/`showspectrumpic`, `eq`/`curves`/`unsharp`/`gblur`, `chromakey`/`colorkey`, `minterpolate`,
the `segment` and `image2` muxers, `libwebp_anim` and `apng`, and the `srt`/`ass`/`webvtt`/`mov_text`
subtitle encoders. The only thing looked for and missing is `vidstab`.

**Memory — the counterintuitive one:**

| Core          | Heap                | Growth                            | Needs isolation |
| ------------- | ------------------- | --------------------------------- | --------------- |
| Single-thread | 32 MB → **2048 MB** | yes                               | no              |
| Multi-thread  | **1024 MB fixed**   | **no** (shared memory can't grow) | yes (COOP/COEP) |

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

| #    | Decision        | Chosen                                                                                                  |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------- |
| D1   | Threading       | Ship both cores, feature-detect `crossOriginIsolated`                                                   |
| D2   | Hosting         | Portable static build + header configs + service-worker fallback                                        |
| D3   | WASM delivery   | Self-host. Required for COEP anyway, and the privacy claim must be literally true                       |
| D4   | Large files     | WORKERFS zero-copy mount for input; in-memory fallback; size preflight                                  |
| D5   | Probing         | Native metadata instantly, FFmpeg probe in background on intent                                         |
| D6   | Scope           | All video/audio/image operations, plus subtitles (D13)                                                  |
| D7   | Multi-file      | Multi-input operations yes; sequential queue; **no batch** in v1                                        |
| D8   | Routing         | Routed per operation for lazy chunks and shareable links; unknown operation redirects (see D26)         |
| D9   | Design          | Tailwind 4, quiet native-utility feel, dark mode with manual override                                   |
| D10  | Testing         | Unit tests on argument builders and option mapping. No e2e                                              |
| D11  | Framework       | Angular (brief mandates it); revisit at Stage 4 checkpoint if it fights                                 |
| D12  | Core routing    | **Per job**: MT when estimated output < 250 MB and source ≤ 1080p, else ST                              |
| D13  | Subtitles       | In scope — extract, convert, and burn-in. Ship a `.ttf` since there is no fontconfig                    |
| D14  | Cancel          | `terminate()` + reload, WASM cached, replacement instance pre-warmed                                    |
| D14b | Progress        | Compute our own from `time` ÷ known output duration; sanitize every event; `-stats_period 0.1`          |
| D15  | Output          | `showSaveFilePicker` streaming where supported, Blob download fallback. No OPFS persistence             |
| D16  | Compression     | Two modes: quality slider **and** target size. Presets: Email 25 MB, Discord 10 MB, Small/Balanced/High |
| D17  | Errors          | Pattern table over common failures + cheap preflight on known-bad combinations + explicit OOM path      |
| D18  | Mobile          | Responsive, with a stated file-size cap rather than a crashed tab                                       |
| D19  | Name            | **Cinch.** GPL/FFmpeg attribution in an About/Licenses footer                                           |
| D20  | Components      | Hand-built. Spartan is mature enough but the components that matter here aren't in any library          |
| D21  | Advanced mode   | Read-only generated command + copy button emitting a real desktop `ffmpeg` line                         |
| D22  | Compatibility   | Offer H.265 with a plain warning; never default to it. Default MP4/H.264/AAC plays everywhere           |
| D23  | Operation model | Declarative descriptors with generated forms; custom component escape hatch for trim, crop, GIF         |
| D24  | Multi-file UX   | Combine jobs collect their files on their own screen, one at a time; reorder by drag                    |
| D25  | Delivery        | Staged with a runnable checkpoint after compression works end to end                                    |
| D26  | Way in          | **Operation-first.** The landing screen is the job list; the job screen asks for the files it needs     |

### Settled parameters

- **Quality slider → CRF**, per encoder: x264 `34→16` (default 60 ≈ CRF 23), VP8 `40→10` with a
  0.07 bits-a-pixel `-b:v` ceiling, x265 `39→21`. WebM is VP8: the core's VP9 encoder crashes (below).
- **Encoder speed**: x264 `veryfast` default; "take longer for better quality" switches to `medium`.
- **Audio**: AAC 128k Good / 192k High / 96k Small. Opus for WebM.
- **Formats**: video MP4, WebM, MKV, MOV · audio MP3, M4A, Opus, WAV, FLAC, OGG · image PNG, JPG, WebP.
- **Probe**: `ffprobe -print_format json` written to a file and read back. No stderr scraping.
- **Operation-first (D26)**: the landing screen is the list of jobs, searchable, with no drop zone on
  it. Choosing a job is what settles which kinds of file are wanted and how many, so the job screen
  can ask for exactly that — and a link to `/compress` now works for someone arriving with nothing,
  which is what makes the per-operation URLs of D8 worth having. Files are still collected into the
  one `Selection`, so a file brought in on a job screen is on the home screen afterwards with every
  other job it fits; that screen keeps an "add another file" zone, which is how the combine jobs
  stay discoverable (D24). `requirementOf` phrases the ask ("Two or more video files") and
  `briefRequirementOf` the card chip ("2+ videos"); the three jobs wanting a video _and_ something
  else carry their own `needs`/`needsBrief`, since no rule phrases those.
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
- [x] **Stop here. Run it. React to the feel before generalizing.**

### Stage 5 — Generalize

- [x] Operation descriptor interface and registry (`media/operations/descriptor.ts`, `registry.ts`)
- [x] Generated option forms from schema (`app/components/operation-form.ts`)
- [x] Typed-in fields: `number` and `text` kinds, plus the `app-text-input` primitive — the
      schema can now express a width or a caption, so only crop and GIF still need the hatch
- [x] Custom-component escape hatch (D23) — `customForm` key + `NgComponentOutlet`, first used by trim
- [x] Job queue, one active job (`app/core/job-queue.ts`, `app/components/job-list.ts`)
- [x] Error taxonomy with pattern table and OOM path (D17) (`media/ffmpeg/errors.ts`)
- [x] Refactor compression onto the registry to prove the abstraction — the
      compress screen is gone; `/:operation` renders any descriptor

### Stage 6 — Operations

**Multi-input and multi-output are in** (2026-09-21), each proved by one operation:

- [x] **Many inputs.** A descriptor declares `inputs: { min, max }`; the job mounts each file on
      its own mount point, `paths.inputPaths` and `context.inputs` carry them in the user's
      order, and the operation screen lists them with up/down reordering. First user: join.
- [x] **Many outputs.** A descriptor declares `outputs: 'many'`; its output path carries
      `SEQUENCE_TOKEN` (`%04d`) inside a job-owned folder, the runner reads the folder back in
      order, and saving writes into a picked folder (`showDirectoryPicker`) or one stored zip
      (`media/file-system/zip.ts`). First user: extract frames.
- [x] **Mixed inputs.** `requires` names kinds the selection must contain, on top of the count:
      replacing a video's sound takes two files, one of them a video. Measured on the core's 5.1:
      `apad` with `-shortest` ends cleanly, and `amix` takes `normalize=0`.
- Measured: the system FFmpeg 7.1 cuts `-f segment` MP4 output on the wrong keyframe (15 s
  then 10 s for a 10 s split); the core's 5.1 cuts 10/10/5 as asked. Check segments in the browser.
- Measured on the MT core: a `-filter_complex` graph hangs it unless pinned with
  `-filter_complex_threads 1` — `withThreads` adds that alongside `-threads`.
- Measured on the core's FFmpeg 5.1: `fps=1/N` drops the last frame of a run; extract frames
  uses `select` on timestamps instead.

**Video**

- [x] Compress (Stage 4) · [x] Convert format · [x] Resize · [ ] Crop · [x] Trim
- [x] Change FPS · [x] Change quality (Compress's quality mode) · [x] Change bitrate
- [x] Rotate and flip · [x] Speed up / slow down · [x] Reverse · [x] Deinterlace
- [x] Pad to an aspect ratio · [x] Colour adjust, sharpen, blur · [x] Remove a green screen
- Measured on the core's 5.1: reverse buffers raw frames, so the cap is 500 MB of them
  (about 11 s of 720p30); a 480 MB buffer reverses fine on the MT core's fixed heap.
- Measured: a picture looped with `-loop 1` runs at 25 fps and sets `overlay`'s pace, so a
  30 fps video comes out at 25. Green screen passes the video's rate as `-framerate`.
- Measured on the core's 5.1: libvpx-vp9 crashes on the first packet of real footage
  ("memory access out of bounds" on MT, a crash or hang on ST), with or without alpha, and
  `-row-mt`, `-deadline`, `-cpu-used`, `-auto-alt-ref` and `-lag-in-frames` don't help. Flat
  test colours encode fine, which hid it. Transparent green screen uses VP8 (`-auto-alt-ref 0`
  is required with alpha). Compress and Convert encode WebM as VP8 too; VP9 input still
  decodes and copies fine.
- Measured: most of a blurred-bars pad's time is encoding the bigger frame, not the blur;
  blurring at a quarter size still cut the filter's own cost 3–4×.

**Extract**

- [x] Extract audio · [x] Extract frames · [ ] Create GIF · [x] Generate thumbnails (a contact sheet)
- [x] Scene-based thumbnails (`select` on `scene`) · [ ] Animated WebP and APNG

**Audio**

- [x] Convert format (the extract descriptor serves audio inputs too) · [x] Trim · [x] Change bitrate · [x] Change sample rate
- [x] Change volume · [x] Fade in/out · [x] Merge audio
- [x] Normalise loudness (`loudnorm`) · [x] Trim silence · [x] Waveform image · ~~Spectrogram~~ (too slow, below)
- [x] Remove the sound from a video · [x] Replace a video's audio track
- Volume, fades and loudness take a video too: the picture is copied, only the sound re-encoded
  (`sound-output.ts`). An audio file comes back in its own format at its own bitrate, rounded
  up to a standard step and never below 128k. Audio trim shares trim's form and always copies.
- Measured on the core's 5.1: **libopus crashes on stereo** ("memory access out of bounds") at
  `-compression_level` 5 and above, and the default is 10. Mono is fine at any level, which is how
  the mono test clips hid it — WebM from Compress and Convert, green screen, replace-audio, and
  Opus from extract and merge all crashed on ordinary stereo sound. Every Opus encode pins 4 (`opus.ts`).
- Measured: `showspectrumpic` took 98 s for 9 s of audio at 1200×400 and 71 s for a minute at
  300×100 (desktop: under a second). Downsampling to 16 kHz mono only halved it. Left out.
- Measured: libopus refuses any `-ar` but 48 kHz; LAME refuses above 48 kHz and silently caps at
  160 kbps below 32 kHz. `loudnorm` leaves its output at 192 kHz unless `-ar` puts the rate back.
- Measured: a boost through `alimiter=limit=0.891:level=disabled` clipped no samples at +20 dB
  (26,000 without it) and kept the length. Trim silence reaches the end with `areverse`, so a
  recording over ~500 MB of float samples is steered to "every pause", which needs no reverse.

**Images**

- [x] Images → video · [x] Video → images (extract frames) · [ ] GIF conversion
- [x] Join videos (`concat`) · [x] Side by side and grids (`hstack`/`vstack`/`xstack`)
- [x] Logo over a video (`overlay`) · [x] Text over a frame (`drawtext`) · [x] Split into segments · [ ] Strip or fix metadata

- Fonts: DejaVu Sans and Sans Bold (`dejavu-fonts-ttf`) are copied unhashed to `fonts/`, like the
  cores. An operation that sets `fonts` has them fetched once per page and written to `/fonts`
  once per core instance, before it runs; the command shown points at a local `fonts/` folder.
- Measured on the core: a caption is unescaped twice, as a filter option and as part of the
  graph. Escaping for both (`escapeFilterValue`) drew `It's 50% off: [a,b]; c\d %{pts} "q"`
  as typed; `expansion=none` keeps `%{…}` literal.

**Subtitles**

- [x] Extract · [x] Convert format (with a timing shift and text encoding) · [x] Burn in (a file, or the video's own track)
- ffprobe now lists subtitle tracks (`MediaInfo.subtitles`); DVD and Blu-ray tracks are pictures
  and are shown but not choosable.
- Measured: the core's libass has **no font provider**. It loads everything in `fontsdir` as
  memory fonts but cannot fall back from the font a file names (Arial, for SRT) to one it has, so
  nothing is drawn. Every burn forces `FontName=DejaVu Sans`; ASS keeps the rest of its styling.
- Measured: `force_style` takes the **legacy SSA alignment** on this core: `Alignment=8` came out
  middle-left. 2 is bottom centre, 6 top centre. A `BorderStyle=3` box is filled with `OutlineColour`.
- Measured: a non-UTF-8 file stops with "Invalid UTF-8 in decoded subtitles text" (exit 69).
  `-sub_charenc` / `charenc=` fixed CP1250–1256, GB18030, BIG5, Shift_JIS, EUC-KR, ISO-8859-15 and
  KOI8-R. DejaVu has no CJK glyphs, so burning those warns.
- Measured: `-itsoffset` below zero is undone (FFmpeg moves the first line back to 0:00; −1 s and
  −2.5 s gave the same file). `-copyts -itsoffset S -i … -ss 0` keeps the times and drops lines
  that would start before zero; without `-ss 0` they are written as `00:00:00,-500`.

### Stage 7 — Polish

- [ ] Empty, loading, and error states throughout
- [ ] Responsive pass down to phone width
- [ ] Chain output into another operation
- [ ] Operation settings serialized into the URL
- [ ] Temp file cleanup and object URL release
- [ ] About / Licenses footer with GPL and FFmpeg attribution (D19), and the DejaVu font licence
- [ ] Host header configs and service-worker isolation fallback (D2)
- [ ] Production build and static deploy verification

---

## 7. Known risks

| Risk                                  | Mitigation                                                           |
| ------------------------------------- | -------------------------------------------------------------------- |
| OOM on large outputs — 1–2 GB ceiling | Preflight estimate, ST routing for big jobs, explicit OOM error path |
| Cancel costs a worker teardown        | WASM cached, replacement pre-warmed, honest UI wording               |
| Progress events are unreliable        | Sanitize and recompute against a probed duration                     |
| 32 MB core download on first use      | Idle prefetch into Cache API, brotli, clear loading state            |
| H.265 output may not play             | Plain warning, never the default (D22)                               |
| GPL obligations                       | Licenses footer, link to source                                      |
| Angular friction                      | Reassess at the Stage 4 checkpoint (D11)                             |
