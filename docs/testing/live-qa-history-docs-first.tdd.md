# Live Q&A history and documents-first answers

## Scope

- Selected document context answers the question: use only supported document facts.
- Context cannot answer: return a separately labeled general reference, without invented personal facts or document citations.
- Preserve all page-session replies across microphone restart; clear on subject/document-scope changes or navigation.
- Independently scroll answers; keep the visible reply anchored when newer cards or taller answers arrive.
- Lecture recording, provider assignments and audio capture are unchanged.

## RED / GREEN evidence (2026-10-08)

- Rust RED: new parser/prompt tests failed to compile because their production helper and prompt were absent.
- Frontend RED: real page-handler harness had four target failures: restart dropped queued/active replies, refused restart dropped completed replies, history truncated at 20, and prepending a card displaced the reading position.
- GREEN: `bun test` — 88 passed, 0 failed; `cargo test --lib` — 110 passed, 0 failed, 1 ignored external-provider test.
- `bun run check` — 0 errors/warnings; `bun run build` passed with existing chunk-size/import warnings.
- `cargo fmt --all -- --check`, strict library Clippy and `git diff --check` passed.

## Verified boundaries

Parser checks cover exclusive answer basis, selected source IDs, required fields, empty text and invalid citation markers. General references have no document citations. Existing tolerant JSON extraction remains shared with other model callers.

The frontend tests execute the page's actual handlers and scroll action with mocked IPC/geometry, including reused caption IDs during asynchronous restart, 24 retained replies, prepend, upper-card growth, return-to-latest and cleanup. They are not rendered WebKit end-to-end tests; no whole-app coverage percentage is claimed.

Model semantic grounding and relevance remain prompt-governed. Long documents use the existing bounded 24k-character context, so a general reference does not prove that an answer is absent from every page of the original files. No paid provider, live microphone, app installation, packaging or Git publication was performed. Real WebKit layout and word-position preservation within a reflowing long paragraph remain device-test items.
