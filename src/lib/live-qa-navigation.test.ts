import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("Live Q&A has its own menu and lazy view while lecture routes stay unchanged", () => {
  const store = readFileSync("src/lib/store.svelte.ts", "utf8");
  const desktop = readFileSync("src/App.svelte", "utf8");
  const mobile = readFileSync("src/shell/MobileShell.svelte", "utf8");
  const sidebar = readFileSync("src/components/Sidebar.svelte", "utf8");
  const palette = readFileSync("src/components/CommandPalette.svelte", "utf8");
  expect(store).toContain('| "live-qa"');
  for (const shell of [desktop, mobile]) {
    expect(shell).toContain('app.view === "live-qa"');
    expect(shell).toContain('/views/LiveQa.svelte").then');
    expect(shell).toContain('app.view === "recorder"');
    expect(shell).toContain('/views/Recorder.svelte").then');
  }
  const qaNav = sidebar.indexOf("app.view === 'live-qa'");
  expect(qaNav).toBeGreaterThan(sidebar.indexOf("app.view === 'analytics'"));
  expect(qaNav).toBeLessThan(sidebar.indexOf("<!-- Subjects section header -->"));
  expect(sidebar.slice(qaNav, sidebar.indexOf("<!-- Subjects section header -->")))
    .toContain('e.key === "Enter" || e.key === " "');
  expect(mobile).toContain('{ id: "live-qa",     icon: "chat",     label: "Live Q&A" }');
  expect(palette).toContain('run: () => app.setView("live-qa")');
});
