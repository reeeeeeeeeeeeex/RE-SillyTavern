const ELIGIBLE_GENERATION_TYPES = new Set(['normal', 'swipe', 'regenerate']);
const ANCHOR_PREFIX = '以下是用户本轮输入：\n“';

/**
 * Return the latest real user-authored chat text before prompt-only processing.
 * @param {object[]} chat Chat messages before extension injections.
 * @returns {string}
 */
export function getLatestRawUserInput(chat) {
    if (!Array.isArray(chat)) return '';
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        if (message?.is_user && typeof message.mes === 'string' && message.mes.trim()) {
            return message.mes;
        }
    }
    return '';
}

/**
 * Format a high-salience copy of the current user turn.
 * @param {string} input Raw user-authored text.
 * @returns {string}
 */
export function formatLatestUserInputAnchor(input) {
    return `${ANCHOR_PREFIX}${String(input ?? '')}”`;
}

/**
 * Restrict the anchor to foreground roleplay generations. This helper is used
 * by the Chat Completion prompt builder, so every supported chat provider gets
 * the same final User anchor while background extension requests remain out.
 * @param {object} options Anchor eligibility inputs.
 * @param {string} options.type Generation type.
 * @param {string} options.latestUserInput Raw user-authored text.
 * @returns {boolean}
 */
export function shouldAddLatestUserInputAnchor({ type, latestUserInput }) {
    return ELIGIBLE_GENERATION_TYPES.has(type)
        && typeof latestUserInput === 'string'
        && Boolean(latestUserInput.trim());
}

/**
 * Decide whether the current turn can safely be duplicated at the prompt tail.
 * Media stays on the original user message so image/file context is never
 * displaced by a text-only duplicate anchor.
 * @param {object} options Budget and media inputs.
 * @param {boolean} options.hasMedia Whether the latest User message has media.
 * @param {boolean} options.canFit Whether both the source text and anchor fit.
 * @returns {boolean}
 */
export function shouldDuplicateLatestUserInputAnchor({ hasMedia, canFit }) {
    return !hasMedia && canFit;
}

/**
 * Budget fallback: label the existing latest User message instead of duplicating it.
 * This mutates only the transient API message array.
 * @param {object[]} messages Prepared reverse-chronological chat history before depth injections.
 * @returns {boolean} Whether a message was wrapped.
 */
export function wrapLatestUserMessageWithAnchor(messages) {
    if (!Array.isArray(messages)) return false;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message?.role !== 'user' || typeof message.content !== 'string' || !message.content.trim()) continue;
        if (message.content.startsWith(ANCHOR_PREFIX)) return true;
        message.content = formatLatestUserInputAnchor(message.content);
        return true;
    }
    return false;
}
