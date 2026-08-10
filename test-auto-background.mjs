import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    AUTO_BACKGROUND_MARKER_KEY,
    AUTO_BACKGROUND_MESSAGE_KEY,
    buildAutoBackgroundAnalysisPrompt,
    extractLatestMemoryStage,
    findLastAutoBackgroundMarker,
    getAssistantTurnsSinceLastAutoBackground,
    isNarrativeAssistantMessage,
    normalizeAutoBackgroundMessageId,
    normalizeSceneKey,
    parseSceneAnalysisResponse,
} from './public/scripts/extensions/stable-diffusion/auto-background.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS ${name}`);
    } catch (error) {
        failed++;
        console.error(`  FAIL ${name}`);
        console.error(`       ${error.stack || error.message}`);
    }
}

console.log('=== Automatic ComfyUI novel backgrounds ===');

test('recognizes only real narrative Assistant replies', () => {
    assert.equal(isNarrativeAssistantMessage({ is_user: false, is_system: false, mes: 'Story' }), true);
    assert.equal(isNarrativeAssistantMessage({ is_user: true, is_system: false, mes: 'User' }), false);
    assert.equal(isNarrativeAssistantMessage({ is_user: false, is_system: true, mes: 'System' }), false);
    assert.equal(isNarrativeAssistantMessage({ is_user: false, is_system: false, mes: 'Image', extra: { [AUTO_BACKGROUND_MESSAGE_KEY]: true } }), false);
    assert.equal(isNarrativeAssistantMessage({ is_user: false, is_system: false, mes: '  ' }), false);
});

test('manual generation keeps a missing message id distinct from message zero', () => {
    assert.equal(normalizeAutoBackgroundMessageId(null), -1);
    assert.equal(normalizeAutoBackgroundMessageId(undefined), -1);
    assert.equal(normalizeAutoBackgroundMessageId(''), -1);
    assert.equal(normalizeAutoBackgroundMessageId('   '), -1);
    assert.equal(normalizeAutoBackgroundMessageId(0), 0);
    assert.equal(normalizeAutoBackgroundMessageId('12'), 12);
    assert.equal(normalizeAutoBackgroundMessageId(-1), -1);
    assert.equal(normalizeAutoBackgroundMessageId('not-a-number'), -1);
});

test('counts Assistant replies from the latest successful background marker', () => {
    const chat = [
        { is_user: false, is_system: false, mes: 'old reply', extra: { [AUTO_BACKGROUND_MARKER_KEY]: { scene_key: 'old-room' } } },
        { is_user: true, is_system: false, mes: 'user' },
        { is_user: false, is_system: false, mes: 'reply 1' },
        { is_user: false, is_system: true, mes: 'visible generated background', extra: { [AUTO_BACKGROUND_MESSAGE_KEY]: true } },
        { is_user: false, is_system: false, mes: 'reply 2' },
    ];
    assert.equal(getAssistantTurnsSinceLastAutoBackground(chat), 2);
    assert.equal(getAssistantTurnsSinceLastAutoBackground(chat, 2), 1);
    assert.deepEqual(findLastAutoBackgroundMarker(chat), { index: 0, marker: { scene_key: 'old-room' } });
});

test('uses all Assistant replies when no successful marker exists', () => {
    const chat = [
        { is_user: false, mes: 'one' },
        { is_user: true, mes: 'user' },
        { is_user: false, mes: 'two' },
    ];
    assert.equal(getAssistantTurnsSinceLastAutoBackground(chat), 2);
    assert.equal(findLastAutoBackgroundMarker(chat), null);
});

test('extracts only the latest cumulative Memory Stage', () => {
    const memory = '[Stage 1]\nOld location\n\n[Stage 2]\nCurrent location';
    assert.equal(extractLatestMemoryStage(memory), '[Stage 2]\nCurrent location');
    assert.equal(extractLatestMemoryStage('abcdefgh', 4), 'efgh');
    assert.equal(extractLatestMemoryStage(''), '');
});

test('normalizes harmless scene-key differences', () => {
    assert.equal(normalizeSceneKey('  Ice_Palace   Hall  '), 'ice-palace-hall');
    assert.equal(normalizeSceneKey('ICE--PALACE'), 'ice-palace');
});

test('parses strict, fenced, and reasoning-prefixed JSON scene results', () => {
    assert.deepEqual(
        parseSceneAnalysisResponse('{"scene_key":"Ice Hall","prompt":"grand frozen hall, blue evening light"}'),
        { sceneKey: 'ice-hall', prompt: 'grand frozen hall, blue evening light' },
    );
    assert.deepEqual(
        parseSceneAnalysisResponse('<think>private reasoning</think>\n```json\n{"sceneKey":"Forest","prompt":"ancient forest, mist"}\n```'),
        { sceneKey: 'forest', prompt: 'ancient forest, mist' },
    );
    assert.throws(() => parseSceneAnalysisResponse('not json'), /JSON object/);
    assert.throws(() => parseSceneAnalysisResponse('{"scene_key":"","prompt":"forest"}'), /empty scene_key/);
    assert.throws(() => parseSceneAnalysisResponse('{"scene_key":"forest","prompt":""}'), /empty prompt/);
});

test('builds a background-only prompt with all selected evidence sources', () => {
    const prompt = buildAutoBackgroundAnalysisPrompt({
        userMessage: 'Open the door',
        assistantMessage: 'The door opens onto a snowy courtyard.',
        timelineContext: 'Location: palace courtyard',
        memoryStage: '[Stage 8] arrived at the palace',
        previousSceneKey: 'palace-hall',
    });
    assert.match(prompt, /latest Assistant narrative as the primary source/i);
    assert.match(prompt, /Do not describe people, characters/i);
    assert.match(prompt, /palace courtyard/);
    assert.match(prompt, /\[Stage 8\]/);
    assert.match(prompt, /snowy courtyard/);
    assert.match(prompt, /palace-hall/);
});

const extensionSource = fs.readFileSync(path.resolve('public/scripts/extensions/stable-diffusion/index.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.resolve('public/scripts/extensions/stable-diffusion/settings.html'), 'utf8');

test('provides all automatic background controls', () => {
    for (const id of [
        'sd_auto_background_enabled',
        'sd_auto_background_mode',
        'sd_auto_background_interval',
        'sd_auto_background_workflow',
        'sd_auto_background_show_message',
        'sd_auto_background_generate_now',
        'sd_auto_background_status',
    ]) {
        assert.ok(settingsHtml.includes(`id="${id}"`), `missing #${id}`);
    }
});

test('passes a dedicated workflow without mutating the global workflow setting', () => {
    assert.match(extensionSource, /requestOptions\.comfyWorkflow/);
    assert.match(extensionSource, /workflowName = extension_settings\.sd\.comfy_workflow/);
    assert.match(extensionSource, /\{ comfyWorkflow: workflow, silentAbort: true \}/);
    assert.doesNotMatch(extensionSource, /extension_settings\.sd\.comfy_workflow\s*=\s*workflow;/);
});

test('stores a visible context-excluded system media card and ignores extension events', () => {
    assert.match(extensionSource, /is_system: true,[\s\S]*?\[AUTO_BACKGROUND_MESSAGE_KEY\]: true/);
    assert.match(extensionSource, /if \(eventType === 'extension'\) return;/);
    assert.match(extensionSource, /AUTO_BACKGROUND_MARKER_KEY/);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
