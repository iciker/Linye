import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("study music has no UI, shortcut, controller or playback IPC left", () => {
  for (const path of ["src/components/MusicPanel.svelte", "src/lib/music.ts", "src-tauri/src/mpv.rs"]) {
    expect(existsSync(path)).toBe(false);
  }
  for (const path of [
    "src/App.svelte", "src/components/Sidebar.svelte", "src/components/CommandPalette.svelte",
    "src/components/LeaderPane.svelte", "src/lib/store.svelte.ts", "src/lib/keybinds.svelte.ts",
    "src/lib/api.ts", "src/views/Settings.svelte", "src-tauri/src/lib.rs",
    "src-tauri/src/commands.rs", "src-tauri/src/repo.rs", "src-tauri/src/models.rs",
  ]) {
    expect(read(path)).not.toMatch(/MusicPanel|musicOpen|musicBuffering|stationFavs|customStations|toggleMusic|playStation|tray-music-toggle|youtube_(?:play|pause|resume|stop|set_volume|prewarm)|(?:list|add|delete|reorder)_custom_stations?\b|mod mpv;|mpv::/);
  }
  expect(read("src/components/Sidebar.svelte")).not.toContain("sb-music");
  expect(read("src/views/Settings.svelte")).not.toContain("Study music");
  expect(read("src/views/Settings.svelte")).not.toContain("YouTube streaming");
  expect(read("src-tauri/Cargo.toml")).not.toMatch(/^libc\s*=/m);
  expect(read("packaging/aur/PKGBUILD")).not.toContain("mpv:");
});

test("removing music preserves schema history, recording and audio overviews", () => {
  expect(read("src-tauri/src/db.rs")).toContain("0013_custom_stations.sql");
  expect(existsSync("src-tauri/migrations/0013_custom_stations.sql")).toBe(true);
  expect(read("src/views/Settings.svelte")).toContain("voice_a");
  expect(read("src/views/Settings.svelte")).toContain("voice_b");
  expect(read("src/views/Settings.svelte")).toContain("Recording input");
  expect(read("src/views/Settings.svelte")).toContain("Focus timer");
  expect(read("src/lib/recorder.svelte.ts")).toContain("encodeWav");
  expect(read("src/views/Recorder.svelte")).toContain('e.key === "m"');
  expect(read("src/views/Recorder.svelte")).toContain("rec.tagMoment()");
  expect(read("src/lib/api.ts")).toContain("generateMaterial");
  expect(read("src/views/GenerateMaterial.svelte")).toContain('label: "Audio overview"');
  expect(read("src-tauri/src/ingest.rs")).toContain("yt-dlp");
});
