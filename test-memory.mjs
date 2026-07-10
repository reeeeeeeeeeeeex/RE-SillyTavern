// Focused logic tests for the enhanced Memory timeline format.
import fs from 'fs';
import path from 'path';
import assert from 'assert';

const sourcePath = path.resolve('public/scripts/extensions/memory/index.js');
let code = fs.readFileSync(sourcePath, 'utf8');
code = code.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
code = code.replace(/export\s+\{\s*MODULE_NAME\s*\};?/, '');
code = code.replace(/export\s+async\s+function\s+init/, 'async function init');
code = code.replace(/extension_prompt_types\.IN_CHAT/g, '1');
code = code.replace(/extension_prompt_roles\.SYSTEM/g, '0');

const mocks = {
    getStringHash: () => '', debounce: fn => fn, waitUntilCondition: async () => true,
    extractAllWords: () => [], isTrueBoolean: () => false,
    getContext: () => ({ chat: [] }), extension_settings: { memory: { timelineMode: true, source: 'main', overrideResponseLength: 0 } },
    renderExtensionTemplateAsync: async () => '', activateSendButtons: () => {}, deactivateSendButtons: () => {},
    animation_duration: 0, eventSource: { on: () => {} }, event_types: {}, extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    extension_prompt_types: { IN_CHAT: 1 }, is_send_press: false, saveSettingsDebounced: () => {}, substituteParamsExtended: value => value,
    generateRaw: async () => '', getMaxPromptTokens: () => 10000, getRequestHeaders: () => ({}), setExtensionPrompt: () => {},
    streamingProcessor: null, animation_easing: '', is_group_generating: false, selected_group: null,
    loadMovingUIState: () => ({}), power_user: {}, dragElement: () => {}, getTokenCountAsync: async text => String(text).length,
    getWorldInfoPrompt: async () => ({}), debounce_timeout: { relaxed: 0 }, SlashCommandParser: { addCommandObject: () => {} },
    SlashCommand: class {}, ARGUMENT_TYPE: {}, SlashCommandArgument: class {}, SlashCommandNamedArgument: class {}, macros: {}, MacroCategory: {},
    commonEnumProviders: {}, removeReasoningFromString: value => value, MacrosParser: { registerMacro: () => {} },
    window: { protagonistStateExtension: { getTimelineContext: () => ({ location: 'Market', currentTime: '10:00', previousTime: '09:00', elapsedTime: 'one hour' }) } },
    $: () => ({ val: () => '', prop: () => {}, trigger: () => {}, off: () => ({ on: () => {} }), on: () => {}, length: 0 }),
    toastr: { info: () => ({}), clear: () => {}, warning: () => {}, error: () => {} },
    document: { getElementById: () => ({ showModal: () => {}, close: () => {} }), body: {} }, fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
};

const wrapped = `async () => { ${code}\nreturn { getNextTimelineCode, normalizeTimelineSummary, buildTimelineSummaryContract, formatFinalSummary, getRawSummaryPrompt, defaultSettings }; }`;
const mod = await new Function(...Object.keys(mocks), `return (${wrapped})();`)(...Object.values(mocks));

let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}
async function testAsync(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== Memory timeline ===');
test('defaults Memory injection to Assistant so DeepSeek does not recast it as User', () => {
    assert.strictEqual(mod.defaultSettings.role, 2);
});

test('starts AM numbering at AM0001 and continues from the highest existing code', () => {
    assert.strictEqual(mod.getNextTimelineCode(''), 'AM0001');
    assert.strictEqual(mod.getNextTimelineCode('[AM0002]\n[AM0011]\nAM0007'), 'AM0012');
});

test('normalizes a missing or incorrect AM code to the next code', () => {
    const existing = '[Stage 1]: [AM0004]';
    assert.ok(mod.normalizeTimelineSummary('纪要：新的事件', existing).startsWith('[AM0005]'));
    assert.ok(mod.normalizeTimelineSummary('[AM0999]\n纪要：新的事件', existing).startsWith('[AM0005]'));
    assert.ok(mod.normalizeTimelineSummary('AM0999\n纪要：新的事件', existing).startsWith('[AM0005]'));
});

test('removes prohibited planner and table-edit wrappers without losing a content-wrapped timeline response', () => {
    const value = mod.normalizeTimelineSummary('<thought>plan</thought>\n<tableEdit>insertRow()</tableEdit>\n<content>[AM0001]\n纪要：事件</content>', '');
    assert.ok(!value.includes('<thought>'));
    assert.ok(!value.includes('<tableEdit>'));
    assert.ok(value.startsWith('[AM0001]'));
    assert.ok(value.includes('纪要：事件'));
});

test('builds the timeline contract with the required fields and state metadata', () => {
    const prompt = mod.buildTimelineSummaryContract('[AM0003]');
    assert.ok(prompt.includes('AM0004'));
    assert.ok(prompt.includes('300-400 Chinese characters'));
    assert.ok(prompt.includes('重要对话'));
    assert.ok(prompt.includes('Location: Market'));
    assert.ok(prompt.includes('Time: 10:00'));
});

test('keeps the existing Stage wrapper around each timeline entry', () => {
    assert.strictEqual(mod.formatFinalSummary('[AM0001]', ''), '[Stage 1]: [AM0001]');
    assert.strictEqual(mod.formatFinalSummary('[AM0002]', '[Stage 1]: [AM0001]'), '[Stage 1]: [AM0001]\n\n[Stage 2]: [AM0002]');
});

await testAsync('keeps the cumulative window start while expanding its end and includes prior Memory', async () => {
    const chat = [
        { name: 'User', mes: 'm1' }, { name: 'Assistant', mes: 'm2' }, { name: 'User', mes: 'm3' },
        { name: 'Assistant', mes: 'm4' }, { name: 'User', mes: 'm5' },
    ];
    const first = await mod.getRawSummaryPrompt({ chat }, 'system', 0, 1, '');
    const expanded = await mod.getRawSummaryPrompt({ chat }, 'system', 0, 3, '[Previous summaries]\n[AM0001]');
    assert.strictEqual(first.messageCount, 2);
    assert.strictEqual(expanded.messageCount, 4);
    assert.ok(expanded.rawPrompt.includes('m1'));
    assert.ok(expanded.rawPrompt.includes('m4'));
    assert.ok(expanded.rawPrompt.includes('[AM0001]'));
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
