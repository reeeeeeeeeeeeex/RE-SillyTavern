# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, opencode, etc.) when working with code in this repository.

## Project

This is a fork of [SillyTavern](https://github.com/SillyTavern/SillyTavern) (v1.18.0), an AI character roleplay frontend.

- **License:** AGPL-3.0
- **Upstream docs:** <https://docs.sillytavern.app/>
- **Node:** >= 20
- **Module system:** ESM (`"type": "module"` in `package.json`)

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

### Tests

**Jest tests** (backend logic, no browser needed):

```bash
cd tests && npx jest                    # Run all Jest tests
cd tests && npx jest util.test.js       # Run a specific test file
```

Jest test files live in `tests/` and cover: `util.test.js`, `prompt-converters.test.js`, `private-request-filter.test.js`, `tavern-card-validator.test.js`, `mock-server.test.js`. Config: `tests/jest.config.json` (node env, no transform). E2E tests use Playwright (`tests/playwright.config.js`, `tests/sample.e2e.js`).

**Extension logic tests** (custom harness, no browser needed):

```bash
node test-protagonist-state.mjs   # Protagonist State: DDL parsing, delta reconstruct, snapshot read
node test-memory.mjs              # Memory: timeline normalization and cumulative batches
```

The harnesses strip ESM imports, mock browser globals, and exercise pure logic functions via `new Function()` eval.

## Architecture Overview

### Backend

- Node.js + Express, ESM modules (`"type": "module"`).
- Entry point: `server.js` → parses CLI args (`src/command-line.js`) → imports `src/server-main.js`.
- **Server startup flow:** `server.js` → `CommandLineParser` → `server-main.js` (Express app, middleware, routes) → `preSetupTasks()` (webpack, migrations, plugins) → `server-startup.js` `setupPrivateEndpoints(app)` → listen.
- Route setup and middleware wiring: `src/server-main.js`.
- LLM API routing: `src/endpoints/backends/chat-completions.js` (OpenAI, Claude, DeepSeek, Gemini, etc.), `src/endpoints/backends/kobold.js`, `src/endpoints/backends/text-completions.js`.
- Prompt format conversion for different APIs: `src/prompt-converters.js`.
- Shared utilities: `src/util.js`.
- Constants (API sources, directories, secret keys): `src/constants.js`.
- Secrets management: `src/endpoints/secrets.js` (stores API keys per user).
- Tokenizers: `src/endpoints/tokenizers.js` (tiktoken, sentencepiece, web-tokenizers; includes DeepSeek tokenizer).
- Server-side event system: `src/server-events.js` (EventEmitter, currently only `SERVER_STARTED`).
- Endpoints directory: `src/endpoints/` (45 endpoint files covering characters, chats, assets, vectors, themes, etc.).

### Frontend

- Single-page app using vanilla JS + jQuery. No React/Vue (except third-party extensions).
- Main app logic: `public/script.js` (~12,540 lines). Core function: `Generate()` at `public/script.js:4231`.
- Chat-completion prompt assembly: `public/scripts/openai.js` (~7,252 lines).
- Prompt ordering/management: `public/scripts/PromptManager.js`.
- Text completion injection: `public/script.js` `doChatInject()` at `public/script.js:5569`.
- Chat completion injection: `public/scripts/openai.js` `populationInjectionPrompts()` at `public/scripts/openai.js:803`.
- Author's Note: `public/scripts/authors-note.js` (also uses `setExtensionPrompt`, migrated to `IN_CHAT @ Depth 0`).
- World Info: `public/scripts/world-info.js`.
- Built-in extensions live under `public/scripts/extensions/`; each has an `index.js`, `manifest.json`, and optional `settings.html` + `style.css`.
- Webpack bundles frontend libraries; static assets are served from `public/`.
- Frontend event system: `eventSource` / `event_types` (imported from `script.js`), emitted throughout `Generate()` and chat lifecycle.

### Built-in Extensions

Location: `public/scripts/extensions/`

| Extension | Folder | Notes |
|-----------|--------|-------|
| Memory (Summarize) | `memory/` | Custom fork, see below |
| Protagonist State | `protagonist-state/` | Custom fork, see below |
| Vector Storage | `vectors/` | Defaults to `IN_CHAT @ Depth 0` |
| Author's Note | (core script `authors-note.js`) | Defaults to `IN_CHAT @ Depth 0` |
| Expressions | `expressions/` | |
| Caption | `caption/` | |
| Gallery | `gallery/` | |
| Quick Reply | `quick-reply/` | |
| Regex | `regex/` | |
| Stable Diffusion | `stable-diffusion/` | |
| TTS | `tts/` | |
| Translate | `translate/` | |
| Token Counter | `token-counter/` | |
| Attachments | `attachments/` | |
| Assets | `assets/` | |
| Connection Manager | `connection-manager/` | |

### Third-Party Extensions

Location: `public/scripts/extensions/third-party/`

- **JS-Slash-Runner (酒馆助手):** `third-party/JS-Slash-Runner/` — a Vite-built TypeScript extension (v4.8.17). Provides sandboxed JS execution, slash command enhancements, and various UI tools. Has its own `package.json`, `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`. Compiled output in `dist/`. GitHub: <https://github.com/N0VI028/JS-Slash-Runner>.

### Prompt Assembly Flow

1. `public/script.js` `Generate()` (line 4231) builds `coreChat` and runs extension interceptors.
2. Stable content (main prompt, character card, scenario, persona, fixed WI) is assembled first.
3. Dynamic extension prompts (Memory, Author's Note, Vector Storage, Protagonist State, depth-positioned WI) are injected at configured depths via `setExtensionPrompt()`.
4. For Chat Completion APIs, `public/scripts/openai.js` `populationInjectionPrompts()` (line 803) inserts `IN_CHAT` prompts into the message array at each depth, grouped by role (system → user → assistant).
5. For Text Completion APIs, `public/script.js` `doChatInject()` (line 5569) does the same, splicing messages into the reversed array.
6. Final prompt is sent to the backend via `/api/backends/chat-completions/generate` (Chat) or `/api/backends/text-completions/generate` (Text).

## Key Conventions

- Primary LLM backend: **DeepSeek API** (official, direct). API URL: `https://api.deepseek.com/beta` (`src/endpoints/backends/chat-completions.js:82`). Supports tools, JSON schema (via prompt injection hack), and logs cache stats.
- Local ComfyUI: `D:\ComfyUI_windows_portable\ComfyUI`.
- Proxy: `http://127.0.0.1:7897`.
- Server port: **8000** (configured in `config.yaml`).
- Config file: `config.yaml` (root). Key settings: `port`, `listen`, `whitelistMode`, `disableCsrfProtection`, `claude.enableSystemPromptCache`, `claude.cachingAtDepth`, `claude.extendedTTL`, `extensions.enabled`, `extensions.autoUpdate`.
- No user accounts by default (`enableUserAccounts: false` in `config.yaml`). Single-user mode with `default-user`.

### Prefix-Cache Optimization

This fork optimizes for DeepSeek/Claude prefix-based caching:

- Dynamic components (World Info, Author's Note, Auto-Summary / Memory, Vector Storage, Protagonist State) MUST be injected at `IN_CHAT` with `@Depth 0` or `@Depth 1`.
- Keeping them at the end of the chat-history block preserves the long, stable prefix (system prompt + character info + chat history).
- DeepSeek cache-hit stats are logged to the server console as `[DeepSeek Cache]` in non-streaming mode (`src/endpoints/backends/chat-completions.js:1127`).
- World Info entries default to `atDepth` with `depth = 0`; Memory, Author's Note, Vector Storage, and Protagonist State also default to `IN_CHAT @ Depth 0`.
- **Forced migration:** Memory (`memory/index.js:164`) and Author's Note (`authors-note.js:300`) both force-migrate from `IN_PROMPT` to `IN_CHAT @ Depth 0` on load.
- Memory role defaults and is one-time migrated to `ASSISTANT`, because a DeepSeek mid-chat System injection is recast as User. This preserves a separate dynamic role without moving Memory ahead of the cacheable history prefix.
- **DeepSeek role limitation:** `sendDeepSeekRequest()` always applies `PROMPT_PROCESSING_TYPE.SEMI_TOOLS`. Its strict message merger converts every `system` message except the first one into `user`. Therefore an `IN_CHAT` prompt configured as System at any chat depth reaches the final DeepSeek payload as `user`; Assistant remains Assistant. This is backend behavior, not a stale extension setting.
- **Custom prompt post-processing:** For the native DeepSeek source, keep `custom_prompt_post_processing` at `None`. DeepSeek already performs its own `SEMI_TOOLS` compatibility pass. The UI's Strict variants add a second role-reordering pass, including User placeholders, which can merge dynamic World Info/Summary content into User context. “With Tools” only preserves tool messages during that optional pass; it does not enable or disable function calling.

## Custom Extensions and Behaviors

### Memory (Summarize) Extension

Location: `public/scripts/extensions/memory/`

- **Prompt builder:** Both Main API and Custom API use the same cumulative chunking loop (`getRawSummaryPrompt`).
- **Custom API:** Routes through the shared backend at `/api/backends/chat-completions/generate`. Model fetching uses `/api/backends/chat-completions/status`. Custom API assumes 128K context (`memory/index.js:58`).
- **Cumulative stages:** Each batch appends a new `[Stage N]` to the memory text. Later stages do **not** replace earlier stages.
- **Timeline Chronicle Mode:** Enabled by default (`timelineMode`). Each new `[Stage N]` contains one record with time span, location, an objective chronicle, up to three important dialogue entries, and a ≤40-character overview. It never emits an AM code. `promptWords` controls only the Chronicle field's target Chinese-character count (±20%); the other fields do not consume that allowance.
- **Batch behavior:** The cumulative loop keeps its initial window start and expands the end each batch (for example `1–10`, then `1–20` plus previous Memory), preserving the cache-friendly full cumulative context strategy.
- **Ranges:**
  - `manualSummarizeRange`: fixed lookback for manual "Summarize now".
  - `autoSummarizeRange`: fixed lookback for automatic summaries (interval/word-based).
  - `0` for either means "since the latest summary marker".
- **Automatic frequency:** `promptInterval` counts assistant replies (rounds) since the latest Summary marker, not all chat messages. The extension checks both `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED`; a pending guard prevents duplicate requests. A non-zero word interval can trigger independently even when the round interval is `0`. `#memory_auto_summary_status` displays the live counter/paused/request state, and automatic request failures show a toast.
- **Live textbox:** The summary injected into prompts and the summary context sent during summarization both follow the live `#memory_contents` value. If the textbox is empty, no previous summary is sent.
- **Summary marker:** `mes.extra.memory` stores the summary on a chat message. Empty string (`''`) is treated as a valid marker position so clearing the textbox does not reset summarization state.
- **Context injection:** The summary system prompt includes World Info / Author's Note, optional protagonist state, and in Timeline Chronicle Mode the current time/location fields from `window.protagonistStateExtension.getTimelineContext()`.
- **Summary UI:** The extension drawer provides only quick actions. The editable Summary and all generation, prompt, frequency, injection, and Custom API settings live in `#memory_manager_popup`, a draggable large panel with sidebar navigation. The same panel is available from the lower-left Extensions (magic-wand) menu via `#memory_wand_item`.
- **External API:** Exposes `window.memoryExtension.{summarizeNow, getSummaryText, getSettings}` at `memory/index.js:1375` for the Protagonist State popup's Memory tab.

### Protagonist State Extension

Location: `public/scripts/extensions/protagonist-state/`

- Ships with a `manifest.json` (v1.1.0, loading_order 10) and loads as a native SillyTavern extension. Self-contained: does NOT depend on the SP·数据库 III plugin running.
- Reads tables from persisted snapshots in chat message tags (`msg.TavernDB_ACU_IsolatedData[isolationKey].independentData`); reconstructs delta-mode snapshots and auto-detects the isolation key.
- Writes back: `writeSnapshotToChat()` writes a checkpoint snapshot to the latest non-user message's `TavernDB_ACU_IsolatedData` and calls `saveChat()`.
- Parses `<tableEdit>` blocks from its dedicated update API (structured `updateRow/insertRow/deleteRow` commands, not SQL) and can update manually or at the configured AI-response interval.
- UI: a large draggable two-column popup with a sidebar and continuous editable record cards for all active tables + Memory. A collapsible bottom bar (`#protagonist_state_bottom_bar`) shows selected-table summaries.
- Formats seven active tables (`global_state`, `protagonist_info`, `important_characters`, `protagonist_skills`, `inventory`, `quests_events`, `options`). Legacy `sheet_3NoMc1wI` chronicle data is deliberately hidden and excluded from prompt/API updates, but preserved unchanged whenever another table is checkpoint-saved.
- The source data stores each sheet's `content` as a 2D array `[headerRow, dataRow, ...]` with **Chinese** headers. The extension parses each sheet's `sourceData.ddl` to recover English column names (`parseDDLColumns`); a hardcoded `TABLE_COLUMNS` fallback covers default tables if the DDL is missing.
- Injects via `setExtensionPrompt()` at `IN_CHAT @ Depth 0` / `SYSTEM` by default. Every selected table is injected in full; no injection-time ellipsis or per-table word cap is applied. The bottom-bar's collapsed preview remains compact only for display.
- Exposes `window.protagonistStateExtension.{getCurrentStateText, getTimelineContext, getLastSnapshot, getSettings, openPopup, applyTableEdit}`. `getTimelineContext` always reads global time/location independently of display-table choices. The `provideToMemory` setting gates full state injection; Memory exposes `window.memoryExtension.{summarizeNow, getSummaryText, getSettings}` for the popup's Memory tab.
- Logic tests (no browser needed): `node test-protagonist-state.mjs` from the repo root. The harness strips ESM imports, mocks browser globals, and exercises DDL parsing, 2D-array-to-object conversion, delta apply/reconstruct, isolation-key detection, and snapshot reading.

### SP·数据库 III (Database Reference) Plugin

Location: `数据库参考/index.js` (third-party bundled userscript/extension).

- The `数据库参考/` directory also contains JSON files: the main database body (`【最新版号看标题】数据库本体.json`), UI beautification regex (`【6.12】数据库多功能美化正则1.json`), WI recall regex (`SP+星河璀璨数据库召回配套正则2.json`), hidden-message JSON, and a visual frontend config (`可视化前端-V13.50 (1).json`).
- Stores an in-memory SQLite database; persistence is saved into chat message tags (`TavernDB_ACU_IsolatedData`).
- Already injects readable data via World Info entries and direct prompt mutation on `CHAT_COMPLETION_SETTINGS_READY`.
- Other extensions can read the persisted snapshots from `getContext().chat` but cannot access the live SQL connection directly.
- New default templates no longer create a `chronicle` sheet or instruct the table-filling prompt to write one. Existing chronicle sheets are hidden from active sorting, prompt assembly, and visualization, while their raw data is carried through checkpoint/reorder operations unchanged.

## Repository Helper Scripts

- `append_agents.py` — Appends content to AGENTS.md (utility for maintaining this file).
- `recover.js` — Password recovery utility (`src/recover-password.js` is the actual implementation).
- `normalize_line_endings.py` — Normalizes line endings across the repo.
- `plugins.js` — Plugin manager CLI entry point (delegates to `src/plugin-loader.js`).

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

Do not rely on inline `overflow-y`, `max-height`, or `display: flex` for scrolling - global CSS overrides them.

### `data-summary-source` Visibility Binding

UI elements in extension `settings.html` that use `data-summary-source="main"` are toggled by `switchSourceControls()` (`memory/index.js:307`). When adding a new source (e.g., Custom API) or making settings universal, remove or update these attributes so generic settings remain visible across sources.

### Close Buttons in Wide Modals

The `.popup-button-close` class uses `position: absolute; right: -6px; top: -6px;`, which can render off-screen on very wide modals. Move the close button inside `.popup-header` and use Flexbox (`justify-content: space-between; align-items: center;`) instead.

### Extension Import Paths (mixed depth)

Extensions live at `public/scripts/extensions/<name>/index.js` (URL `/scripts/extensions/<name>/index.js`). Import depths differ by target location - **do not assume all imports use the same number of `../`**:

- `script.js` is at `public/script.js` (URL `/script.js`) -> **3 levels up**: `../../../script.js`
- `popup.js`, `extensions.js`, `constants.js`, `utils.js` are at `public/scripts/` (URL `/scripts/...`) -> **2 levels up**: `../../popup.js`, `../../extensions.js`, etc.

A wrong depth silently 404s the module import, the extension's `init()` never runs, and no UI appears (but the extension still shows up in `/api/extensions/discover`). Verify with `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000<script.js>` - 200 means the path resolves. Memory extension uses `../../../script.js` + `../../extensions.js` as the reference pattern.

### Extension `manifest.json` Is Required

A folder under `public/scripts/extensions/` is auto-discovered by `/api/extensions/discover` (which just `readdirSync`s the folder), but **it will not activate without a `manifest.json`** declaring `js`, `css`, `hooks.activate`, etc. An extension folder without a manifest is silently skipped. If an extension's settings never appear in the UI and `extension_settings.<name>` is never created, check that the manifest exists and the `init` export matches `hooks.activate`.

### Verifying Runtime Assumptions About Third-Party Plugins

Do not assume a bundled third-party plugin (e.g., the SP·数据库 III body at `数据库参考/index.js`) is actually running. Its file being present in the repo does NOT mean it is loaded in the user's SillyTavern. Before relying on a global API like `window.AutoCardUpdaterAPI`, verify it exists (ask the user to run it in the browser console, or check whether the data is stale). The protagonist-state extension was initially written assuming the live API existed; in reality the data came from stale chat-tag snapshots and the API was never present.

### 2D Array Sheet Format with Chinese Headers

The SP·数据库 III schema stores each sheet's `content` as a 2D array `[headerRow, dataRow1, ...]` where `content[0]` is the header row in **Chinese** (e.g., `["row_id", "主角当前所在地点", ...]`) and data rows are positional arrays, not objects. To get English-keyed objects, parse the sheet's `sourceData.ddl` (`CREATE TABLE` with `-- 中文注释`) to recover English column names in order (`parseDDLColumns`), then map `row[i] -> englishColumns[i]`. Don't treat `rows[0]` as an object with English properties - it is the Chinese header array.

### Sheet UIDs Must Be Discovered, Not Invented

Each default table has a stable UID (e.g., `sheet_dCudvUnH` for `global_state`, `sheet_NcBlYRH5` for `important_characters`, `sheet_OptionsNew` for `options`). These are not derivable from the table name - grep them from the plugin source (`uid: "sheet_..."`) before adding to `SHEET_MAP`. Invented UIDs silently match nothing. The full current mapping is in `protagonist-state/index.js:16-25`.

### Test Harness ASI and ESM Pitfalls

When using `new Function(...)` to eval an extension's stripped source for Node-side logic tests: `return\n(async () => {...})` triggers Automatic Semicolon Insertion and the IIFE is never invoked (returns `undefined`). Write `return (async () => {...})()` with no newline between `return` and `(`. Also, `.mjs` files cannot use `require()` - use ESM `import` (a `require('fs')` in a `.mjs` throws `ERR_AMBIGUOUS_MODULE_SYNTAX`).

### `#sheld` Flex Layout Compresses Injected Elements

`#sheld` is `display: flex; flex-direction: column;`. The `#chat` element has `flex-grow: 1` and will expand to fill all remaining vertical space. Any element inserted between `#chat` and `#form_sheld` (e.g., the protagonist-state bottom bar via `$anchor.before($bar)`) becomes a flex child **without `flex-shrink: 0`**, so `#chat`'s `flex-grow: 1` compresses it to height 0. This is silent: the element exists in the DOM but is visually invisible (especially with `overflow: hidden`). Always add `flex-shrink: 0` to any element injected into `#sheld` between `#chat` and `#form_sheld`.
