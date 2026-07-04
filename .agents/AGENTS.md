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
