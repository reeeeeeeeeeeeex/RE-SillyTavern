import os

file_path = ".agents/AGENTS.md"
with open(file_path, "a", encoding="utf-8") as f:
    f.write("\n\n## Extension UI Refactoring & SillyTavern CSS Pitfalls\n")
    f.write("Throughout the development of the enhanced **Memory (Summarize)** extension, we encountered several architectural constraints within SillyTavern's frontend:\n\n")
    
    f.write("### 1. The `data-summary-source` UI Binding\n")
    f.write("- **The Pitfall**: Elements in `settings.html` use attributes like `data-summary-source=\"main\"` to toggle visibility based on the selected API source (managed by `switchSourceControls()` in `index.js`). When we added the new `Custom API` source, all generic settings (like update intervals and prompt templates) disappeared because they were hardcoded to `main`.\n")
    f.write("- **The Solution**: When adding a new provider or making settings universal, you must strip or update the `data-summary-source` attributes from the generic DOM elements so they remain visible across different sources.\n\n")
    
    f.write("### 2. Native Modal Scrolling (`<dialog>`)\n")
    f.write("- **The Pitfall**: Attempting to create large, scrollable modals using inline `flex`, `overflow-y: auto`, or custom `max-height` values fails miserably. SillyTavern's global CSS (like `.popup-body { overflow: hidden; height: 100%; }`) brutally overrides custom inline logic, leading to modals that clip content and refuse to scroll.\n")
    f.write("- **The Solution**: ALWAYS use SillyTavern's native popup classes for custom modals. For a wide, scrollable modal, the `<dialog>` MUST use `class=\"popup wider_dialogue_popup vertical_scrolling_dialogue_popup\"`. \n")
    f.write("  - The DOM must follow this strict hierarchy:\n")
    f.write("    ```html\n")
    f.write("    <dialog class=\"popup wider_dialogue_popup vertical_scrolling_dialogue_popup\">\n")
    f.write("        <div class=\"popup-body\">\n")
    f.write("            <div class=\"popup-header\">...</div>\n")
    f.write("            <div class=\"popup-content\"><!-- SCROLLABLE CONTENT GOES HERE --></div>\n")
    f.write("        </div>\n")
    f.write("    </dialog>\n")
    f.write("    ```\n\n")

    f.write("### 3. Absolute Positioning of Close Buttons\n")
    f.write("- **The Pitfall**: The native `.popup-button-close` class applies `position: absolute; right: -6px; top: -6px;`. On exceptionally wide modals (like `80vw`), this pushes the close button outside the browser's renderable viewport, making it unclickable.\n")
    f.write("- **The Solution**: Strip the `popup-button-close` class from the `x` button and place it inside `.popup-header`. Make `.popup-header` a Flex container (`display: flex; justify-content: space-between; align-items: center;`) to safely anchor the close button within the modal's safe area.\n\n")

    f.write("### 4. Custom API Implementation for Extensions\n")
    f.write("- We successfully decoupled the Memory extension from the Main Chat API by writing `summarizeChatCustom()`.\n")
    f.write("- This required fetching and passing dedicated parameters (`temperature`, `max_tokens`, `model`) independently of the main chat settings, proving that extensions can (and should) run autonomous LLM queries without polluting the main API configuration.\n")

print("AGENTS.md updated successfully.")
