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

`package.json` has no `test` script and `node_modules/.bin/eslint` may be missing (devDependencies not installed). For targeted linting without the project ESLint, use `node --check <file.js>` for syntax validation.

Extension logic tests (no browser needed):

```bash
node test-protagonist-state.mjs   # Protagonist State: DDL parsing, delta reconstruct, snapshot read
```

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

- Now ships with a `manifest.json` and loads as a native SillyTavern extension. Self-contained: does NOT depend on the SP·数据库 III plugin running.
- Reads tables from persisted snapshots in chat message tags (`msg.TavernDB_ACU_IsolatedData[isolationKey].independentData`); reconstructs delta-mode snapshots and auto-detects the isolation key.
- Writes back: `writeSnapshotToChat()` writes a checkpoint snapshot to the latest non-user message's `TavernDB_ACU_IsolatedData` and calls `saveChat()`.
- Parses `<tableEdit>` blocks from AI responses (structured `updateRow/insertRow/deleteRow` commands, not SQL) and applies them on `GENERATION_ENDED` when `autoApplyTableEdit` is on.
- UI: a native `callGenericPopup` popup with tabs for all 8 tables + Memory; cells are `contenteditable`, rows can be added/deleted. A collapsible bottom bar (`#protagonist_state_bottom_bar`) shows a compact summary. Entry point in the extension settings drawer.
- Formats all default tables (`global_state`, `protagonist_info`, `important_characters`, `protagonist_skills`, `inventory`, `quests_events`, `chronicle`, `options`).
- The source data stores each sheet's `content` as a 2D array `[headerRow, dataRow, ...]` with **Chinese** headers. The extension parses each sheet's `sourceData.ddl` to recover English column names (`parseDDLColumns`); a hardcoded `TABLE_COLUMNS` fallback covers default tables if the DDL is missing.
- Injects via `setExtensionPrompt()` at `IN_CHAT @ Depth 0` / `SYSTEM` by default. Prompt injection is truncated by per-table and total length limits; the popup shows full untruncated content.
- Exposes `window.protagonistStateExtension.{getCurrentStateText, openPopup, applyTableEdit}`. The `provideToMemory` setting gates whether Memory receives the state. Memory exposes `window.memoryExtension.{summarizeNow, getSummaryText, getSettings}` for the popup's Memory tab.
- Logic tests (no browser needed): `node test-protagonist-state.mjs` from the repo root. The harness strips ESM imports, mocks browser globals, and exercises DDL parsing, 2D-array-to-object conversion, delta apply/reconstruct, isolation-key detection, and snapshot reading.

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

### Extension Import Paths (mixed depth)

Extensions live at `public/scripts/extensions/<name>/index.js` (URL `/scripts/extensions/<name>/index.js`). Import depths differ by target location — **do not assume all imports use the same number of `../`**:

- `script.js` is at `public/script.js` (URL `/script.js`) → **3 levels up**: `../../../script.js`
- `popup.js`, `extensions.js`, `constants.js`, `utils.js` are at `public/scripts/` (URL `/scripts/...`) → **2 levels up**: `../../popup.js`, `../../extensions.js`, etc.

A wrong depth silently 404s the module import, the extension's `init()` never runs, and no UI appears (but the extension still shows up in `/api/extensions/discover`). Verify with `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000<script.js>` — 200 means the path resolves. Memory extension uses `../../../script.js` + `../../extensions.js` as the reference pattern.

### Extension `manifest.json` Is Required

A folder under `public/scripts/extensions/` is auto-discovered by `/api/extensions/discover` (which just `readdirSync`s the folder), but **it will not activate without a `manifest.json`** declaring `js`, `css`, `hooks.activate`, etc. An extension folder without a manifest is silently skipped. If an extension's settings never appear in the UI and `extension_settings.<name>` is never created, check that the manifest exists and the `init` export matches `hooks.activate`.

### Verifying Runtime Assumptions About Third-Party Plugins

Do not assume a bundled third-party plugin (e.g., the SP·数据库 III body at `数据库参考/index.js`) is actually running. Its file being present in the repo does NOT mean it is loaded in the user's SillyTavern. Before relying on a global API like `window.AutoCardUpdaterAPI`, verify it exists (ask the user to run it in the browser console, or check whether the data is stale). The protagonist-state extension was initially written assuming the live API existed; in reality the data came from stale chat-tag snapshots and the API was never present.

### 2D Array Sheet Format with Chinese Headers

The SP·数据库 III schema stores each sheet's `content` as a 2D array `[headerRow, dataRow1, ...]` where `content[0]` is the header row in **Chinese** (e.g., `["row_id", "主角当前所在地点", ...]`) and data rows are positional arrays, not objects. To get English-keyed objects, parse the sheet's `sourceData.ddl` (`CREATE TABLE` with `-- 中文注释`) to recover English column names in order (`parseDDLColumns`), then map `row[i] → englishColumns[i]`. Don't treat `rows[0]` as an object with English properties — it is the Chinese header array.

### Sheet UIDs Must Be Discovered, Not Invented

Each default table has a stable UID (e.g., `sheet_dCudvUnH` for `global_state`, `sheet_NcBlYRH5` for `important_characters`, `sheet_OptionsNew` for `options`). These are not derivable from the table name — grep them from the plugin source (`uid: "sheet_..."`) before adding to `SHEET_MAP`. Invented UIDs silently match nothing.

### Test Harness ASI and ESM Pitfalls

When using `new Function(...)` to eval an extension's stripped source for Node-side logic tests: `return\n(async () => {...})` triggers Automatic Semicolon Insertion and the IIFE is never invoked (returns `undefined`). Write `return (async () => {...})()` with no newline between `return` and `(`. Also, `.mjs` files cannot use `require()` — use ESM `import` (a `require('fs')` in a `.mjs` throws `ERR_AMBIGUOUS_MODULE_SYNTAX`).
