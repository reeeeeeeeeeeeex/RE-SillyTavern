// Test harness for protagonist-state extension logic.
// Reads index.js, strips browser imports, evals with mocks, tests pure functions.
import fs from 'fs';
import path from 'path';
import assert from 'assert';

const indexJsPath = path.resolve('public/scripts/extensions/protagonist-state/index.js');
let code = fs.readFileSync(indexJsPath, 'utf8');

// Strip ESM import statements (multi-line) — they resolve to browser modules.
code = code.replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
// Replace imported enum references with literals.
code = code.replace(/extension_prompt_types\.IN_CHAT/g, '1');
code = code.replace(/extension_prompt_types\.NONE/g, '-1');
code = code.replace(/extension_prompt_roles\.SYSTEM/g, '0');
code = code.replace(/extension_prompt_roles\.USER/g, '1');
code = code.replace(/extension_prompt_roles\.ASSISTANT/g, '2');
// Strip the export keyword on init.
code = code.replace(/export\s+async\s+function\s+init/, 'async function init');

// Mock globals used by the module.
const mocks = {
    eventSource: { on: () => {} },
    event_types: {},
    saveSettingsDebounced: () => {},
    setExtensionPrompt: () => {},
    getContext: () => ({ chat: [] }),
    extension_settings: { protagonistState: {} },
    renderExtensionTemplateAsync: async () => '',
    debounce_timeout: { default: 100 },
    debounce: (fn) => fn,
    window: {},
    $: () => ({ prop: () => {}, val: () => {}, trigger: () => {}, length: 0, off: () => ({ on: () => {} }) }),
    toastr: { success: () => {}, warning: () => {} },
};

const wrapped = `async () => {
try {
${code}
return {
  parseDDLColumns, sheetContentToObjects, applyTableDelta, detectIsolationKey,
  readDatabaseSnapshot, formatTable, getEnglishColumns, buildCurrentStateText, SHEET_MAP,
  extractTableEditBlock, parseStructuredEdits, applyEditsToSnapshot, buildStateUpdateSystemPrompt,
  selectUpdateHistoryMessages, buildStateUpdateRequestMessages, getSelectedTableKeys,
  renderEditableStateRecords, ensureSheetContent, renderPopupContent, getTimelineContextForMemory
};
} catch (e) { console.error('IIFE eval error:', e); throw e; }
}`;

let factory;
try {
    factory = new Function(...Object.keys(mocks), `return (${wrapped})();`);
} catch (e) {
    console.error('Parse error while constructing test harness:', e.message);
    fs.writeFileSync('debug-stripped.js', code);
    console.error('Stripped code written to debug-stripped.js');
    process.exit(1);
}

const callResult = factory(...Object.values(mocks));
let mod;
try {
    mod = await callResult;
} catch (e) {
    console.error('Runtime error while evaluating module:', e);
    process.exit(1);
}
if (!mod || typeof mod.parseDDLColumns !== 'function') {
    console.error('Harness did not expose expected functions. mod =', mod);
    fs.writeFileSync('debug-wrapped.js', `return (${wrapped})();`);
    console.error('Wrapped code written to debug-wrapped.js');
    process.exit(1);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('=== parseDDLColumns ===');
const globalDdl = `CREATE TABLE global_state ( -- 全局数据表
  row_id INTEGER PRIMARY KEY, -- 行号
  current_location TEXT NOT NULL, -- 主角当前所在地点
  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??'), -- 当前时间
  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- 上轮场景时间
  elapsed_time TEXT -- 经过的时间
);`;
test('parses global_state DDL into 5 English columns in order', () => {
    const cols = mod.parseDDLColumns(globalDdl);
    assert.deepStrictEqual(cols, ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time']);
});

const importantDdl = `CREATE TABLE important_characters ( -- 重要角色表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL UNIQUE, -- 姓名
  gender_age TEXT NOT NULL, -- 性别/年龄
  brief_intro TEXT CHECK(brief_intro IS NULL OR LENGTH(brief_intro) <= 20), -- 一句话介绍
  appearance TEXT, -- 外貌特征
  key_items TEXT, -- 持有的重要物品
  is_absent TEXT NOT NULL DEFAULT '否' CHECK(is_absent IN ('是', '否')), -- 是否离场
  past_experience TEXT -- 过往经历
);`;
test('parses important_characters DDL into 8 columns', () => {
    const cols = mod.parseDDLColumns(importantDdl);
    assert.strictEqual(cols.length, 8);
    assert.strictEqual(cols[0], 'row_id');
    assert.strictEqual(cols[1], 'name');
    assert.strictEqual(cols[6], 'is_absent');
});

test('returns [] for empty/invalid DDL', () => {
    assert.deepStrictEqual(mod.parseDDLColumns(''), []);
    assert.deepStrictEqual(mod.parseDDLColumns(null), []);
});

console.log('=== sheetContentToObjects ===');
test('converts 2D content with Chinese headers + English column map to objects', () => {
    const sheet = {
        content: [
            ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
            [1, '森林', '2024-03-15 16:00', '2024-03-15 15:00', '约1小时'],
        ],
    };
    const cols = ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time'];
    const objs = mod.sheetContentToObjects(sheet, cols);
    assert.strictEqual(objs.length, 1);
    assert.strictEqual(objs[0].current_location, '森林');
    assert.strictEqual(objs[0].cur_time, '2024-03-15 16:00');
});

test('falls back to header keys when no English columns provided', () => {
    const sheet = { content: [['姓名', '年龄'], ['张三', 25]] };
    const objs = mod.sheetContentToObjects(sheet, []);
    assert.strictEqual(objs[0]['姓名'], '张三');
});

test('handles empty sheet', () => {
    assert.deepStrictEqual(mod.sheetContentToObjects({ content: [] }, []), []);
    assert.deepStrictEqual(mod.sheetContentToObjects(null, []), []);
});

console.log('=== applyTableDelta ===');
test('upsert updates existing row by row_id', () => {
    const base = { content: [['row_id', 'name'], [1, 'A'], [2, 'B']] };
    const delta = { rowDeltas: [{ row_id: 1, op: 'upsert', cells: [1, 'A-updated'] }] };
    const result = mod.applyTableDelta(base, delta);
    assert.strictEqual(result.content[1][1], 'A-updated');
    assert.strictEqual(result.content.length, 3);
});

test('upsert appends new row when row_id not found', () => {
    const base = { content: [['row_id', 'name'], [1, 'A']] };
    const delta = { rowDeltas: [{ row_id: 5, op: 'upsert', cells: [5, 'C'] }] };
    const result = mod.applyTableDelta(base, delta);
    assert.strictEqual(result.content.length, 3);
    assert.strictEqual(result.content[2][1], 'C');
});

test('delete removes row by row_id', () => {
    const base = { content: [['row_id', 'name'], [1, 'A'], [2, 'B'], [3, 'C']] };
    const delta = { rowDeltas: [{ row_id: 2, op: 'delete' }] };
    const result = mod.applyTableDelta(base, delta);
    assert.strictEqual(result.content.length, 3);
    assert.strictEqual(result.content.find(r => r[0] === 2), undefined);
});

test('does not mutate original base', () => {
    const base = { content: [['row_id', 'name'], [1, 'A']] };
    const delta = { rowDeltas: [{ row_id: 1, op: 'upsert', cells: [1, 'Z'] }] };
    mod.applyTableDelta(base, delta);
    assert.strictEqual(base.content[1][1], 'A');
});

console.log('=== detectIsolationKey ===');
test('returns empty string when no isolation data', () => {
    assert.strictEqual(mod.detectIsolationKey([]), '');
    assert.strictEqual(mod.detectIsolationKey([{ is_user: false }]), '');
});

test('detects most common non-empty key', () => {
    const chat = [
        { is_user: false, TavernDB_ACU_IsolatedData: { 'CODE-A': {} } },
        { is_user: false, TavernDB_ACU_IsolatedData: { 'CODE-A': {} } },
        { is_user: false, TavernDB_ACU_IsolatedData: { 'CODE-A': {} } },
        { is_user: false, TavernDB_ACU_IsolatedData: { '': {} } },
    ];
    assert.strictEqual(mod.detectIsolationKey(chat), 'CODE-A');
});

test('defaults to empty key when it is most common', () => {
    const chat = [
        { is_user: false, TavernDB_ACU_IsolatedData: { '': {} } },
        { is_user: false, TavernDB_ACU_IsolatedData: { '': {} } },
        { is_user: false, TavernDB_ACU_IsolatedData: { 'X': {} } },
    ];
    assert.strictEqual(mod.detectIsolationKey(chat), '');
});

console.log('=== readDatabaseSnapshot (checkpoint) ===');
test('reads checkpoint snapshot from chat message tags', () => {
    const chat = [{
        is_user: false,
        TavernDB_ACU_IsolatedData: {
            '': {
                _acu_storage_mode: 'checkpoint',
                independentData: {
                    'sheet_dCudvUnH': {
                        sourceData: { ddl: globalDdl },
                        content: [
                            ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
                            [1, '森林', '2024-03-15 16:00', '2024-03-15 15:00', '约1小时'],
                        ],
                    },
                },
            },
        },
    }];
    const snap = mod.readDatabaseSnapshot(chat);
    assert.ok(snap, 'snapshot should be non-null');
    assert.ok(snap['sheet_dCudvUnH'], 'global_state sheet present');
});

console.log('=== readDatabaseSnapshot (delta) ===');
test('reconstructs state from checkpoint + delta', () => {
    const baseSheet = {
        sourceData: { ddl: globalDdl },
        content: [
            ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
            [1, '森林', '2024-03-15 16:00', '2024-03-15 15:00', '约1小时'],
        ],
    };
    const chat = [
        {
            is_user: false,
            TavernDB_ACU_IsolatedData: {
                '': {
                    _acu_storage_mode: 'checkpoint',
                    independentData: { 'sheet_dCudvUnH': JSON.parse(JSON.stringify(baseSheet)) },
                },
            },
        },
        {
            is_user: false,
            TavernDB_ACU_IsolatedData: {
                '': {
                    _acu_storage_mode: 'delta',
                    incrementalData: {
                        'sheet_dCudvUnH': {
                            rowDeltas: [{ row_id: 1, op: 'upsert', cells: [1, '城镇', '2024-03-15 18:00', '2024-03-15 16:00', '约2小时'] }],
                        },
                    },
                },
            },
        },
    ];
    const snap = mod.readDatabaseSnapshot(chat);
    const rows = mod.sheetContentToObjects(snap['sheet_dCudvUnH'], ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time']);
    assert.strictEqual(rows[0].current_location, '城镇');
    assert.strictEqual(rows[0].cur_time, '2024-03-15 18:00');
});

test('reconstructs state from checkpoint + two sequential deltas', () => {
    const baseSheet = {
        sourceData: { ddl: globalDdl },
        content: [
            ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
            [1, '森林', '2024-03-15 16:00', '2024-03-15 15:00', '约1小时'],
        ],
    };
    const chat = [
        {
            is_user: false,
            TavernDB_ACU_IsolatedData: {
                '': {
                    _acu_storage_mode: 'checkpoint',
                    independentData: { 'sheet_dCudvUnH': JSON.parse(JSON.stringify(baseSheet)) },
                },
            },
        },
        {
            is_user: false,
            TavernDB_ACU_IsolatedData: {
                '': {
                    _acu_storage_mode: 'delta',
                    incrementalData: {
                        'sheet_dCudvUnH': {
                            rowDeltas: [{ row_id: 1, op: 'upsert', cells: [1, '城镇', '2024-03-15 18:00', '2024-03-15 16:00', '约2小时'] }],
                        },
                    },
                },
            },
        },
        {
            is_user: false,
            TavernDB_ACU_IsolatedData: {
                '': {
                    _acu_storage_mode: 'delta',
                    incrementalData: {
                        'sheet_dCudvUnH': {
                            rowDeltas: [{ row_id: 1, op: 'upsert', cells: [1, '港口', '2024-03-15 20:00', '2024-03-15 18:00', '约2小时'] }],
                        },
                    },
                },
            },
        },
    ];
    const snap = mod.readDatabaseSnapshot(chat);
    const rows = mod.sheetContentToObjects(snap['sheet_dCudvUnH'], ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time']);
    assert.strictEqual(rows[0].current_location, '港口', 'second delta should win');
    assert.strictEqual(rows[0].cur_time, '2024-03-15 20:00');
});

console.log('=== readDatabaseSnapshot (chat snapshot, no live API) ===');
test('reads from chat snapshot tags (live API path removed)', () => {
    const chat = [{
        is_user: false,
        TavernDB_ACU_IsolatedData: {
            '': {
                _acu_storage_mode: 'checkpoint',
                independentData: {
                    'sheet_dCudvUnH': {
                        sourceData: { ddl: globalDdl },
                        content: [
                            ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
                            [1, '快照地点', '2024-03-15 20:00', '', ''],
                        ],
                    },
                },
            },
        },
    }];
    const snap = mod.readDatabaseSnapshot(chat);
    const rows = mod.sheetContentToObjects(snap['sheet_dCudvUnH'], ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time']);
    assert.strictEqual(rows[0].current_location, '快照地点');
});

console.log('=== getKnownTableData + TABLE_CONFIG formatting ===');
test('formats global_state via DDL-parsed columns', () => {
    const snap = {
        'sheet_dCudvUnH': {
            sourceData: { ddl: globalDdl },
            content: [
                ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
                [1, '森林', '2024-03-15 16:00', '2024-03-15 15:00', '约1小时'],
            ],
        },
    };
    const cols = mod.getEnglishColumns(snap['sheet_dCudvUnH'], 'global_state');
    const rows = mod.sheetContentToObjects(snap['sheet_dCudvUnH'], cols);
    assert.strictEqual(rows.length, 1);
    const formatted = mod.formatTable('global_state', rows);
    assert.ok(formatted.includes('Location: 森林'));
    assert.ok(formatted.includes('Time: 2024-03-15 16:00'));
});

test('formats important_characters with absent flag', () => {
    const snap = {
        'sheet_NcBlYRH5': {
            sourceData: { ddl: importantDdl },
            content: [
                ['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历'],
                [1, '艾莉丝', '女/22', '神秘法师', '银发', '法杖', '否', ''],
                [2, '马库斯', '男/40', '退役骑士', '', '长剑', '是', '战死'],
            ],
        },
    };
    const cols = mod.getEnglishColumns(snap['sheet_NcBlYRH5'], 'important_characters');
    const rows = mod.sheetContentToObjects(snap['sheet_NcBlYRH5'], cols);
    assert.strictEqual(rows.length, 2);
    const formatted = mod.formatTable('important_characters', rows);
    assert.ok(formatted.includes('艾莉丝'));
    assert.ok(formatted.includes('[Absent]'), 'absent character marked');
});

console.log('=== tableEdit updater ===');
test('parses a strict tableEdit block returned by the update API', () => {
    const block = mod.extractTableEditBlock(`Before\n<tableEdit>
updateRow('global_state', 1, {"current_location":"Market","cur_time":"2026-07-10 10:00"})
insertRow('inventory', {"item_name":"Potion","quantity":"1"})
deleteRow('quests_events', 3)
</tableEdit>\nAfter`);
    const ops = mod.parseStructuredEdits(block);
    assert.strictEqual(ops.length, 3);
    assert.deepStrictEqual(ops[0], { op: 'updateRow', table: 'global_state', rowId: 1, cells: { current_location: 'Market', cur_time: '2026-07-10 10:00' } });
    assert.deepStrictEqual(ops[1], { op: 'insertRow', table: 'inventory', cells: { item_name: 'Potion', quantity: '1' } });
    assert.deepStrictEqual(ops[2], { op: 'deleteRow', table: 'quests_events', rowId: 3 });
});

test('applies parsed update API operations using English column names', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Forest', '09:00', '', '']],
        },
    };
    mod.applyEditsToSnapshot(snapshot, [{
        op: 'updateRow', table: 'global_state', rowId: 1,
        cells: { current_location: 'Market', cur_time: '10:00' },
    }]);
    assert.deepStrictEqual(snapshot.sheet_dCudvUnH.content[1], [1, 'Market', '10:00', '', '']);
});

test('state update prompt specifies tableEdit-only output and schemas', () => {
    const prompt = mod.buildStateUpdateSystemPrompt();
    assert.ok(prompt.includes('Return only one <tableEdit> block'));
    assert.ok(prompt.includes('global_state: row_id, current_location'));
    assert.ok(prompt.includes('insertRow'));
});

console.log('=== state update context ===');
const updateHistoryChat = [
    { is_user: true, mes: 'first user message' },
    { is_system: true, mes: 'system message must be excluded' },
    { is_user: false, mes: 'first assistant reply' },
    { is_user: true, mes: 'second user message' },
    { is_user: false, mes: 'second assistant reply' },
];

test('selects all non-system messages when the history limit is zero', () => {
    const selected = mod.selectUpdateHistoryMessages(updateHistoryChat, 4, 0);
    assert.deepStrictEqual(selected.map(x => x.mes), [
        'first user message', 'first assistant reply', 'second user message', 'second assistant reply',
    ]);
});

test('selects the latest N non-system messages in chronological order', () => {
    const selected = mod.selectUpdateHistoryMessages(updateHistoryChat, 4, 2);
    assert.deepStrictEqual(selected.map(x => x.mes), ['second user message', 'second assistant reply']);
});

test('adds Memory Summary only when the setting is enabled', () => {
    mocks.extension_settings.protagonistState = { updateHistoryMessages: 2, includeMemorySummary: true };
    mocks.window.memoryExtension = { getSummaryText: () => 'Live memory summary' };
    const target = { index: 4, assistantMessage: updateHistoryChat[4] };
    const withSummary = mod.buildStateUpdateRequestMessages({}, { chat: updateHistoryChat }, target)[1].content;
    assert.ok(withSummary.includes('[Memory Summary]\nLive memory summary'));
    assert.ok(withSummary.includes('second user message'));
    assert.ok(!withSummary.includes('first user message'));
    assert.ok(!withSummary.includes('system message must be excluded'));

    mocks.extension_settings.protagonistState.includeMemorySummary = false;
    const withoutSummary = mod.buildStateUpdateRequestMessages({}, { chat: updateHistoryChat }, target)[1].content;
    assert.ok(!withoutSummary.includes('[Memory Summary]'));
});

test('uses the checked display tables for the bottom state bar', () => {
    mocks.extension_settings.protagonistState = {
        tables: { global_state: true, protagonist_info: false, inventory: true },
    };
    const snapshot = {
        sheet_dCudvUnH: { content: [] },
        sheet_DpKcVGqg: { content: [] },
        sheet_in05z9vz: { content: [] },
    };
    assert.deepStrictEqual(mod.getSelectedTableKeys(snapshot), ['global_state', 'inventory']);
});

test('renders checked tables as editable vertical record cards', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Market', '10:00', '', '']],
        },
    };
    const html = mod.renderEditableStateRecords(snapshot, 'global_state', 'ps_bottom_records');
    assert.ok(html.includes('contenteditable="true"'));
    assert.ok(html.includes('ps_add_row'));
    assert.ok(html.includes('ps_record_card'));
    assert.ok(html.includes('ps_state_field'));
    assert.ok(!html.includes('<table'));
});

test('initializes an empty table before adding a row', () => {
    const sheet = { sourceData: { ddl: globalDdl }, content: [] };
    const content = mod.ensureSheetContent(sheet, 'global_state');
    assert.deepStrictEqual(content[0], ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time']);
});

test('renders a sidebar link and continuous section for every active table plus Memory', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Market', '10:00', '', '']],
        },
    };
    const html = mod.renderPopupContent(snapshot);
    assert.ok(html.includes('ps_popup_sidebar'));
    assert.ok(html.includes('ps_popup_content_scroll'));
    for (const tableKey of ['global_state', 'protagonist_info', 'important_characters', 'protagonist_skills', 'inventory', 'quests_events', 'options', 'memory']) {
        assert.ok(html.includes(`data-section="${tableKey}"`), `navigation should include ${tableKey}`);
        assert.ok(html.includes(`ps_popup_section_${tableKey}`), `content should include ${tableKey}`);
    }
    assert.ok(!html.includes('ps_tabs'));
    assert.ok(!html.includes('data-section="chronicle"'));
});

test('does not expose legacy chronicle as an active state table', () => {
    assert.ok(!Object.values(mod.SHEET_MAP).some(table => table.key === 'chronicle'));
});

test('preserves a legacy chronicle sheet when reading a snapshot for later checkpoint saves', () => {
    const chat = [{
        is_user: false,
        TavernDB_ACU_IsolatedData: {
            '': {
                independentData: {
                    sheet_dCudvUnH: { content: [['row_id'], [1]] },
                    sheet_3NoMc1wI: { name: '纪要表', content: [['row_id'], [1]] },
                },
            },
        },
    }];
    const snapshot = mod.readDatabaseSnapshot(chat);
    assert.ok(snapshot.sheet_3NoMc1wI, 'legacy chronicle must remain in the raw snapshot');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
