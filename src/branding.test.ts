import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Linye owns its app and database identities while retaining external protocol compatibility", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  expect(config.productName).toBe("Linye");
  expect(config.app.windows[0].title).toBe("Linye");
  expect(config.identifier).toBe("study.linye.app");
  expect(JSON.parse(read("package.json")).name).toBe("cortex");
  expect(read("src/lib/i18n.ts")).toContain('const CACHE_KEY = "cortex-language"');
  expect(read("src-tauri/src/lib.rs")).toContain('std::env::var("LINYE_DATA_DIR")');
  expect(read("src/lib/vibevoice.ts")).toContain("cortex-pcm-v1");
});

test("startup, backup, export and sync consistently use the Linye database", () => {
  for (const path of [
    "src-tauri/src/lib.rs", "src-tauri/src/commands.rs",
    "src-tauri/src/backup.rs", "src-tauri/src/sync.rs",
  ]) {
    expect(read(path).includes('"linye.db"')).toBe(true);
    expect(read(path).includes('"cortex.db"')).toBe(false);
  }
  const script = read("scripts/demo.sh");
  expect(script).toContain("LINYE_DATA_DIR");
  expect(script).toContain("LINYE_DEMO");
  expect(script).not.toContain("CORTEX_DATA_DIR");
  expect(read("src-tauri/src/lib.rs")).not.toContain("CORTEX_DATA_DIR");
  expect(read("src-tauri/src/lib.rs").includes("CORTEX_DEMO")).toBe(false);
  expect(read(".github/workflows/ios.yml")).not.toContain("study.cortex.app");
});

test("desktop and mobile branding use the new logo and name", () => {
  for (const path of ["src/components/Sidebar.svelte", "src/shell/MobileShell.svelte", "src/views/Onboarding.svelte"]) {
    const source = read(path);
    expect(source).toContain("assets/linye-logo.png");
    expect(source).toContain("Linye");
    expect(source).not.toContain("assets/cortex-logo.png");
  }
  expect(read("src/components/Titlebar.svelte")).toContain(">Linye</div>");
  expect(read("index.html")).toContain("<title>Linye");
});

test("native tray and privacy prompts identify the renamed app", () => {
  const native = read("src-tauri/src/lib.rs");
  expect(native).toContain('"Open Linye"');
  expect(native).toContain('.tooltip("Linye")');
  const plist = read("src-tauri/Info.plist");
  expect(plist).toContain("Linye uses your microphone");
  expect(plist).not.toContain("Cortex uses");
  expect(read("src/lib/recorder-errors.ts")).toContain("Allow Linye in System Settings");
});

test("UI, tray and macOS PNGs match the generated native exports", () => {
  for (const [asset, exported, size] of [
    ["src/assets/linye-logo.png", "src-tauri/icons/128x128@2x.png", 256],
    ["src-tauri/icons/tray.png", "src-tauri/icons/64x64.png", 64],
    ["src-tauri/icons/icon-macos.png", "src-tauri/icons/icon.png", 512],
  ] as const) {
    const png = readFileSync(asset);
    expect(png.equals(readFileSync(exported))).toBe(true);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
});
