# RE-SillyTavern Project Rules

## Project Overview
This is a fork of [SillyTavern](https://github.com/SillyTavern/SillyTavern) (v1.18.0), an AI character roleplay frontend.
The fork aims to refactor and improve the original project.

## Tech Stack
- **Backend**: Node.js + Express (ESM modules)
- **Frontend**: Vanilla JS + jQuery, no framework (single-page app)
- **Build**: Webpack for bundling
- **Styling**: Vanilla CSS (`public/style.css`, 150KB)
- **License**: AGPL-3.0

## Project Structure
```
re-sillytavern/
├── src/                          # Backend source
│   ├── endpoints/                # API route handlers
│   │   ├── backends/             # LLM API integrations (chat-completions, kobold, text-completions)
│   │   ├── stable-diffusion.js   # SD/ComfyUI image generation backend
│   │   └── ...                   # Other endpoints (characters, chats, settings, etc.)
│   ├── prompt-converters.js      # Prompt format conversion for different LLM APIs
│   ├── server-main.js            # Main server setup
│   └── util.js                   # Shared utilities
├── public/                       # Frontend source
│   ├── script.js                 # Main frontend logic (507KB monolith)
│   ├── index.html                # Main UI (742KB monolith)
│   ├── style.css                 # Main styles
│   └── scripts/                  # Frontend modules
│       ├── openai.js             # Chat completion frontend (306KB)
│       ├── PromptManager.js      # Prompt ordering and management
│       ├── extensions/           # Built-in extensions
│       │   └── stable-diffusion/ # SD/ComfyUI frontend extension
│       └── ...
├── config.yaml                   # Server configuration
└── server.js                     # Entry point
```

## Refactoring Goals & Completed Features
1. **Optimize prompts** – Improve system prompts for better AI roleplay quality
2. **Optimize cache hit rate** – Restructured prompt ordering for DeepSeek's prefix-based caching. Extension prompts like Memory (Auto-Summary), Author's Note, and Vector Storage are strictly placed at `IN_CHAT` @ `Depth 0` to preserve the prefix cache of the chat history.
3. **Incremental Chunked Summary** – Rewrote `Memory` extension logic (`public/scripts/extensions/memory/index.js`) to append summaries (`[Stage X]`) natively instead of overwriting, with the summarizer LLM only reading new text since the last summary.
4. **UI Simplification & Security** – 
   - Trimmed bloated API dropdowns in `index.html` to only feature essential Chat Completions.
   - Disabled upstream `git pull` in `UpdateAndStart.bat` and `UpdateForkAndStart.bat` to prevent custom code from being overwritten.
5. **ComfyUI integration** – Connect local ComfyUI (`D:\ComfyUI_windows_portable`) for image generation in chat

## Key Conventions
- Primary LLM backend: **DeepSeek API** (official, direct)
- Local ComfyUI at: `D:\ComfyUI_windows_portable\ComfyUI`
- Proxy configured at: `http://127.0.0.1:7897`
- Server runs on port **8000**

## Development Notes
- **Prefix Caching Strategy (DeepSeek / Claude)**: Dynamic components (World Info, Author's Note, Auto-Summary) MUST be injected at `@Depth 0` or `@Depth 1`. This allows the dynamic text to be squashed into the latest User message during Post-Processing (SEMI_TOOLS/strict mode), keeping the massive Chat History completely untouched and 100% cached.
- DeepSeek cache hit stats are logged to console as `[DeepSeek Cache]` in non-streaming mode
- When modifying prompt ordering, remember DeepSeek uses byte-level prefix matching from the 0th token


## Extension UI Refactoring & SillyTavern CSS Pitfalls
Throughout the development of the enhanced **Memory (Summarize)** extension, we encountered several architectural constraints within SillyTavern's frontend:

### 1. The `data-summary-source` UI Binding
- **The Pitfall**: Elements in `settings.html` use attributes like `data-summary-source="main"` to toggle visibility based on the selected API source (managed by `switchSourceControls()` in `index.js`). When we added the new `Custom API` source, all generic settings (like update intervals and prompt templates) disappeared because they were hardcoded to `main`.
- **The Solution**: When adding a new provider or making settings universal, you must strip or update the `data-summary-source` attributes from the generic DOM elements so they remain visible across different sources.

### 2. Native Modal Scrolling (`<dialog>`)
- **The Pitfall**: Attempting to create large, scrollable modals using inline `flex`, `overflow-y: auto`, or custom `max-height` values fails miserably. SillyTavern's global CSS (like `.popup-body { overflow: hidden; height: 100%; }`) brutally overrides custom inline logic, leading to modals that clip content and refuse to scroll.
- **The Solution**: ALWAYS use SillyTavern's native popup classes for custom modals. For a wide, scrollable modal, the `<dialog>` MUST use `class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup"`. 
  - The DOM must follow this strict hierarchy:
    ```html
    <dialog class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup">
        <div class="popup-body">
            <div class="popup-header">...</div>
            <div class="popup-content"><!-- SCROLLABLE CONTENT GOES HERE --></div>
        </div>
    </dialog>
    ```


## Extension UI Refactoring & SillyTavern CSS Pitfalls
Throughout the development of the enhanced **Memory (Summarize)** extension, we encountered several architectural constraints within SillyTavern's frontend:

### 1. The `data-summary-source` UI Binding
- **The Pitfall**: Elements in `settings.html` use attributes like `data-summary-source="main"` to toggle visibility based on the selected API source (managed by `switchSourceControls()` in `index.js`). When we added the new `Custom API` source, all generic settings (like update intervals and prompt templates) disappeared because they were hardcoded to `main`.
- **The Solution**: When adding a new provider or making settings universal, you must strip or update the `data-summary-source` attributes from the generic DOM elements so they remain visible across different sources.

### 2. Native Modal Scrolling (`<dialog>`)
- **The Pitfall**: Attempting to create large, scrollable modals using inline `flex`, `overflow-y: auto`, or custom `max-height` values fails miserably. SillyTavern's global CSS (like `.popup-body { overflow: hidden; height: 100%; }`) brutally overrides custom inline logic, leading to modals that clip content and refuse to scroll.
- **The Solution**: ALWAYS use SillyTavern's native popup classes for custom modals. For a wide, scrollable modal, the `<dialog>` MUST use `class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup"`. 
  - The DOM must follow this strict hierarchy:
    ```html
    <dialog class="popup wider_dialogue_popup vertical_scrolling_dialogue_popup">
        <div class="popup-body">
            <div class="popup-header">...</div>
            <div class="popup-content"><!-- SCROLLABLE CONTENT GOES HERE --></div>
        </div>
    </dialog>
    ```

### 3. Absolute Positioning of Close Buttons
- **The Pitfall**: The native `.popup-button-close` class applies `position: absolute; right: -6px; top: -6px;`. On exceptionally wide modals (like `80vw`), this pushes the close button outside the browser's renderable viewport, making it unclickable.
- **The Solution**: Strip the `popup-button-close` class from the `x` button and place it inside `.popup-header`. Make `.popup-header` a Flex container (`display: flex; justify-content: space-between; align-items: center;`) to safely anchor the close button within the modal's safe area.

### 4. Custom API Implementation for Extensions
- We successfully decoupled the Memory extension from the Main Chat API by writing `summarizeChatCustom()`.
- This required fetching and passing dedicated parameters (`temperature`, `max_tokens`, `model`) independently of the main chat settings, proving that extensions can (and should) run autonomous LLM queries without polluting the main API configuration.

### 5. Critical Pitfalls with Extension Asset Caching
- **The Pitfall**: SillyTavern dynamically loads extension assets (like `index.js` and `settings.html`) on startup. The browser aggressively caches these static assets. When modifying the extension code, changes (such as new UI sliders or core Javascript loop logic changes) will **NOT** take effect, and the browser will silently continue executing the cached old assets. This can cause massive issues like ignoring new buffer limits (e.g. sending 1000+ messages and costing 50k tokens) and UI misalignment.
- **The Solution**: The user **MUST** perform a force reload (`Ctrl + F5` or CMD+Shift+R on macOS, or clear site data) inside their browser every time the extension's frontend code is updated. 

### 6. Node Backend Proxying for CORS Bypass
- **The Pitfall**: Direct `fetch()` calls from the browser's frontend to third-party OpenAI-compatible URLs will be blocked by CORS (Cross-Origin Resource Sharing) policies.
- **The Solution**: Proxy the requests through a backend endpoint like `/api/memory/proxy` inside `src/server-startup.js`, which uses `node-fetch` on the server-side to bypass CORS.
