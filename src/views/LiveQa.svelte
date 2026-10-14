<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { app } from "../lib/store.svelte";
  import { liveQa } from "../lib/live-qa-listener.svelte";
  import { finalizedCaptionText, LiveQaQueue } from "../lib/live-qa";
  import { newestFirstCaptions } from "../lib/live-captions";
  import { translateText } from "../lib/i18n";
  import type { PhoneticEntry } from "../lib/phonetics";
  import * as api from "../lib/api";
  import Icon from "../components/Icon.svelte";
  import Picker from "../components/Picker.svelte";
  import PhoneticVocabulary from "../components/PhoneticVocabulary.svelte";
  import PhoneticText from "../components/PhoneticText.svelte";

  const subjectOptions = $derived(app.subjects.map((subject) => ({
    id: subject.id, label: subject.code ? `${subject.name} · ${subject.code}` : subject.name, userContent: true,
  })));
  const newestCaptions = $derived(newestFirstCaptions(liveQa.captions));
  let phoneticEntries = $state<PhoneticEntry[]>([]);

  // ---- document scope and answer queue ----
  let liveQaError = $state("");
  let liveQaModel = $state("");
  let qaDocuments = $state<api.Source[]>([]);
  let selectedDocIds = $state<string[]>([]);
  let documentsLoading = $state(false);
  let documentsUploading = $state(false);
  let documentsError = $state("");
  let documentWarning = $state("");
  let documentScope = $state("");
  let disposed = false;
  let documentLoad = 0;
  let listeningStart = false;
  const seenCaptionIds = new Set<number>();
  type QaRequest = { id: number; subjectId: string; question: string; sourceIds: string[] };
  type QaReply = QaRequest & { status: "queued" | "answering" | "done" | "error"; answer?: api.ChatAnswer; error?: string };
  let qaReplies = $state<QaReply[]>([]);
  let nextQaId = 0;
  const liveQaPending = $derived(qaReplies.filter((reply) => reply.status === "queued" || reply.status === "answering").length);
  let answersAtLatest = $state(true);
  let repliesElement: HTMLDivElement | null = null;

  function returnToLatest() {
    answersAtLatest = true;
    if (repliesElement) repliesElement.scrollTop = 0;
  }

  function preserveAnswerPosition(node: HTMLDivElement) {
    repliesElement = node;
    let anchor: HTMLElement | null = null;
    let offset = 0;
    function rememberPosition() {
      answersAtLatest = node.scrollTop < 24;
      const top = node.getBoundingClientRect().top;
      anchor = answersAtLatest ? null : [...node.querySelectorAll<HTMLElement>("[data-qa-reply]")]
        .find((reply) => reply.getBoundingClientRect().bottom > top) ?? null;
      if (anchor) offset = anchor.getBoundingClientRect().top - top;
    }
    const observer = new ResizeObserver(() => {
      if (answersAtLatest) node.scrollTop = 0;
      else if (anchor?.isConnected) node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - offset;
      else rememberPosition();
    });
    node.addEventListener("scroll", rememberPosition, { passive: true });
    observer.observe(node.firstElementChild!);
    observer.observe(node);
    rememberPosition();
    return { destroy() {
      observer.disconnect();
      node.removeEventListener("scroll", rememberPosition);
      repliesElement = null;
    } };
  }

  function updateReply(id: number, patch: Partial<QaReply>) {
    qaReplies = qaReplies.map((reply) => reply.id === id ? { ...reply, ...patch } : reply);
  }
  const qaQueue = new LiveQaQueue<QaRequest, api.ChatAnswer>({
    request: (item) => api.chatAnswer(item.subjectId, "subject", item.question, undefined, item.sourceIds, false, "live"),
    onStart: (item) => updateReply(item.id, { status: "answering" }),
    onResult: (item, answer) => updateReply(item.id, { status: "done", answer }),
    onError: (item, error) => updateReply(item.id, { status: "error", error: String(error) }),
  });

  function resetLiveQa(skipExisting = true) {
    qaQueue.reset();
    qaReplies = [];
    returnToLatest();
    liveQaError = "";
    seenCaptionIds.clear();
    if (skipExisting) for (const caption of liveQa.captions) if (caption.final) seenCaptionIds.add(caption.id);
  }
  onDestroy(() => {
    disposed = true;
    qaQueue.reset();
    liveQa.cancel();
  });
  onMount(() => {
    void Promise.all([api.getSetting("model_live_qa"), api.getSetting("model_chat")])
      .then(([live, chat]) => { if (!disposed) liveQaModel = live?.trim() || chat || ""; })
      .catch((error) => { if (!disposed) liveQaError = String(error); });
  });

  async function loadQaDocuments(subjectId: string, restoreSelection = false) {
    if (!subjectId) return;
    const load = ++documentLoad;
    documentsLoading = true;
    documentsError = "";
    try {
      const sources = await api.listSources(subjectId);
      const saved = restoreSelection ? await api.getSetting(`live_qa_sources_${subjectId}`) : null;
      if (disposed || documentScope !== subjectId || load !== documentLoad) return;
      qaDocuments = sources.filter((source) => ["pdf", "docx", "pptx", "epub", "txt", "md"].includes(source.kind));
      let ids = selectedDocIds;
      if (restoreSelection && saved) {
        try {
          const parsed: unknown = JSON.parse(saved);
          ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
        } catch { ids = []; }
      }
      const selected = [...new Set(ids)].filter((id) => qaDocuments.some((doc) => doc.id === id && doc.status === "ready")).slice(0, 32);
      if (!restoreSelection && selected.join("\n") !== selectedDocIds.join("\n")) resetLiveQa();
      selectedDocIds = selected;
    } catch (error) {
      if (!disposed && documentScope === subjectId && load === documentLoad) documentsError = String(error);
    } finally {
      if (!disposed && documentScope === subjectId && load === documentLoad) documentsLoading = false;
    }
  }

  $effect(() => {
    const subjectId = app.activeSubject?.id ?? "";
    untrack(() => {
      if (documentScope === subjectId) return;
      liveQa.cancel();
      documentScope = subjectId;
      qaDocuments = [];
      selectedDocIds = [];
      documentsLoading = false;
      documentsError = documentWarning = "";
      resetLiveQa();
      void loadQaDocuments(subjectId, true);
    });
  });

  function selectQaSubject(id: string) {
    if (!app.subjects.some((subject) => subject.id === id)) return;
    app.activeSubjectId = id;
    void api.setSetting("last_subject_id", id).catch((error) => { if (!disposed) documentsError = String(error); });
  }

  function selectQaDocument(id: string, checked: boolean) {
    if (checked && selectedDocIds.length >= 32) {
      documentsError = "Select at most 32 realtime Q&A documents.";
      return;
    }
    selectedDocIds = checked ? [...new Set([...selectedDocIds, id])] : selectedDocIds.filter((item) => item !== id);
    resetLiveQa();
    const subjectId = documentScope;
    void api.setSetting(`live_qa_sources_${subjectId}`, JSON.stringify(selectedDocIds))
      .catch((error) => { if (!disposed && documentScope === subjectId) documentsError = String(error); });
  }

  async function uploadQaDocuments() {
    const subjectId = documentScope;
    if (!subjectId || documentsUploading) return;
    documentsUploading = true;
    documentsError = documentWarning = "";
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true, directory: false,
        filters: [{ name: "Documents", extensions: ["pdf", "docx", "doc", "pptx", "ppt", "epub", "txt", "md"] }] });
      for (const path of picked ? (Array.isArray(picked) ? picked : [picked]) : []) {
        if (disposed || documentScope !== subjectId) break;
        const name = path.split(/[\\/]/).at(-1) || "Document";
        const result = await api.addSource({ subject_id: subjectId, topic_id: null, path, name, tags: [] });
        if (disposed || documentScope !== subjectId) break;
        qaDocuments = [...qaDocuments.filter((doc) => doc.id !== result.source.id), result.source];
        if (result.warning) documentWarning = result.warning;
        if (result.source.status === "ready" && result.chars > 0 && selectedDocIds.length < 32) {
          selectQaDocument(result.source.id, true);
        } else if (!result.chars) documentWarning = "No readable text found; this document cannot be used for answers.";
      }
      if (!disposed) void app.refresh();
    } catch (error) {
      if (!disposed && documentScope === subjectId) documentsError = String(error);
    } finally {
      if (!disposed) documentsUploading = false;
    }
  }

  function answerLiveQuestion(question: string) {
    if (!documentScope || documentScope !== app.activeSubject?.id || !selectedDocIds.length || documentsLoading || documentsUploading) {
      liveQaError = "Upload and select reference documents before starting live Q&A.";
      return;
    }
    liveQaError = "";
    const item = { id: ++nextQaId, subjectId: documentScope, question, sourceIds: [...selectedDocIds] };
    qaReplies = [{ ...item, status: "queued" as const }, ...qaReplies];
    qaQueue.enqueue(item);
  }

  function askLatestCaption() {
    const caption = newestFirstCaptions(liveQa.captions).find((item) => item.final && item.original.trim());
    if (caption) answerLiveQuestion(caption.original.trim());
  }

  async function startListening() {
    if (listeningStart || liveQa.starting || liveQa.listening || liveQa.finishing) return;
    if (!documentScope || documentScope !== app.activeSubject?.id || !selectedDocIds.length || documentsLoading || documentsUploading) {
      liveQaError = "Upload and select reference documents before starting live Q&A.";
      return;
    }
    const previousCaptions = liveQa.captions;
    listeningStart = true;
    try { await liveQa.start(); }
    finally {
      // A refused start retains captions; a new listener may reuse caption IDs.
      if (liveQa.captions !== previousCaptions) seenCaptionIds.clear();
      listeningStart = false;
      submitLiveCaptions();
    }
  }

  function submitLiveCaptions() {
    const captions = liveQa.captions;
    const subjectId = app.activeSubject?.id ?? "";
    const scope = documentScope;
    const documentsReady = selectedDocIds.length > 0 && !documentsLoading && !documentsUploading;
    untrack(() => {
      // Normal stop retains the flushed final tail; cancel clears captions instead.
      if (disposed || listeningStart || !documentsReady || scope !== subjectId) return;
      for (const caption of captions) {
        const question = finalizedCaptionText(caption);
        if (!question || seenCaptionIds.has(caption.id)) continue;
        seenCaptionIds.add(caption.id);
        answerLiveQuestion(question);
      }
    });
  }
  $effect(submitLiveCaptions);
  // ---- end document scope and answer queue ----
</script>

<div class="qa-page">
  <header class="qa-heading">
    <div><span class="mono faint">Live Q&amp;A</span><h1>Listen and answer from your documents</h1></div>
    <div class="qa-subject"><span class="mono faint">SUBJECT</span><Picker value={app.activeSubjectId ?? ""} onChange={selectQaSubject} options={subjectOptions} placeholder="Pick a subject" /></div>
  </header>
  <div class="qa-layout">
    <section class="qa-setup">
      <div class="qa-listen">
        <span class="status-pill" class:status-pill--draft={liveQa.listening}><span class="dot"></span>{liveQa.starting ? "Starting microphone…" : liveQa.finishing ? "Finishing captions…" : liveQa.listening ? "Listening" : "READY"}</span>
        {#if liveQa.listening}
          <button class="btn btn--primary" onclick={() => liveQa.stop()}><Icon name="pause" size={14} />Stop listening</button>
        {:else}
          <button class="btn btn--primary" disabled={!selectedDocIds.length || documentsLoading || documentsUploading || liveQa.starting || liveQa.finishing} onclick={startListening}><Icon name="mic" size={14} />Start listening</button>
        {/if}
      </div>
      <p class="qa-help">Microphone only. Leaving this page stops listening; no lecture recording is saved.</p>
      <p class="qa-help">Leaving this page cancels waiting answers; already submitted requests still finish.</p>
      {#if liveQa.error}<p class="qa-error" data-i18n-skip>{translateText(liveQa.error, app.language)}</p>{/if}
      <div class="qa-row">
        <span><span>Live Q&amp;A model</span>: <span data-i18n-skip>{liveQaModel || "—"}</span></span>
        <button class="btn btn--ghost btn--sm" onclick={() => app.openSettings("models")}>Choose model</button>
      </div>
      <p class="qa-help">Confirmed speech is submitted immediately, without waiting for translation. Cloud models may charge for usage.</p>
      <h2>Reference documents</h2>
      <div class="qa-tools">
        <button class="btn btn--ghost btn--sm" disabled={!documentScope || documentsLoading || documentsUploading} onclick={uploadQaDocuments}><Icon name="doc" size={13} />{documentsUploading ? "Importing documents…" : "Upload Q&A reference documents"}</button>
        <PhoneticVocabulary onChange={(entries) => { phoneticEntries = entries; }} />
        <button class="btn btn--ghost btn--sm" disabled={!documentScope || documentsLoading || documentsUploading} onclick={() => loadQaDocuments(documentScope)}>Refresh</button>
      </div>
      <p class="mono faint qa-help"><span>PDF / DOCX · selected documents</span>: {selectedDocIds.length}/{qaDocuments.length}</p>
      <div class="qa-documents">
        {#each qaDocuments as doc (doc.id)}
          <label>
            <input type="checkbox" checked={selectedDocIds.includes(doc.id)} disabled={doc.status !== "ready" || documentsLoading || documentsUploading} onchange={(event) => selectQaDocument(doc.id, event.currentTarget.checked)} />
            <span data-i18n-skip>{doc.name}</span>
            {#if doc.status !== "ready"}<span class="faint" data-i18n-skip>{doc.status}</span>{/if}
          </label>
        {/each}
      </div>
      {#if documentsLoading}<p class="mono faint">Loading documents…</p>{/if}
      {#if !selectedDocIds.length}<p class="qa-help">Upload and select reference documents before starting live Q&amp;A.</p>{/if}
      {#if documentsError}<p class="qa-error">{documentsError}</p>{/if}
      {#if documentWarning}<p class="qa-error">{documentWarning}</p>{/if}
      <div class="qa-row"><h2>Recent speech</h2><button class="btn btn--ghost btn--sm" disabled={!liveQa.captions.some((caption) => caption.final) || !selectedDocIds.length} onclick={askLatestCaption}>Answer latest caption</button></div>
      <div class="qa-captions" aria-live="polite">
        {#each newestCaptions as caption (caption.id)}
          <p class:qa-interim={!caption.final} data-i18n-skip>{caption.original}</p>
        {/each}
        {#if !liveQa.captions.length}<p class="mono faint">Listening for confirmed speech…</p>{/if}
      </div>
    </section>
    <section class="qa-answers">
      <div class="qa-row"><h2>Answer from selected documents</h2>{#if liveQaPending}<span class="mono faint"><span>Pending answers</span>: {liveQaPending}</span>{/if}</div>
      <p class="qa-help" data-i18n-skip>{app.language === "zh-CN" ? "有资料只用资料，无相关内容才通用参考。" : "Use your documents whenever relevant; use general reference only when no relevant content is found."}</p>
      <p class="qa-help" data-i18n-skip>{app.language === "zh-CN" ? "本次页面会话保留所有回答；更换课程或资料范围会清空回答。" : "All answers stay in this page session; changing the subject or reference documents clears them."}</p>
      <div class="qa-tools"><button class="btn btn--ghost btn--sm" disabled={answersAtLatest} onclick={returnToLatest} data-i18n-skip>{app.language === "zh-CN" ? "回到最新" : "Back to latest"}</button></div>
      {#if liveQaError}<p class="qa-error">{liveQaError}</p>{/if}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll this independent region.) -->
      <div class="qa-replies" use:preserveAnswerPosition role="region" tabindex="0" aria-label={app.language === "zh-CN" ? "回答历史" : "Answer history"} aria-live={answersAtLatest ? "polite" : "off"}>
        <div class="qa-replies-content">
        {#each qaReplies as reply (reply.id)}
          <article data-qa-reply>
            <p class="qa-question" data-i18n-skip>{reply.question}</p>
            {#if reply.status === "queued"}<p class="mono faint">Waiting for the previous answer…</p>
            {:else if reply.status === "answering"}<p class="mono faint">Searching your documents and drafting an answer…</p>
            {:else if reply.error}<p class="qa-error" data-i18n-skip>{translateText(reply.error, app.language)}</p>
            {:else if reply.answer}
              {#if reply.answer.basis === "general"}<span class="status-pill qa-basis" data-i18n-skip>{app.language === "zh-CN" ? "通用参考" : "General reference"}</span>
              {:else if reply.answer.basis === "documents"}<span class="status-pill qa-basis" data-i18n-skip>{app.language === "zh-CN" ? "文档依据" : "Document based"}</span>{/if}
              <div class="qa-answer" data-i18n-skip><PhoneticText text={reply.answer.text} entries={phoneticEntries} /></div>
              <p class="mono faint qa-help" data-i18n-skip>{reply.answer.model} · {reply.answer.citations.map((item) => item.source_name).join(" · ")}</p>
            {/if}
          </article>
        {/each}
        {#if !qaReplies.length}<p class="qa-help">Select documents and start listening to receive answers here.</p>{/if}
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .qa-page { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 28px; }
  .qa-heading, .qa-row, .qa-listen, .qa-tools { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
  .qa-heading { margin-bottom: 22px; flex-wrap: wrap; flex: none; }
  h1 { font-size: var(--t-xl); margin: 6px 0; }
  h2 { font-size: var(--t-sm); margin: 18px 0 10px; }
  .qa-subject { min-width: 230px; }
  .qa-subject > span { display: block; font-size: var(--t-2xs); margin-bottom: 6px; }
  .qa-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(280px, .85fr) minmax(340px, 1.15fr); grid-template-rows: minmax(0, 1fr); gap: 22px; }
  .qa-setup, .qa-answers { min-width: 0; min-height: 0; padding: 20px; border: 1px solid var(--border); border-radius: var(--rad-3); background: var(--surface-2); }
  .qa-setup { overflow-y: auto; }
  .qa-answers { display: flex; flex-direction: column; }
  .qa-answers > :not(.qa-replies) { flex: none; }
  .qa-tools { flex-wrap: wrap; justify-content: flex-start; gap: 6px; }
  .qa-help { color: var(--fg-muted); font-size: var(--t-xs); line-height: 1.65; margin: 9px 0; }
  .qa-row > span { font-size: var(--t-xs); overflow-wrap: anywhere; }
  .qa-error { color: var(--err); font-size: var(--t-sm); overflow-wrap: anywhere; }
  .qa-documents { max-height: 230px; overflow-y: auto; }
  .qa-documents label { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: var(--t-xs); overflow-wrap: anywhere; }
  .qa-documents input { flex: none; }
  .qa-captions { max-height: 260px; overflow-y: auto; font-size: var(--t-sm); }
  .qa-captions p { padding-bottom: 10px; border-bottom: 1px solid var(--border); white-space: pre-wrap; }
  .qa-interim { opacity: .6; }
  .qa-replies { flex: 1; min-height: 0; overflow-y: auto; overflow-anchor: none; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .qa-replies:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .qa-basis { margin: 4px 0 8px; }
  .qa-replies article { padding: 16px 0; border-bottom: 1px solid var(--border); }
  .qa-question { color: var(--fg-muted); font-size: var(--t-sm); white-space: pre-wrap; }
  .qa-answer { line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 1000px) {
    .qa-page { padding: 16px; overflow-y: auto; }
    .qa-layout { display: flex; flex: none; flex-direction: column; }
    .qa-setup { overflow: visible; }
    .qa-answers { height: 70dvh; min-height: 320px; }
  }
</style>
