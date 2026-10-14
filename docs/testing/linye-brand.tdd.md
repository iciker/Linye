# Linye brand replacement

Date: 2026-10-08. Linye / 聆页 means listening turned into pages.

## Assets and provenance

- Generated master: `assets/linye-logo.png`, 1254 × 1254 RGBA PNG.
- UI: `src/assets/linye-logo.png`, 256 × 256.
- Native exports: `src-tauri/icons/` (ICNS, ICO, PNG, Android and iOS).
- Tray: `src-tauri/icons/tray.png`, copied from the 64 px native export.
- CI macOS master: `src-tauri/icons/icon-macos.png`, copied from the 512 px native export.
- Palette: pine `#123D35`, ivory `#FFF6E5`, mint `#79E0B5`.
- The first version used a voice-wave / open-page glyph. The current approved version is a folded-paper listening bird on a pine tile, with ivory artwork and mint folds. Built-in image generation produced the design and green variation; the user explicitly approved native background repair on 2026-10-13. AppKit filled defective backing alpha without redrawing the ivory/mint artwork. Exterior alpha is retained. The local creative-board API was unavailable; no board was created.
- Regenerate size/format exports with `bun run tauri icon assets/linye-logo.png --ios-color '#123D35'`, then copy the three derivative files above from `128x128@2x.png`, `64x64.png` and `icon.png` respectively. These are format exports, not model redraws.

The selected name and bird design are design choices, not trademark or domain clearance.

## Green bird integration — 2026-10-13

- Selected generated source: `exec-3f916e34-7e28-4e00-9763-a1d53688cbef.png`; the original remains in Codex's generated-image directory. Image generation could not repair it in this run because its service returned HTTP 401 (IP not authorized); no alternate paid API was called.
- Final master SHA-256: `1b41ec29ff9b5bde6384ab75441ff700f0ffc7f93215c4316c93da2477b49e04`.
- UI / tray / macOS export synchronization is checked by `bun test src/branding.test.ts` (4 tests, 35 assertions); `bun run check` has zero errors or warnings.
- `bun run macos:local` built an arm64 debug `Linye.app` with an ad-hoc signature. `codesign --verify --deep --strict` passed. The bundled application was opened and its actual window showed the green bird, Chinese brand name and existing course content. No recording was started.
- This run does not install an app, create a DMG, publish a release, validate mobile runtime, or change permissions, updater endpoints, app/data identity or recording/Q&A behavior.

## Regression evidence

- RED: `bun test src/branding.test.ts` — 0 pass / 3 fail before native name and logo replacement.
- GREEN: same command — 3 pass / 0 fail. Checks native/UI branding while retaining `study.cortex.app`, package name, data override, language cache and PCM protocol.
- `bun test` — 92 pass / 0 fail; `bun run check` — 0 errors / 0 warnings; `bun run build` — passed, with existing chunk-size and mixed-import warnings.
- `cargo test --lib` — 110 pass / 0 fail / 1 ignored live-provider test. No model request or microphone capture was run.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` — passed.
- Static localization audit — 0 untranslated strings across 61 Svelte files. User-authored breadcrumbs explicitly opt out of brand translation.

Original Cortex attribution, internal identifiers, existing data, upstream URLs and copyright remain intact. Old screenshots/download instructions are labeled as upstream history. This task does not publish or package a renamed release; installed older packages are unchanged. Native Dock, tray and permission-dialog appearance still requires a packaged runtime check.

The upstream release workflow and Homebrew cask still expect Cortex asset names; they must be adapted before publishing a Linye release. The updater still serves upstream Cortex, not Linye: Settings and its installation confirmation explicitly warn that installing an upstream update may replace local customizations.

## Independent app and database identity — 2026-10-13

- User explicitly requested dropping the old app/data identity. The earlier
  identity-preserving evidence above describes the prior branding-only stage.
- App identifier is now `study.linye.app`; startup, export, statistics, backups
  and WebDAV snapshots use `linye.db`, with `linye.stamp` for remote versions.
  Debug/demo variables are `LINYE_DATA_DIR`, `LINYE_DEMO` and `LINYE_DEMO_DIR`.
- RED: branding regression ran 3 pass / 2 fail against the old app ID/database.
- GREEN: `bun test` ran 96 pass / 0 fail; native library tests ran 105 pass,
  1 live-provider test ignored. Svelte check had zero errors/warnings; Vite build,
  Rust fmt and strict Clippy passed. Demo shell and iOS YAML syntax passed.
- No legacy data migration, fallback, deletion or runtime relaunch was performed.
  New packages use a separate app-data identity and need fresh OS permissions and
  model/service configuration. iOS signing requires a profile for the new ID.
- Existing ASR/Moodle wire protocols, encryption domain, user remote paths and
  original attribution remain unchanged. Historical upstream Homebrew packaging
  still describes the upstream Cortex binary, not a Linye installation.
