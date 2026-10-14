<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as api from "../lib/api";
  import { MAX_PHONETIC_WORDS, generatePhoneticsSerially, phoneticWords, phoneticWordKey, readPhoneticEntries, validatePhoneticEntries, type PhoneticEntry } from "../lib/phonetics";

  let { onChange }: { onChange: (entries: PhoneticEntry[]) => void } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let entries = $state<PhoneticEntry[]>([]);
  let draft = $state<PhoneticEntry[]>([]);
  let dialect = $state<"en-GB" | "en-US">("en-GB");
  let savedDialect: "en-GB" | "en-US" = "en-GB";
  let words = $state("");
  let loading = $state(true);
  let generating = $state(false);
  let generatedCount = $state(0);
  let generationTotal = $state(0);
  let saving = $state(false);
  let error = $state("");
  let model = $state("");
  let disposed = false;
  let generation = 0;
  let previousModal = false;

  onMount(() => {
    void Promise.all([api.getSetting("phonetic_vocabulary"), api.getSetting("phonetic_dialect"),
      api.getSetting("model_live_qa"), api.getSetting("model_chat")])
      .then(([saved, pronunciation, live, chat]) => {
        if (disposed) return;
        entries = readPhoneticEntries(saved);
        savedDialect = pronunciation === "en-US" ? "en-US" : "en-GB";
        model = live?.trim() || chat || "";
        onChange(entries);
      })
      .catch((reason) => { if (!disposed) error = String(reason); })
      .finally(() => { if (!disposed) loading = false; });
  });
  onDestroy(() => {
    disposed = true;
    generation++;
    if (dialog?.open) { window.__cortexModalOpen = previousModal; dialog.close(); }
  });

  function openEditor() {
    if (!dialog) return;
    generation++;
    draft = entries.map((entry) => ({ ...entry }));
    dialect = savedDialect;
    words = "";
    previousModal = !!window.__cortexModalOpen;
    window.__cortexModalOpen = true;
    dialog.showModal();
  }
  function closed() {
    generation++;
    window.__cortexModalOpen = previousModal;
  }
  function addWords() {
    try {
      const additions = phoneticWords(words);
      const existing = new Set(draft.map((entry) => phoneticWordKey(entry.word)));
      const next = [...draft, ...additions.filter((word) => !existing.has(phoneticWordKey(word)))
        .map((word) => ({ word, ipa: "" }))];
      if (next.length > MAX_PHONETIC_WORDS) throw new Error("The phonetic vocabulary must contain at most 200 words.");
      draft = next;
      words = "";
      error = "";
    } catch (reason) { error = String(reason); }
  }
  function changeDialect(value: string) {
    dialect = value === "en-US" ? "en-US" : "en-GB";
    draft = draft.map((entry) => ({ ...entry, ipa: "" }));
  }
  async function generate() {
    const pending = draft.filter((entry) => !entry.ipa.trim()).slice(0, 30);
    if (!pending.length || generating || saving) return;
    generating = true;
    generatedCount = 0;
    generationTotal = pending.length;
    error = "";
    const current = ++generation;
    try {
      for await (const entry of generatePhoneticsSerially(
        pending.map((entry) => entry.word), (words) => api.generatePhonetics(words, dialect),
      )) {
        if (disposed || current !== generation || !dialog?.open) break;
        draft = draft.map((row) => row.ipa.trim() || phoneticWordKey(row.word) !== phoneticWordKey(entry.word)
          ? row : { ...row, ipa: entry.ipa });
        generatedCount++;
      }
    } catch (reason) { if (!disposed && current === generation) error = String(reason); }
    finally { if (!disposed) generating = false; }
  }
  async function save() {
    if (saving || generating) return;
    saving = true;
    error = "";
    try {
      const valid = validatePhoneticEntries(draft, true);
      await api.setSettings({ phonetic_vocabulary: JSON.stringify(valid), phonetic_dialect: dialect });
      if (disposed) return;
      entries = valid;
      savedDialect = dialect;
      onChange(entries);
      dialog?.close();
    } catch (reason) { if (!disposed) error = String(reason); }
    finally { if (!disposed) saving = false; }
  }
</script>

<button type="button" class="btn btn--ghost btn--sm" disabled={loading} onclick={openEditor}>
  <span>Phonetic vocabulary</span> <span data-i18n-skip>({entries.length})</span>
</button>
{#if error && !dialog?.open}<p class="vocabulary-error">{error}</p>{/if}

<dialog bind:this={dialog} class="vocabulary" aria-labelledby="phonetic-vocabulary-title" onclose={closed}
  oncancel={(event) => { if (saving) event.preventDefault(); }}
  onkeydown={(event) => event.stopPropagation()}>
  <h2 id="phonetic-vocabulary-title">Phonetic vocabulary</h2>
  <p>Generate IPA once, review it, then save. Answers show saved IPA below matching words without another model request.</p>
  <p><span>Uses the Live Q&amp;A model</span>: <span data-i18n-skip>{model || "—"}</span></p>
  <p>Generated pronunciation may need correction. For words with several readings, choose the intended pronunciation manually.</p>
  <label for="phonetic-dialect">Pronunciation</label>
  <select id="phonetic-dialect" class="input" value={dialect} disabled={generating || saving}
    onchange={(event) => changeDialect(event.currentTarget.value)}>
    <option value="en-GB">British English</option><option value="en-US">American English</option>
  </select>
  <p class="faint">Changing dialect clears draft IPA. Saved entries are unchanged until you save.</p>
  <label for="phonetic-words">Words to annotate</label>
  <textarea id="phonetic-words" class="input" rows="3" bind:value={words} disabled={generating || saving}
    placeholder="Enter English words separated by spaces, commas or newlines."></textarea>
  <div class="vocabulary-actions">
    <button type="button" class="btn btn--sm" onclick={addWords} disabled={!words.trim() || generating || saving}>Add words</button>
    <button type="button" class="btn btn--sm" onclick={generate} disabled={generating || saving || !draft.some((entry) => !entry.ipa.trim())}>
      <span>{generating ? "Generating IPA…" : "Generate missing IPA"}</span>
      {#if generating}<span data-i18n-skip>{generatedCount}/{generationTotal}</span>{/if}
    </button>
  </div>
  <p class="faint">At most 200 saved words. Generate up to 30 pronunciations per click.</p>
  <div class="vocabulary-list">
    {#each draft as entry, index}
      <div class="vocabulary-row">
        <input class="input" aria-label="English word" bind:value={entry.word} oninput={() => { entry.ipa = ""; }} disabled={generating || saving} data-i18n-skip />
        <input class="input" aria-label="IPA pronunciation" bind:value={entry.ipa} placeholder="/IPA/" disabled={generating || saving} data-i18n-skip />
        <button type="button" class="btn btn--ghost btn--sm" disabled={generating || saving} onclick={() => { draft = draft.filter((_, i) => i !== index); }}>Remove</button>
      </div>
    {/each}
  </div>
  {#if error}<p class="vocabulary-error" role="alert">{error}</p>{/if}
  <div class="vocabulary-actions">
    <button type="button" class="btn btn--ghost" disabled={saving} onclick={() => dialog?.close()}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={generating || saving || !!words.trim()} onclick={save}>{saving ? "Saving…" : "Save"}</button>
  </div>
</dialog>

<style>
  .vocabulary { width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 48px); box-sizing: border-box; overflow-y: auto; border: 1px solid var(--border-strong); border-radius: var(--r-lg, 12px); padding: 24px; color: var(--fg); background: var(--surface); }
  .vocabulary::backdrop { background: rgb(0 0 0 / .6); }
  .vocabulary h2 { margin: 0 0 12px; font-size: 18px; }
  .vocabulary p { font-size: 12px; line-height: 1.6; }
  .vocabulary label { display: block; margin: 12px 0 6px; font-size: 12px; }
  .vocabulary textarea { width: 100%; box-sizing: border-box; resize: vertical; }
  .vocabulary-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .vocabulary-list { max-height: 260px; overflow-y: auto; }
  .vocabulary-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto; gap: 8px; margin: 6px 0; }
  .vocabulary-row input { min-width: 0; font-family: system-ui, sans-serif; }
  .vocabulary-error { color: var(--danger, #e27878); font-size: 12px; white-space: pre-wrap; }
  @media (max-width: 480px) { .vocabulary { padding: 16px; } .vocabulary-row { gap: 4px; } }
</style>
