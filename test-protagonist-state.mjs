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
let currentContext = { chat: [] };
const mocks = {
    getStringHash: value => String(value || '').split('').reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0),
    eventSource: { on: () => {} },
    event_types: {},
    saveSettingsDebounced: () => {},
    setExtensionPrompt: () => {},
    getContext: () => currentContext,
    extension_settings: { protagonistState: {} },
    renderExtensionTemplateAsync: async () => '',
    debounce_timeout: { default: 100 },
    debounce: (fn) => fn,
    window: {},
    $: () => ({ prop: () => {}, val: () => {}, trigger: () => {}, length: 0, off: () => ({ on: () => {} }) }),
    toastr: { success: () => {}, warning: () => {}, info: () => {}, error: () => {}, clear: () => {} },
};

const wrapped = `async () => {
try {
${code}
return {
  parseDDLColumns, sheetContentToObjects, applyTableDelta, detectIsolationKey,
  readDatabaseSnapshot, formatTable, getEnglishColumns, buildCurrentStateText, SHEET_MAP,
  extractTableEditBlock, parseStructuredEdits, applyEditsToSnapshot, processTableEditResponse,
  normalizeSnapshotRowIds, normalizeKnownSheetLayouts, mergePastExperienceValues,
  createInitialStateSnapshot, prepareStateUpdateSnapshot,
  buildStateUpdateSystemPrompt, writeSnapshotToChat, isTargetStillCurrent,
  selectUpdateHistoryMessages, buildStateUpdateRequestMessages, getSelectedTableKeys,
  renderEditableStateRecords, ensureSheetContent, renderPopupContent, getTimelineContextForMemory,
  getAssistantTurnsSinceStateUpdate, hasStateUpdateMarker
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
async function asyncTest(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
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

console.log('=== known legacy sheet layout migration ===');
test('repairs the legacy important-character header and merges duplicate past experience', () => {
    const snapshot = {
        sheet_NcBlYRH5: {
            content: [
                [null, '姓名', '性别/年龄', '外貌特征', '持有的重要物品', '是否离场', '过往经历'],
                [1, 'A', '女/20', '稳定外貌', '重要物品', '否', '原有经历', '原有经历'],
                [2, 'B', '男/21', '辨识特征', '', '是', '旧关系', '旧关系；当前关系'],
                [3, 'C', '', '', '', '否', '旧事实', '不重叠的新事实'],
            ],
        },
    };
    assert.strictEqual(mod.normalizeKnownSheetLayouts(snapshot), 1);
    assert.deepStrictEqual(snapshot.sheet_NcBlYRH5.content[0], ['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历']);
    assert.deepStrictEqual(snapshot.sheet_NcBlYRH5.content[1], [1, 'A', '女/20', '', '稳定外貌', '重要物品', '否', '原有经历']);
    assert.strictEqual(snapshot.sheet_NcBlYRH5.content[2][7], '旧关系；当前关系');
    assert.strictEqual(snapshot.sheet_NcBlYRH5.content[3][7], '旧事实\n不重叠的新事实');
});

test('does not remap an already canonical important-character sheet', () => {
    const snapshot = {
        sheet_NcBlYRH5: {
            content: [['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历'], [1, 'A', '', '简介', '外貌', '', '否', '经历']],
        },
    };
    const before = JSON.stringify(snapshot);
    assert.strictEqual(mod.normalizeKnownSheetLayouts(snapshot), 0);
    assert.strictEqual(JSON.stringify(snapshot), before);
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
    assert.ok(formatted.includes('Gender/Age: 女/22'));
    assert.ok(formatted.includes('Past: 战死'));
});

test('formats every quest field for lossless selected-table injection', () => {
    const formatted = mod.formatTable('quests_events', [{
        quest_name: '护送任务', quest_type: '主线', issuer: '院长', detail_desc: '护送商队抵达港口',
        current_progress: '已出发', time_limit: '三天', reward: '金币', penalty: '声望下降',
    }]);
    for (const value of ['院长', '护送商队抵达港口', '已出发', '三天', '金币', '声望下降']) {
        assert.ok(formatted.includes(value), `missing quest field: ${value}`);
    }
});

console.log('=== new-chat snapshot initialization ===');
test('creates all seven canonical sheets without copying another chat', () => {
    const snapshot = mod.createInitialStateSnapshot();
    assert.deepStrictEqual(Object.keys(snapshot), Object.keys(mod.SHEET_MAP));
    for (const [sheetKey, info] of Object.entries(mod.SHEET_MAP)) {
        const sheet = snapshot[sheetKey];
        assert.strictEqual(sheet.uid, sheetKey);
        assert.deepStrictEqual(mod.parseDDLColumns(sheet.sourceData.ddl), mod.getEnglishColumns(sheet, info.key));
        assert.ok(Array.isArray(sheet.content[0]));
    }
    assert.strictEqual(snapshot.sheet_dCudvUnH.content[1][0], 1);
    assert.strictEqual(snapshot.sheet_DpKcVGqg.content[1][0], 1);
    assert.strictEqual(snapshot.sheet_OptionsNew.content[1][0], 1);
    assert.strictEqual(snapshot.sheet_NcBlYRH5.content.length, 1);
    assert.strictEqual(snapshot.sheet_lEARaBa8.content.length, 1);
});

test('returns a fresh template only when the chat has no persisted snapshot', () => {
    const first = mod.prepareStateUpdateSnapshot([]);
    const second = mod.prepareStateUpdateSnapshot([]);
    assert.strictEqual(first.initializing, true);
    first.snapshot.sheet_dCudvUnH.content[1][1] = 'Changed locally';
    assert.strictEqual(second.snapshot.sheet_dCudvUnH.content[1][1], '');

    const persisted = {
        sheet_dCudvUnH: { content: [['row_id'], [1]] },
    };
    const prepared = mod.prepareStateUpdateSnapshot([{
        is_user: false,
        TavernDB_ACU_IsolatedData: { '': { independentData: persisted } },
    }]);
    assert.strictEqual(prepared.initializing, false);
    assert.deepStrictEqual(prepared.snapshot.sheet_dCudvUnH.content, persisted.sheet_dCudvUnH.content);
});

test('the initial template accepts singleton updates and multi-row inserts', () => {
    const snapshot = mod.createInitialStateSnapshot();
    const result = mod.processTableEditResponse(`<tableEdit>
updateRow('global_state', 1, {"current_location":"Market"})
updateRow('protagonist_info', 1, {"char_name":"Alex","gender_age":"Unknown"})
insertRow('important_characters', {"name":"Morgan","gender_age":"Unknown","is_absent":"否"})
</tableEdit>`, snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.changedCount, 3);
    assert.strictEqual(result.snapshot.sheet_dCudvUnH.content[1][1], 'Market');
    assert.strictEqual(result.snapshot.sheet_DpKcVGqg.content[1][1], 'Alex');
    assert.strictEqual(result.snapshot.sheet_NcBlYRH5.content[1][1], 'Morgan');
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
    const result = mod.applyEditsToSnapshot(snapshot, [{
        op: 'updateRow', table: 'global_state', rowId: 1,
        cells: { current_location: 'Market', cur_time: '10:00' },
    }]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.changedCount, 1);
    assert.deepStrictEqual(result.snapshot.sheet_dCudvUnH.content[1], [1, 'Market', '10:00', '', '']);
    assert.deepStrictEqual(snapshot.sheet_dCudvUnH.content[1], [1, 'Forest', '09:00', '', ''], 'input snapshot must remain untouched');
});

test('state update prompt specifies tableEdit-only output and schemas', () => {
    const prompt = mod.buildStateUpdateSystemPrompt();
    assert.ok(prompt.includes('Return only one <tableEdit> block'));
    assert.ok(prompt.includes('global_state: row_id, current_location'));
    assert.ok(prompt.includes('insertRow'));
    assert.ok(prompt.includes('global_state, protagonist_info, options: updateRow only'));
    assert.ok(prompt.includes('existing business key'));
    assert.ok(prompt.includes('inventory.quantity must remain a positive integer'));
    assert.ok(prompt.includes('do not justify inventing an exact timestamp'));
    assert.ok(prompt.includes('Memory Summary stores the detailed event history'));
    assert.ok(prompt.includes('roughly 200-300 Chinese characters'));
    assert.ok(prompt.includes('roughly 80-160 Chinese characters'));
    assert.ok(prompt.includes('rewrite and compress the entire past_experience field'));
    assert.ok(prompt.includes('do not update that row merely to restyle or shorten it'));
    assert.ok(prompt.includes('routine dialogue, action-by-action combat, travel paths'));
    assert.ok(prompt.includes('concise semicolon-separated list of possessions'));
    assert.ok(prompt.includes('Keep this definition setting-neutral'));
    assert.ok(prompt.includes('All length targets above are soft guidance'));
    assert.ok(!/魂骨|soul\s*bone/i.test(prompt));
    assert.ok(!prompt.includes('initializes the first protagonist-state snapshot'));
    const initializationPrompt = mod.buildStateUpdateSystemPrompt(true);
    assert.ok(initializationPrompt.includes('initializes the first protagonist-state snapshot'));
    assert.ok(initializationPrompt.includes('singleton rows already exist as row_id 1'));
    assert.ok(initializationPrompt.includes('never invent initialization data'));
});

test('repairs missing, invalid, and duplicate active row IDs without touching unrelated sheets', () => {
    const snapshot = {
        sheet_dCudvUnH: { content: [['row_id'], [null], [''], [-2], [4], [4]] },
        sheet_in05z9vz: { content: [['row_id'], [2], [null], [1]] },
        sheet_custom: { content: [['row_id'], [null]] },
    };
    assert.strictEqual(mod.normalizeSnapshotRowIds(snapshot), 5);
    assert.deepStrictEqual(snapshot.sheet_dCudvUnH.content.slice(1).map(row => row[0]), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(snapshot.sheet_in05z9vz.content.slice(1).map(row => row[0]), [2, 3, 1]);
    assert.strictEqual(snapshot.sheet_custom.content[1][0], null);
});

test('updates a formerly null singleton row through its repaired row_id', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [null, 'Forest', '09:00', '', '']],
        },
    };
    const result = mod.processTableEditResponse(`<tableEdit>\nupdateRow('global_state', 1, {"current_location":"Market","cur_time":"10:00"})\n</tableEdit>`, snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.repairedCount, 1);
    assert.deepStrictEqual(result.snapshot.sheet_dCudvUnH.content[1], [1, 'Market', '10:00', '', '']);
});

test('preserves operation order from the model response', () => {
    const block = `insertRow('inventory', {"item_name":"Potion"})\nupdateRow('global_state', 1, {"current_location":"Market"})\ndeleteRow('quests_events', 3)`;
    assert.deepStrictEqual(mod.parseStructuredEdits(block).map(op => op.op), ['insertRow', 'updateRow', 'deleteRow']);
});

test('preserves apostrophes inside strict JSON cell values', () => {
    const ops = mod.parseStructuredEdits(`insertRow('inventory', {"item_name":"King's sword","quantity":"1"})`);
    assert.strictEqual(ops[0].cells.item_name, "King's sword");
});

test('preserves closing braces inside strict JSON string values', () => {
    const ops = mod.parseStructuredEdits(`insertRow('inventory', {"item_name":"Rune } shard","quantity":"1"})`);
    assert.strictEqual(ops[0].cells.item_name, 'Rune } shard');
});

test('rolls back the whole batch when a forbidden options delete follows a valid update', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Forest', '09:00', '', '']],
        },
        sheet_OptionsNew: {
            content: [['row_id', '选项一', '选项二', '选项三', '选项四'], [1, 'A', 'B', 'C', 'D']],
        },
    };
    const result = mod.processTableEditResponse(`<tableEdit>\nupdateRow('global_state', 1, {"current_location":"Market"})\ndeleteRow('options', 1)\n</tableEdit>`, snapshot);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors[0].includes('not allowed'));
    assert.strictEqual(snapshot.sheet_dCudvUnH.content[1][1], 'Forest');
    assert.strictEqual(result.snapshot.sheet_dCudvUnH.content[1][1], 'Forest');
});

test('rejects unknown tables, rows, columns, row_id mutation, and structured values', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Forest', '09:00', '', '']],
        },
    };
    const invalidBlocks = [
        `updateRow('missing', 1, {"value":"x"})`,
        `updateRow('global_state', 9, {"current_location":"x"})`,
        `updateRow('global_state', 1, {"missing_column":"x"})`,
        `updateRow('global_state', 1, {"row_id":"2"})`,
        `updateRow('global_state', 1, {"current_location":{"nested":"x"}})`,
    ];
    for (const operation of invalidBlocks) {
        const result = mod.processTableEditResponse(`<tableEdit>${operation}</tableEdit>`, snapshot);
        assert.strictEqual(result.ok, false, operation);
    }
});

test('rejects duplicate business keys on insert across multi-row tables', () => {
    const cases = [
        {
            table: 'important_characters', sheet: 'sheet_NcBlYRH5',
            content: [['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历'], [1, '艾莉', '女/20', '', '', '', '否', '']],
            cells: { name: ' 艾莉 ', gender_age: '女/20' },
        },
        {
            table: 'protagonist_skills', sheet: 'sheet_lEARaBa8',
            content: [['row_id', '技能名称', '技能类型', '等级', '效果'], [1, '火球术', '主动', '1', '']],
            cells: { skill_name: '火球术', skill_type: '主动' },
        },
        {
            table: 'inventory', sheet: 'sheet_in05z9vz',
            content: [['row_id', '物品名称', '数量', '描述', '类别'], [1, '药水', '1', '', '消耗品']],
            cells: { item_name: '药水', category: '消耗品' },
        },
        {
            table: 'quests_events', sheet: 'sheet_etak47Ve',
            content: [['row_id', '任务名称', '任务类型', '发布者', '描述', '进度', '时限', '奖励', '惩罚'], [1, '护送', '支线任务', '', '', '', '', '', '']],
            cells: { quest_name: '护送', quest_type: '支线任务' },
        },
    ];
    for (const item of cases) {
        const snapshot = { [item.sheet]: { content: item.content } };
        const result = mod.applyEditsToSnapshot(snapshot, [{ op: 'insertRow', table: item.table, cells: item.cells }]);
        assert.strictEqual(result.ok, false, item.table);
        assert.match(result.errors[0], /must be unique/i, item.table);
        assert.strictEqual(result.snapshot[item.sheet].content.length, 2, item.table);
    }
});

test('rejects missing or invalid required values and applies safe insert defaults', () => {
    const inventory = {
        sheet_in05z9vz: { content: [['row_id', '物品名称', '数量', '描述', '类别']] },
    };
    const missing = mod.applyEditsToSnapshot(inventory, [{ op: 'insertRow', table: 'inventory', cells: { item_name: '药水' } }]);
    assert.strictEqual(missing.ok, false);
    assert.match(missing.errors[0], /category/);

    const inserted = mod.applyEditsToSnapshot(inventory, [{ op: 'insertRow', table: 'inventory', cells: { item_name: '药水', category: '消耗品' } }]);
    assert.strictEqual(inserted.ok, true);
    assert.strictEqual(inserted.snapshot.sheet_in05z9vz.content[1][2], '1');

    const invalidQuantity = mod.applyEditsToSnapshot(inserted.snapshot, [{ op: 'updateRow', table: 'inventory', rowId: 1, cells: { quantity: '0' } }]);
    assert.strictEqual(invalidQuantity.ok, false);
    assert.match(invalidQuantity.errors[0], /positive integer/);

    const characters = {
        sheet_NcBlYRH5: { content: [['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历']] },
    };
    const character = mod.applyEditsToSnapshot(characters, [{ op: 'insertRow', table: 'important_characters', cells: { name: '艾莉', gender_age: '女/20' } }]);
    assert.strictEqual(character.ok, true);
    assert.strictEqual(character.snapshot.sheet_NcBlYRH5.content[1][6], '否');
    const invalidAbsent = mod.applyEditsToSnapshot(character.snapshot, [{ op: 'updateRow', table: 'important_characters', rowId: 1, cells: { is_absent: '未知' } }]);
    assert.strictEqual(invalidAbsent.ok, false);
});

test('allows unrelated updates with legacy duplicates but rejects creating a new duplicate by rename', () => {
    const snapshot = {
        sheet_NcBlYRH5: {
            content: [
                ['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历'],
                [1, '赵无极', '男/50', '', '', '', '否', '旧记录一'],
                [2, '赵无极', '男/50', '', '', '', '否', '旧记录二'],
                [3, '弗兰德', '男/50', '', '', '', '否', ''],
            ],
        },
    };
    const unrelated = mod.applyEditsToSnapshot(snapshot, [{ op: 'updateRow', table: 'important_characters', rowId: 1, cells: { past_experience: '压缩后的记录' } }]);
    assert.strictEqual(unrelated.ok, true);
    const rename = mod.applyEditsToSnapshot(snapshot, [{ op: 'updateRow', table: 'important_characters', rowId: 3, cells: { name: '赵无极' } }]);
    assert.strictEqual(rename.ok, false);
    assert.match(rename.errors[0], /must be unique/i);
});

test('distinguishes a valid empty edit from a malformed non-empty edit', () => {
    const snapshot = { sheet_dCudvUnH: { content: [['row_id'], [null]] } };
    const empty = mod.processTableEditResponse('<tableEdit></tableEdit>', snapshot);
    assert.strictEqual(empty.ok, true);
    assert.strictEqual(empty.appliedCount, 0);
    assert.strictEqual(empty.repairedCount, 1);
    const malformed = mod.processTableEditResponse('<tableEdit>please update the location</tableEdit>', snapshot);
    assert.strictEqual(malformed.ok, false);
    assert.match(malformed.errors[0], /unparseable/i);
});

test('rejects a mixed block instead of silently applying only its valid operation', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Forest', '09:00', '', '']],
        },
    };
    const result = mod.processTableEditResponse(`<tableEdit>\nupdateRow('global_state', 1, {"current_location":"Market"})\ndeleteRow('options', nope)\n</tableEdit>`, snapshot);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.snapshot.sheet_dCudvUnH.content[1][1], 'Forest');
});

test('counts legal same-value updates separately from material changes', () => {
    const snapshot = {
        sheet_dCudvUnH: {
            sourceData: { ddl: globalDdl },
            content: [['row_id', '地点', '时间', '上轮时间', '经过时间'], [1, 'Forest', '09:00', '', '']],
        },
    };
    const result = mod.processTableEditResponse(`<tableEdit>updateRow('global_state', 1, {"current_location":"Forest"})</tableEdit>`, snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appliedCount, 1);
    assert.strictEqual(result.changedCount, 0);
});

test('keeps long relationship history values intact because length guidance is not enforced by the executor', () => {
    const longHistory = '长期关系事实'.repeat(100);
    const snapshot = {
        sheet_NcBlYRH5: {
            sourceData: { ddl: importantDdl },
            content: [['row_id', '姓名', '性别/年龄', '简介', '外貌', '重要物品', '是否离场', '过往经历'], [1, 'A', '', '', '', '', '否', '旧关系']],
        },
    };
    const response = `<tableEdit>updateRow('important_characters', 1, {"past_experience":"${longHistory}"})</tableEdit>`;
    const result = mod.processTableEditResponse(response, snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.snapshot.sheet_NcBlYRH5.content[1][7], longHistory);
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

test('counts automatic state updates from the latest successful marker', () => {
    const chat = [
        { is_user: false, mes: 'old assistant', extra: { protagonist_state_updated: 1 } },
        { is_user: true, mes: 'new user' },
        { is_user: false, mes: 'new assistant 1' },
        { is_user: false, mes: 'new assistant 2' },
    ];
    assert.strictEqual(mod.getAssistantTurnsSinceStateUpdate(chat, 3), 2);
    chat[3].extra = { protagonist_state_updated: 2 };
    assert.strictEqual(mod.hasStateUpdateMarker(chat[3]), true);
    assert.strictEqual(mod.getAssistantTurnsSinceStateUpdate(chat, 3), 0);
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

test('discards a legacy chronicle sheet when reading a snapshot', () => {
    const chat = [{
        is_user: false,
        TavernDB_ACU_IsolatedData: {
            '': {
                independentData: {
                    sheet_dCudvUnH: { content: [['row_id'], [1]] },
                    sheet_3NoMc1wI: { name: '纪要表', content: [['row_id'], [1]] },
                    sheet_old_summary: { name: '总结表', content: [['row_id'], [1]] },
                },
            },
        },
    }];
    const snapshot = mod.readDatabaseSnapshot(chat);
    assert.ok(!snapshot.sheet_3NoMc1wI, 'legacy chronicle must not survive snapshot reconstruction');
    assert.ok(!snapshot.sheet_old_summary, 'legacy summary aliases must not survive snapshot reconstruction');
});

console.log('=== atomic snapshot save ===');
await asyncTest('writes the snapshot and success marker to the exact target in one save', async () => {
    const assistant = { is_user: false, is_system: false, mes: 'target reply', extra: {} };
    let saves = 0;
    currentContext = {
        groupId: null, chatId: 'chat-a', characterId: 7, chat: [assistant],
        saveChat: async () => { saves++; },
    };
    const target = { index: 0, assistantMessage: assistant, messageHash: mocks.getStringHash(assistant.mes) };
    const snapshot = { sheet_dCudvUnH: { content: [['row_id'], [1]] } };
    const saved = await mod.writeSnapshotToChat(snapshot, currentContext, target, 12345);
    assert.strictEqual(saved, true);
    assert.strictEqual(saves, 1);
    assert.strictEqual(assistant.extra.protagonist_state_updated, 12345);
    assert.deepStrictEqual(assistant.TavernDB_ACU_IsolatedData[''].independentData, snapshot);
});

await asyncTest('rejects a stale target when a newer assistant reply exists', async () => {
    const targetMessage = { is_user: false, is_system: false, mes: 'old reply' };
    const newerMessage = { is_user: false, is_system: false, mes: 'new reply' };
    currentContext = {
        groupId: null, chatId: 'chat-b', characterId: 7, chat: [targetMessage, newerMessage],
        saveChat: async () => { throw new Error('must not save'); },
    };
    const target = { index: 0, assistantMessage: targetMessage, messageHash: mocks.getStringHash(targetMessage.mes) };
    const saved = await mod.writeSnapshotToChat({ sheet_dCudvUnH: { content: [['row_id'], [1]] } }, currentContext, target, 1);
    assert.strictEqual(saved, false);
    assert.ok(!targetMessage.TavernDB_ACU_IsolatedData);
    assert.ok(!targetMessage.extra);
});

await asyncTest('restores the previous in-memory snapshot and marker when saveChat fails', async () => {
    const oldIsolation = { '': { independentData: { old_sheet: { content: [['row_id'], [1]] } } } };
    const assistant = {
        is_user: false, is_system: false, mes: 'target reply',
        extra: { protagonist_state_updated: 99 },
        TavernDB_ACU_IsolatedData: JSON.parse(JSON.stringify(oldIsolation)),
    };
    currentContext = {
        groupId: null, chatId: 'chat-c', characterId: 7, chat: [assistant],
        saveChat: async () => { throw new Error('disk failure'); },
    };
    const target = { index: 0, assistantMessage: assistant, messageHash: mocks.getStringHash(assistant.mes) };
    const previousConsoleError = console.error;
    console.error = () => {};
    let saved;
    try {
        saved = await mod.writeSnapshotToChat({ sheet_dCudvUnH: { content: [['row_id'], [1]] } }, currentContext, target, 100);
    } finally {
        console.error = previousConsoleError;
    }
    assert.strictEqual(saved, false);
    assert.deepStrictEqual(assistant.TavernDB_ACU_IsolatedData, oldIsolation);
    assert.strictEqual(assistant.extra.protagonist_state_updated, 99);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
