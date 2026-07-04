# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This is a fork of [SillyTavern](https://github.com/SillyTavern/SillyTavern) (v1.18.0), an AI character roleplay frontend.

- **License:** AGPL-3.0
- **Upstream docs:** <https://docs.sillytavern.app/>
- **Node:** >= 20

## Common Commands

Run the server locally:

```bash
npm start
# or
node server.js
```

Other useful scripts from `package.json`:

```bash
npm run start:no-csrf    # Disable CSRF protection for local testing
npm run debug            # Node inspector mode
npm run lint             # ESLint on src/, public/, and root JS files
npm run lint:fix         # Auto-fix ESLint issues
npm run init             # Run server initialization wizard
npm run plugins:install  # Install SillyTavern plugins
npm run plugins:update   # Update SillyTavern plugins
```

There is **no test suite** in this fork; `package.json` has no `test` script.

## Architecture Overview

### Backend

- Node.js + Express, ESM modules (`"type": "module"`).
- Entry point: `server.js`.
- Route setup and middleware wiring: `src/server-main.js`.
- LLM API routing: `src/endpoints/backends/chat-completions.js`, `src/endpoints/backends/kobold.js`, `src/endpoints/backends/text-completions.js`.
- Prompt format conversion for different APIs: `src/prompt-converters.js`.
- Shared utilities: `src/util.js`.

### Frontend

- Single-page app using vanilla JS + jQuery. No React/Vue (except third-party extensions).
- Main app logic: `public/script.js`.
- Chat-completion prompt assembly: `public/scripts/openai.js`.
- Prompt ordering/management: `public/scripts/PromptManager.js`.
- Built-in extensions live under `public/scripts/extensions/`; each has an `index.js` and optional `settings.html`.
- Webpack bundles frontend libraries; static assets are served from `public/`.

### Prompt Assembly Flow

1. `public/script.js` `Generate()` builds `coreChat` and runs extension interceptors.
2. Stable content (main prompt, character card, scenario, persona, fixed WI) is assembled first.
3. Dynamic extension prompts (Memory, Author's Note, Vector Storage, Protagonist State, depth-positioned WI) are injected at configured depths via `setExtensionPrompt()`.
4. For Chat Completion APIs, `public/scripts/openai.js` `populationInjectionPrompts()` inserts `IN_CHAT` prompts into the message array.
5. For Text Completion APIs, `public/script.js` `doChatInject()` does the same.

## Key Conventions

- Primary LLM backend: **DeepSeek API** (official, direct).
- Local ComfyUI: `D:\ComfyUI_windows_portable\ComfyUI`.
- Proxy: `http://127.0.0.1:7897`.
- Server port: **8000**.

### Prefix-Cache Optimization

This fork optimizes for DeepSeek/Claude prefix-based caching:

- Dynamic components (World Info, Author's Note, Auto-Summary / Memory, Vector Storage, Protagonist State) MUST be injected at `IN_CHAT` with `@Depth 0` or `@Depth 1`.
- Keeping them at the end of the chat-history block preserves the long, stable prefix (system prompt + character info + chat history).
- DeepSeek cache-hit stats are logged to the server console as `[DeepSeek Cache]` in non-streaming mode.
- World Info entries default to `atDepth` with `depth = 0`; Memory, Author's Note, Vector Storage, and Protagonist State also default to `IN_CHAT @ Depth 0`.

## Custom Extensions and Behaviors

### Memory (Summarize) Extension

Location: `public/scripts/extensions/memory/`

- **Prompt builder:** Both Main API and Custom API use the same cumulative chunking loop (`getRawSummaryPrompt`).
- **Custom API:** Routes through the shared backend at `/api/backends/chat-completions/generate`. Model fetching uses `/api/backends/chat-completions/status`.
- **Cumulative stages:** Each batch appends a new `[Stage N]` to the memory text. Later stages do **not** replace earlier stages.
- **Ranges:**
  - `manualSummarizeRange`: fixed lookback for manual "Summarize now".
  - `autoSummarizeRange`: fixed lookback for automatic summaries (interval/word-based).
  - `0` for either means "since the latest summary marker".
- **Live textbox:** The summary injected into prompts and the summary context sent during summarization both follow the live `#memory_contents` value. If the textbox is empty, no previous summary is sent.
- **Summary marker:** `mes.extra.memory` stores the summary on a chat message. Empty string (`''`) is treated as a valid marker position so clearing the textbox does not reset summarization state.
- **Context injection:** The summary system prompt includes World Info / Author's Note, and optionally the protagonist state from the `protagonist-state` extension.

### Protagonist State Extension

Location: `public/scripts/extensions/protagonist-state/`

- Reads the SP·数据库 III (database reference) plugin's persisted snapshots from chat message tags: `msg.TavernDB_ACU_IsolatedData[isolationKey].independentData`.
- Formats selected tables (`global_state`, `protagonist_info`, `protagonist_skills`, `inventory`, `quests_events`, `chronicle`) into a prompt block.
- Injects via `setExtensionPrompt()` at `IN_CHAT @ Depth 0` by default.
- Exposes `window.protagonistStateExtension.getCurrentStateText()` for other extensions (e.g., Memory summary context).

### SP·数据库 III (Database Reference) Plugin

Location: `数据库参考/index.js` (third-party bundled userscript/extension).

- Stores an in-memory SQLite database; persistence is saved into chat message tags (`TavernDB_ACU_IsolatedData`).
- Already injects readable data via World Info entries and direct prompt mutation on `CHAT_COMPLETION_SETTINGS_READY`.
- Other extensions can read the persisted snapshots from `getContext().chat` but cannot access the live SQL connection directly.

## Extension Development Pitfalls

### Extension Asset Caching

SillyTavern dynamically loads extension assets (`index.js`, `settings.html`, etc.) and the browser caches them aggressively. **After modifying extension frontend code, force-reload the browser (`Ctrl + F5`) or clear site data.** Otherwise the browser silently runs stale code, which can cause issues like ignoring new buffer limits or broken UI.

### Modal DOM Requirements

For custom modals, use SillyTavern's native popup classes. The required structure for a wide, scrollable modal is:

```html
<dialog class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup">
    <div class="popup-body">
        <div class="popup-header">...</div>
        <div class="popup-content"><!-- scrollable content --></div>
    </div>
</dialog>
```

Do not rely on inline `overflow-y`, `max-height`, or `display: flex` for scrolling — global CSS overrides them.

### `data-summary-source` Visibility Binding

UI elements in extension `settings.html` that use `data-summary-source="main"` are toggled by `switchSourceControls()`. When adding a new source (e.g., Custom API) or making settings universal, remove or update these attributes so generic settings remain visible across sources.

### Close Buttons in Wide Modals

The `.popup-button-close` class uses `position: absolute; right: -6px; top: -6px;`, which can render off-screen on very wide modals. Move the close button inside `.popup-header` and use Flexbox (`justify-content: space-between; align-items: center;`) instead.
