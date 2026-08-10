export const AUTO_BACKGROUND_MODES = Object.freeze({
    SCENE: 'scene',
    INTERVAL: 'interval',
    MANUAL: 'manual',
});

export const AUTO_BACKGROUND_MARKER_KEY = 'auto_background_generated';
export const AUTO_BACKGROUND_MESSAGE_KEY = 'auto_background';

/**
 * Normalizes an optional chat message id. Manual generation deliberately
 * passes null so the caller can search backwards for the latest narrative
 * Assistant reply; Number(null) must not turn that sentinel into message 0.
 * @param {unknown} messageId Optional message id from an event
 * @returns {number} A non-negative integer id, or -1 when no id was supplied
 */
export function normalizeAutoBackgroundMessageId(messageId) {
    if (messageId === null || messageId === undefined) return -1;
    if (typeof messageId === 'string' && !messageId.trim()) return -1;

    const index = Number(messageId);
    return Number.isInteger(index) && index >= 0 ? index : -1;
}

/**
 * Determines whether a chat message is a real narrative Assistant reply.
 * Generated background media messages are deliberately excluded.
 * @param {object} message Chat message
 * @returns {boolean}
 */
export function isNarrativeAssistantMessage(message) {
    return Boolean(message
        && !message.is_user
        && !message.is_system
        && !message.extra?.[AUTO_BACKGROUND_MESSAGE_KEY]
        && String(message.mes || '').trim());
}

/**
 * Returns the latest successful automatic-background marker.
 * @param {object[]} chat Chat messages
 * @returns {{index: number, marker: object}|null}
 */
export function findLastAutoBackgroundMarker(chat) {
    for (let index = (chat?.length || 0) - 1; index >= 0; index--) {
        const marker = chat[index]?.extra?.[AUTO_BACKGROUND_MARKER_KEY];
        if (marker && typeof marker === 'object') {
            return { index, marker };
        }
    }
    return null;
}

/**
 * Counts narrative Assistant replies since the last successful background.
 * @param {object[]} chat Chat messages
 * @param {number} [throughIndex] Inclusive upper bound
 * @returns {number}
 */
export function getAssistantTurnsSinceLastAutoBackground(chat, throughIndex = (chat?.length || 1) - 1) {
    const messages = Array.isArray(chat) ? chat : [];
    let count = 0;
    for (let index = Math.min(throughIndex, messages.length - 1); index >= 0; index--) {
        if (messages[index]?.extra?.[AUTO_BACKGROUND_MARKER_KEY]) {
            break;
        }
        if (isNarrativeAssistantMessage(messages[index])) {
            count++;
        }
    }
    return count;
}

/**
 * Gets the latest Stage block from cumulative Memory text. Falls back to a
 * bounded tail when the text does not contain Stage markers.
 * @param {string} memoryText Memory Summary text
 * @param {number} [fallbackLimit] Maximum fallback characters
 * @returns {string}
 */
export function extractLatestMemoryStage(memoryText, fallbackLimit = 6000) {
    const text = String(memoryText || '').trim();
    if (!text) return '';

    const stagePattern = /\[Stage\s+\d+\][\s\S]*?(?=\n\s*\[Stage\s+\d+\]|$)/gi;
    const matches = [...text.matchAll(stagePattern)];
    if (matches.length) {
        return String(matches.at(-1)[0]).trim();
    }

    const limit = Math.max(1, Number(fallbackLimit) || 6000);
    return text.length > limit ? text.slice(-limit) : text;
}

/**
 * Normalizes a scene key so harmless whitespace/case differences do not cause
 * duplicate generations.
 * @param {string} value Scene key
 * @returns {string}
 */
export function normalizeSceneKey(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
}

/**
 * Parses the strict JSON returned by the scene analyzer.
 * @param {string} response Raw LLM response
 * @returns {{sceneKey: string, prompt: string}}
 */
export function parseSceneAnalysisResponse(response) {
    let text = String(response || '').trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
        throw new Error('Scene analysis did not return a JSON object.');
    }

    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch (error) {
        throw new Error(`Scene analysis returned invalid JSON: ${error.message}`);
    }

    const sceneKey = normalizeSceneKey(parsed.scene_key ?? parsed.sceneKey);
    const prompt = String(parsed.prompt || '').trim();
    if (!sceneKey) throw new Error('Scene analysis returned an empty scene_key.');
    if (!prompt) throw new Error('Scene analysis returned an empty prompt.');
    return { sceneKey, prompt };
}

/**
 * Builds the quiet Main API request that extracts a stable scene identity and
 * an English background-only image prompt.
 * @param {object} data Prompt inputs
 * @param {string} data.userMessage Latest user-authored input
 * @param {string} data.assistantMessage Latest Assistant narrative reply
 * @param {string} [data.timelineContext] Protagonist State time/location
 * @param {string} [data.memoryStage] Latest Memory Stage
 * @param {string} [data.previousSceneKey] Last successfully generated scene
 * @returns {string}
 */
export function buildAutoBackgroundAnalysisPrompt({
    userMessage,
    assistantMessage,
    timelineContext = '',
    memoryStage = '',
    previousSceneKey = '',
}) {
    return `You extract the currently visible environment from an interactive novel for a background-only image generator.

Return exactly one JSON object and no Markdown or commentary:
{"scene_key":"stable concise scene identity","prompt":"English comma-separated visual background prompt"}

Rules:
- Treat the latest Assistant narrative as the primary source of current visual truth. The other sections are supporting context only and must not override an explicit transition in the latest reply.
- scene_key identifies the visible environment, including location, indoor/outdoor area, meaningful time-of-day, weather, and major lighting state. Keep it exactly stable for ordinary dialogue or action in the same environment. Change it only for a real visual scene transition.
- prompt must be English, comma-separated, and describe only the environment: location, time of day, weather, lighting, architecture, terrain, furnishings, atmosphere, camera framing, and relevant persistent visual details.
- Do not describe people, characters, bodies, clothing, actions, dialogue, names, personality, thoughts, or non-visual facts.
- Do not invent a precise time, weather, architecture, or location that the supplied context does not establish. Use visually neutral wording when uncertain.

[Previous generated scene key]
${String(previousSceneKey || 'none')}

[Protagonist State timeline context]
${String(timelineContext || 'not available')}

[Latest Memory Stage]
${String(memoryStage || 'not available')}

[Latest User input]
${String(userMessage || 'not available')}

[Latest Assistant narrative]
${String(assistantMessage || '')}`;
}
