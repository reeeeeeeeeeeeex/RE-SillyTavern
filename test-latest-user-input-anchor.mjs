import assert from 'node:assert';
import path from 'node:path';
import { setConfigFilePath } from './src/util.js';
import {
    formatLatestUserInputAnchor,
    getLatestRawUserInput,
    shouldAddLatestUserInputAnchor,
    shouldDuplicateLatestUserInputAnchor,
    wrapLatestUserMessageWithAnchor,
} from './public/scripts/latest-user-input-anchor.js';

setConfigFilePath(path.resolve('config.yaml'));
const { postProcessPrompt, PROMPT_PROCESSING_TYPE } = await import('./src/prompt-converters.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (error) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${error.stack || error.message}`);
        failed++;
    }
}

console.log('=== Latest user input anchor ===');

test('reads only the latest real user-authored text', () => {
    const chat = [
        { is_user: true, mes: 'first' },
        { is_user: false, mes: 'reply' },
        { is_user: true, mes: 'latest\n“quoted”' },
    ];
    assert.strictEqual(getLatestRawUserInput(chat), 'latest\n“quoted”');
});

test('formats multiline input without altering its text', () => {
    assert.strictEqual(
        formatLatestUserInputAnchor('line 1\n"line 2"'),
        '以下是用户本轮输入：\n“line 1\n"line 2"”',
    );
});

test('enables only native DeepSeek roleplay generations', () => {
    for (const type of ['normal', 'swipe', 'regenerate']) {
        assert.strictEqual(shouldAddLatestUserInputAnchor({ source: 'deepseek', type, latestUserInput: 'go' }), true);
    }
    for (const type of ['quiet', 'continue', 'impersonate']) {
        assert.strictEqual(shouldAddLatestUserInputAnchor({ source: 'deepseek', type, latestUserInput: 'go' }), false);
    }
    assert.strictEqual(shouldAddLatestUserInputAnchor({ source: 'openai', type: 'normal', latestUserInput: 'go' }), false);
    assert.strictEqual(shouldAddLatestUserInputAnchor({ source: 'deepseek', type: 'normal', latestUserInput: '   ' }), false);
});

test('keeps media on the original User message and requires source-plus-anchor budget', () => {
    assert.strictEqual(shouldDuplicateLatestUserInputAnchor({ hasMedia: false, canFit: true }), true);
    assert.strictEqual(shouldDuplicateLatestUserInputAnchor({ hasMedia: true, canFit: true }), false);
    assert.strictEqual(shouldDuplicateLatestUserInputAnchor({ hasMedia: false, canFit: false }), false);
});

test('budget fallback wraps only the latest transient User message', () => {
    const messages = [
        { role: 'user', content: 'current' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'old' },
    ];
    assert.strictEqual(wrapLatestUserMessageWithAnchor(messages), true);
    assert.strictEqual(messages[0].content, '以下是用户本轮输入：\n“current”');
    assert.strictEqual(messages[2].content, 'old');
    assert.strictEqual(wrapLatestUserMessageWithAnchor(messages), true);
    assert.strictEqual(messages[0].content, '以下是用户本轮输入：\n“current”');
    assert.strictEqual(wrapLatestUserMessageWithAnchor([{ role: 'assistant', content: 'reply' }]), false);
});

test('SEMI_TOOLS keeps the anchor at the final context boundary for every dynamic role', () => {
    const anchor = formatLatestUserInputAnchor('open the door');
    const names = { charName: 'Bot', userName: 'User', groupNames: [], startsWithGroupName: () => false };
    for (const role of ['system', 'user', 'assistant']) {
        const messages = [
            { role: 'system', content: 'main' },
            { role: 'user', content: 'open the door' },
            { role: 'assistant', content: 'history' },
            { role, content: 'dynamic Memory / state / World Info' },
            { role: 'user', content: anchor },
        ];
        const processed = postProcessPrompt(structuredClone(messages), PROMPT_PROCESSING_TYPE.SEMI_TOOLS, names);
        assert.ok(processed.at(-1).content.endsWith(anchor), `anchor was not last after dynamic ${role}`);
        assert.strictEqual(processed.map(message => message.content).join('\n').split('以下是用户本轮输入：').length - 1, 1);
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
