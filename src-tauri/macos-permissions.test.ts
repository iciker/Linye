import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("macOS microphone bundle permissions", () => {
  test("only admits macOS versions supported by the ScreenCaptureKit bridge", () => {
    const release = JSON.parse(readFileSync(new URL("./tauri.macos.conf.json", import.meta.url), "utf8"));
    const local = JSON.parse(readFileSync(new URL("./tauri.macos.local.conf.json", import.meta.url), "utf8"));

    for (const macOS of [release.bundle.macOS, { ...release.bundle.macOS, ...local.bundle.macOS }]) {
      // screencapturekit 8.0.1's Swift package targets macOS 13.0.
      expect(Number(macOS.minimumSystemVersion.split(".")[0])).toBeGreaterThanOrEqual(13);
    }
  });

  test("signs macOS builds with the audio-input entitlement", () => {
    const entitlements = readFileSync(new URL("./Entitlements.plist", import.meta.url), "utf8");
    expect(entitlements).toContain("com.apple.security.device.audio-input");
    expect(entitlements).toMatch(/<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);

    for (const config of ["tauri.macos.conf.json", "tauri.macos.local.conf.json"]) {
      const json = JSON.parse(readFileSync(new URL(`./${config}`, import.meta.url), "utf8"));
      expect(json.bundle.macOS.entitlements).toBe("Entitlements.plist");
    }
  });

  test("declares why combined recordings need ScreenCaptureKit access", () => {
    const info = readFileSync(new URL("./Info.plist", import.meta.url), "utf8");
    expect(info).toContain("NSScreenCaptureUsageDescription");
    expect(info).toContain("system audio");
  });
});
