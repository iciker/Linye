<script lang="ts">
  import { annotatePhoneticWords, type PhoneticEntry } from "../lib/phonetics";
  let { text, entries }: { text: string; entries: PhoneticEntry[] } = $props();
  const tokens = $derived(annotatePhoneticWords(text, entries));
</script>

<p class="phonetic-text" data-i18n-skip>
  {#each tokens as token}{#if token.ipa}<span class="phonetic-word"><span>{token.text}</span><span class="ipa">{token.ipa}</span></span>{:else}{token.text}{/if}{/each}
</p>

<style>
  .phonetic-text { white-space: pre-wrap; line-height: 1.8; margin: 0; }
  .phonetic-word { display: inline-flex; flex-direction: column; align-items: center; vertical-align: top; line-height: 1.5; }
  .ipa { color: var(--fg-muted); font-family: system-ui, sans-serif; font-size: .78em; line-height: 1.4; }
</style>
