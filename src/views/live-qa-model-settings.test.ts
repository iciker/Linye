import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settings = readFileSync("src/views/Settings.svelte", "utf8");

describe("Live Q&A model settings", () => {
  test("uses the existing task table and model catalogs with its own settings keys", () => {
    expect(settings.includes('{ id: "live_qa",    label: "Live Q&A"')).toBe(true);
    expect(settings.includes("for (const { id: taskId } of MODEL_TASKS)")).toBe(true);
    expect(settings.includes("{@const a = taskAssignment(t.id)}")).toBe(true);
    expect(settings.includes("onOpen={isLmStudio ? ensureLmStudioModels")).toBe(true);
    expect(settings.includes("kv.budget_live_qa = \"800\"")).toBe(true);
  });

  test("inherits the chat assignment without fixing a model until explicitly changed", () => {
    expect(settings.includes('live_qa:    { provider: "", model: "", budget: "" }')).toBe(true);
    expect(settings.includes("Using the Chat model until you choose a separate model.")).toBe(true);
    expect(settings.includes("saveModelSelection(taskId, taskAssignment(taskId).provider, m)")).toBe(true);

    const source = settings.slice(settings.indexOf("  function taskAssignment("), settings.indexOf("  // ---- keys state ----"));
    const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    const assign = {
      chat: { provider: "custom", model: "chat-model", budget: "8000" },
      live_qa: { provider: "", model: "", budget: "" },
    };
    const resolve = new Function("assign", javascript + "; return taskAssignment;")(assign);
    expect(resolve("live_qa")).toEqual(assign.chat);
    assign.chat.model = "another-chat-model";
    expect(resolve("live_qa").model).toBe("another-chat-model");
    assign.live_qa = { provider: "lmstudio", model: "", budget: "800" };
    expect(resolve("live_qa")).toEqual(assign.live_qa);
  });
});
