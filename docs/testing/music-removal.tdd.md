# Study music removal

- Scope: remove background study stations, player/controller, settings, shortcuts,
  playback IPC, mpv lifecycle and package recommendation. No installed tools or
  user data are removed.
- RED: the removal regression failed while MusicPanel, music.ts and mpv.rs existed;
  the recording/audio-preservation regression passed before production edits.
- GREEN: `bun test src/music-removal.test.ts` passed 2 tests / 32 assertions.
- `bun test`: 95 passed; `cargo test --manifest-path src-tauri/Cargo.toml --lib`:
  105 passed, 1 live-provider test ignored. Svelte check: zero errors/warnings;
  Vite build passed with existing chunk-size/import warnings; Rust fmt passed.
- Preserved: lecture capture and its m bookmark key, live Q&A, audio overviews/TTS,
  Pomodoro, yt-dlp/ffmpeg ingestion, migration 0013 and historical station data.
- This validates source/builds; the previously installed app was not replaced or
  relaunched, and no new installer was created.
