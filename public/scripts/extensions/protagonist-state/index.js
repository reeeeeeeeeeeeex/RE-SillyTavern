import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateRaw,
    getRequestHeaders,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../script.js';
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { debounce_timeout } from '../../constants.js';
import { debounce, getStringHash } from '../../utils.js';

const MODULE_NAME = 'protagonist_state';
const DISCARDED_SHEET_KEYS = new Set(['sheet_3NoMc1wI']);

function isDiscardedSheet(sheetKey, sheet) {
    const name = String(sheet?.name ?? '').trim();
    return DISCARDED_SHEET_KEYS.has(sheetKey) || name === '纪要表' || name === '总结表';
}

// Reverse-lookup helpers built from SHEET_MAP below.
const SHEET_MAP = {
    'sheet_dCudvUnH': { key: 'global_state', name: '全局状态' },
    'sheet_DpKcVGqg': { key: 'protagonist_info', name: '主角信息' },
    'sheet_NcBlYRH5': { key: 'important_characters', name: '重要角色' },
    'sheet_lEARaBa8': { key: 'protagonist_skills', name: '主角技能' },
    'sheet_in05z9vz': { key: 'inventory', name: '背包物品' },
    'sheet_etak47Ve': { key: 'quests_events', name: '任务与事件' },
    'sheet_OptionsNew': { key: 'options', name: '选项' },
};
const TABLE_TO_SHEET = Object.fromEntries(Object.entries(SHEET_MAP).map(([k, v]) => [v.key, k]));

const TABLE_ICONS = {
    global_state: 'fa-location-dot',
    protagonist_info: 'fa-user',
    important_characters: 'fa-users',
    protagonist_skills: 'fa-star',
    inventory: 'fa-briefcase',
    quests_events: 'fa-scroll',
    options: 'fa-list-ol',
};

const TABLE_COLUMNS = {
    global_state: ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time'],
    protagonist_info: ['row_id', 'char_name', 'gender_age', 'appearance', 'occupation', 'past_experience', 'personality'],
    important_characters: ['row_id', 'name', 'gender_age', 'brief_intro', 'appearance', 'key_items', 'is_absent', 'past_experience'],
    protagonist_skills: ['row_id', 'skill_name', 'skill_type', 'skill_level', 'effect_desc'],
    inventory: ['row_id', 'item_name', 'quantity', 'description', 'category'],
    quests_events: ['row_id', 'quest_name', 'quest_type', 'issuer', 'detail_desc', 'current_progress', 'time_limit', 'reward', 'penalty'],
    options: ['row_id', 'option_1', 'option_2', 'option_3', 'option_4'],
};

const IMPORTANT_CHARACTER_HEADERS = ['row_id', '姓名', '性别/年龄', '一句话介绍', '外貌特征', '持有的重要物品', '是否离场', '过往经历'];
const LEGACY_IMPORTANT_CHARACTER_HEADERS = ['姓名', '性别/年龄', '外貌特征', '持有的重要物品', '是否离场', '过往经历'];

const INITIAL_SHEET_DEFINITIONS = {
    global_state: {
        name: '全局数据表',
        headers: ['row_id', '主角当前所在地点', '当前时间', '上轮场景时间', '经过的时间'],
        singleton: true,
        ddl: `CREATE TABLE global_state ( -- 全局数据表
  row_id INTEGER PRIMARY KEY, -- 行号
  current_location TEXT NOT NULL, -- 主角当前所在地点
  cur_time TEXT NOT NULL, -- 当前时间
  prev_scene_time TEXT, -- 上轮场景时间
  elapsed_time TEXT -- 经过的时间
);`,
    },
    protagonist_info: {
        name: '主角信息表',
        headers: ['row_id', '人物名称', '性别/年龄', '外貌特征', '职业/身份', '过往经历', '性格特点'],
        singleton: true,
        ddl: `CREATE TABLE protagonist_info ( -- 主角信息表
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 人物名称
  gender_age TEXT NOT NULL, -- 性别/年龄
  appearance TEXT, -- 外貌特征
  occupation TEXT, -- 职业/身份
  past_experience TEXT, -- 过往经历
  personality TEXT -- 性格特点
);`,
    },
    important_characters: {
        name: '重要角色表',
        headers: IMPORTANT_CHARACTER_HEADERS,
        ddl: `CREATE TABLE important_characters ( -- 重要角色表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL UNIQUE, -- 姓名
  gender_age TEXT NOT NULL, -- 性别/年龄
  brief_intro TEXT, -- 一句话介绍
  appearance TEXT, -- 外貌特征
  key_items TEXT, -- 持有的重要物品
  is_absent TEXT NOT NULL DEFAULT '否', -- 是否离场
  past_experience TEXT -- 过往经历
);`,
    },
    protagonist_skills: {
        name: '主角技能表',
        headers: ['row_id', '技能名称', '技能类型', '等级/阶段', '效果描述'],
        ddl: `CREATE TABLE protagonist_skills ( -- 主角技能表
  row_id INTEGER PRIMARY KEY, -- 行号
  skill_name TEXT NOT NULL UNIQUE, -- 技能名称
  skill_type TEXT NOT NULL, -- 技能类型
  skill_level TEXT, -- 等级/阶段
  effect_desc TEXT -- 效果描述
);`,
    },
    inventory: {
        name: '背包物品表',
        headers: ['row_id', '物品名称', '数量', '描述/效果', '类别'],
        ddl: `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL UNIQUE, -- 物品名称
  quantity INTEGER NOT NULL DEFAULT 1, -- 数量
  description TEXT, -- 描述/效果
  category TEXT NOT NULL -- 类别
);`,
    },
    quests_events: {
        name: '任务与事件表',
        headers: ['row_id', '任务名称', '任务类型', '发布者', '详细描述', '当前进度', '任务时限', '奖励', '惩罚'],
        ddl: `CREATE TABLE quests_events ( -- 任务与事件表
  row_id INTEGER PRIMARY KEY, -- 行号
  quest_name TEXT NOT NULL UNIQUE, -- 任务名称
  quest_type TEXT NOT NULL, -- 任务类型
  issuer TEXT, -- 发布者
  detail_desc TEXT, -- 详细描述
  current_progress TEXT, -- 当前进度
  time_limit TEXT, -- 任务时限
  reward TEXT, -- 奖励
  penalty TEXT -- 惩罚
);`,
    },
    options: {
        name: '选项表',
        headers: ['row_id', '选项一', '选项二', '选项三', '选项四'],
        singleton: true,
        ddl: `CREATE TABLE options ( -- 选项表
  row_id INTEGER PRIMARY KEY, -- 行号
  option_1 TEXT NOT NULL, -- 选项一
  option_2 TEXT NOT NULL, -- 选项二
  option_3 TEXT NOT NULL, -- 选项三
  option_4 TEXT NOT NULL -- 选项四
);`,
    },
};

const TABLE_ALLOWED_OPERATIONS = {
    global_state: ['updateRow'],
    protagonist_info: ['updateRow'],
    important_characters: ['updateRow', 'insertRow'],
    protagonist_skills: ['updateRow', 'insertRow', 'deleteRow'],
    inventory: ['updateRow', 'insertRow', 'deleteRow'],
    quests_events: ['updateRow', 'insertRow', 'deleteRow'],
    options: ['updateRow'],
};

const TABLE_WRITE_CONSTRAINTS = {
    important_characters: {
        uniqueColumn: 'name',
        requiredColumns: ['name', 'gender_age', 'is_absent'],
        defaults: { is_absent: '否' },
        allowedValues: { is_absent: ['是', '否'] },
    },
    protagonist_skills: {
        uniqueColumn: 'skill_name',
        requiredColumns: ['skill_name', 'skill_type'],
    },
    inventory: {
        uniqueColumn: 'item_name',
        requiredColumns: ['item_name', 'quantity', 'category'],
        defaults: { quantity: '1' },
        positiveIntegerColumns: ['quantity'],
    },
    quests_events: {
        uniqueColumn: 'quest_name',
        requiredColumns: ['quest_name', 'quest_type'],
    },
};

const defaultSettings = {
    enabled: true,
    position: extension_prompt_types.IN_CHAT,
    depth: 0,
    role: extension_prompt_roles.SYSTEM,
    provideToMemory: true,
    updateInterval: 0,
    updateHistoryMessages: 20,
    includeMemorySummary: true,
    showBottomBar: true,
    tables: {
        global_state: true,
        protagonist_info: true,
        important_characters: false,
        protagonist_skills: true,
        inventory: false,
        quests_events: false,
        options: false,
    },
};

let lastSnapshot = null;
let lastFormattedText = '';
let activePopupTab = 'global_state';
let bottomBarExpanded = false;

function loadSettings() {
    if (!extension_settings.protagonistState) {
        extension_settings.protagonistState = {};
    }
    const settings = extension_settings.protagonistState;
    for (const key of Object.keys(defaultSettings)) {
        if (settings[key] === undefined) settings[key] = defaultSettings[key];
    }
    settings.tables = { ...defaultSettings.tables, ...settings.tables };

    $('#protagonist_state_enabled').prop('checked', settings.enabled).trigger('input');
    $('#protagonist_state_position').val(settings.position).trigger('change');
    $('#protagonist_state_depth').val(settings.depth).trigger('input');
    $('#protagonist_state_role').val(settings.role).trigger('change');
    $('#protagonist_state_provide_to_memory').prop('checked', settings.provideToMemory).trigger('input');
    $('#protagonist_state_update_interval').val(settings.updateInterval).trigger('input');
    $('#protagonist_state_update_history_messages').val(settings.updateHistoryMessages).trigger('input');
    $('#protagonist_state_include_memory_summary').prop('checked', settings.includeMemorySummary).trigger('input');
    $('#protagonist_state_show_bottom_bar').prop('checked', settings.showBottomBar).trigger('input');

    for (const tableKey of Object.keys(SHEET_MAP).map(k => SHEET_MAP[k].key)) {
        $(`#protagonist_state_table_${tableKey}`).prop('checked', settings.tables[tableKey]).trigger('input');
    }
}

function saveSettings() { saveSettingsDebounced(); }

// ── Read ──────────────────────────────────────────────────────────────
function getSheetRows(sheetData) {
    if (!sheetData) return [];
    if (Array.isArray(sheetData.content)) return sheetData.content;
    if (Array.isArray(sheetData)) return sheetData;
    return [];
}

function parseDDLColumns(ddl) {
    if (!ddl || typeof ddl !== 'string') return [];
    const columns = [];
    const skip = ['CREATE TABLE', 'CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', ')', '--'];
    const typeRe = /^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+(INTEGER|TEXT|REAL|NUMERIC|BLOB|INT|VARCHAR|CHAR|FLOAT|DOUBLE|DECIMAL|BOOLEAN|JSON|DATE|DATETIME|TIME)\b/i;
    for (const line of ddl.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (skip.some(p => t.toUpperCase().startsWith(p))) continue;
        const m = t.match(typeRe);
        if (m) columns.push(m[1]);
    }
    return columns;
}

function sheetContentToObjects(sheetData, englishColumns) {
    const content = getSheetRows(sheetData);
    if (!content.length) return [];
    return content.slice(1).map(row => {
        const obj = {};
        if (Array.isArray(englishColumns) && englishColumns.length) {
            for (let i = 0; i < englishColumns.length; i++) obj[englishColumns[i]] = row[i];
        } else {
            const headers = content[0];
            for (let i = 0; i < headers.length; i++) {
                if (headers[i] != null) obj[String(headers[i])] = row[i];
            }
        }
        return obj;
    });
}

function getEnglishColumns(sheetData, tableKey) {
    const ddl = sheetData?.sourceData?.ddl;
    const parsed = ddl ? parseDDLColumns(ddl) : [];
    return parsed.length ? parsed : (TABLE_COLUMNS[tableKey] || []);
}

function cloneValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function isBlankCellValue(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

function normalizeUniqueCellValue(value) {
    return String(value ?? '').trim().toLocaleLowerCase();
}

function validateConstrainedRow(tableKey, content, columns, row, { operation, previousRow = null, rowIndex = -1 } = {}) {
    const constraints = TABLE_WRITE_CONSTRAINTS[tableKey];
    if (!constraints) return null;

    for (const column of constraints.requiredColumns || []) {
        const columnIndex = columns.indexOf(column);
        const wasSupplied = operation === 'insertRow'
            || (previousRow && row[columnIndex] !== previousRow[columnIndex]);
        if (wasSupplied && isBlankCellValue(row[columnIndex])) {
            return `${operation} for ${tableKey} requires a non-empty ${column}.`;
        }
    }

    for (const [column, allowed] of Object.entries(constraints.allowedValues || {})) {
        const columnIndex = columns.indexOf(column);
        const wasSupplied = operation === 'insertRow'
            || (previousRow && row[columnIndex] !== previousRow[columnIndex]);
        if (wasSupplied && !allowed.includes(String(row[columnIndex] ?? '').trim())) {
            return `Column "${column}" in ${tableKey} must be one of: ${allowed.join(', ')}.`;
        }
    }

    for (const column of constraints.positiveIntegerColumns || []) {
        const columnIndex = columns.indexOf(column);
        const wasSupplied = operation === 'insertRow'
            || (previousRow && row[columnIndex] !== previousRow[columnIndex]);
        const number = Number(row[columnIndex]);
        if (wasSupplied && (!Number.isInteger(number) || number <= 0)) {
            return `Column "${column}" in ${tableKey} must be a positive integer.`;
        }
    }

    const uniqueColumn = constraints.uniqueColumn;
    if (uniqueColumn) {
        const columnIndex = columns.indexOf(uniqueColumn);
        const value = normalizeUniqueCellValue(row[columnIndex]);
        const previousValue = previousRow ? normalizeUniqueCellValue(previousRow[columnIndex]) : null;
        if (operation === 'insertRow' || value !== previousValue) {
            const duplicate = content.some((candidate, candidateIndex) => candidateIndex > 0
                && candidateIndex !== rowIndex
                && normalizeUniqueCellValue(candidate?.[columnIndex]) === value);
            if (duplicate) {
                return `${tableKey}.${uniqueColumn} must be unique; "${String(row[columnIndex]).trim()}" already exists. Use updateRow for the existing row.`;
            }
        }
    }
    return null;
}

function mergePastExperienceValues(legacyValue, currentValue) {
    const legacy = String(legacyValue ?? '').trim();
    const current = String(currentValue ?? '').trim();
    if (!legacy) return current;
    if (!current) return legacy;
    if (legacy === current) return legacy;
    if (current.includes(legacy)) return current;
    if (legacy.includes(current)) return legacy;
    return `${legacy}\n${current}`;
}

function normalizeKnownSheetLayouts(snapshot) {
    const sheet = snapshot?.[TABLE_TO_SHEET.important_characters];
    const content = sheet?.content;
    if (!Array.isArray(content) || !Array.isArray(content[0])) return 0;
    const header = content[0];
    const legacyLabels = header.slice(1).map(value => String(value ?? '').trim());
    const isLegacyLayout = header.length === 7
        && LEGACY_IMPORTANT_CHARACTER_HEADERS.every((label, index) => legacyLabels[index] === label);
    if (!isLegacyLayout) return 0;

    sheet.content = [IMPORTANT_CHARACTER_HEADERS, ...content.slice(1).map(row => {
        if (!Array.isArray(row)) return row;
        return [
            row[0],
            row[1],
            row[2],
            '',
            row[3],
            row[4],
            row[5],
            mergePastExperienceValues(row[6], row[7]),
        ];
    })];
    return 1;
}

function normalizeSnapshotRowIds(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return 0;
    let repairedCount = 0;
    for (const sheetKey of Object.keys(SHEET_MAP)) {
        const content = snapshot[sheetKey]?.content;
        if (!Array.isArray(content)) continue;
        const usedIds = new Set();
        const rowsToRepair = [];
        for (let rowIndex = 1; rowIndex < content.length; rowIndex++) {
            const row = content[rowIndex];
            if (!Array.isArray(row)) continue;
            const numericId = Number(row[0]);
            const validId = row[0] !== ''
                && row[0] !== null
                && row[0] !== undefined
                && Number.isInteger(numericId)
                && numericId > 0
                && !usedIds.has(numericId);
            if (validId) usedIds.add(numericId);
            else rowsToRepair.push(row);
        }
        let nextId = 1;
        for (const row of rowsToRepair) {
            while (usedIds.has(nextId)) nextId++;
            row[0] = nextId;
            usedIds.add(nextId);
            nextId++;
            repairedCount++;
        }
    }
    return repairedCount;
}

function createInitialStateSnapshot() {
    const snapshot = {};
    let orderNo = 0;
    for (const [sheetKey, info] of Object.entries(SHEET_MAP)) {
        const definition = INITIAL_SHEET_DEFINITIONS[info.key];
        const headers = [...definition.headers];
        const content = [headers];
        if (definition.singleton) content.push([1, ...new Array(headers.length - 1).fill('')]);
        snapshot[sheetKey] = {
            uid: sheetKey,
            name: definition.name,
            sourceData: { ddl: definition.ddl },
            content,
            updateConfig: {
                uiSentinel: -1,
                contextDepth: -1,
                updateFrequency: -1,
                batchSize: -1,
                skipFloors: -1,
            },
            orderNo: orderNo++,
        };
    }
    return snapshot;
}

function prepareStateUpdateSnapshot(chat) {
    const existing = readDatabaseSnapshot(chat);
    return existing
        ? { snapshot: existing, initializing: false }
        : { snapshot: createInitialStateSnapshot(), initializing: true };
}

function detectIsolationKey(chat) {
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const counts = {};
    const scanLimit = Math.min(chat.length, 30);
    for (let i = chat.length - 1; i >= Math.max(0, chat.length - scanLimit); i--) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        const iso = msg.TavernDB_ACU_IsolatedData;
        if (!iso || typeof iso !== 'object') continue;
        for (const k of Object.keys(iso)) counts[k] = (counts[k] || 0) + 1;
    }
    let bestKey = '';
    let bestCount = counts[''] || 0;
    for (const [k, c] of Object.entries(counts)) {
        if (k && c > bestCount) { bestKey = k; bestCount = c; }
    }
    return bestKey;
}

function applyTableDelta(baseSheet, delta) {
    if (!baseSheet || typeof baseSheet !== 'object') return null;
    const result = JSON.parse(JSON.stringify(baseSheet));
    if (!Array.isArray(result.content)) return result;
    if (delta.metaChanged && typeof delta.metaChanged === 'object') {
        for (const k of ['name', 'orderNo', 'updateConfig', 'exportConfig', 'sourceData']) {
            if (delta.metaChanged[k] !== undefined) result[k] = delta.metaChanged[k];
        }
    }
    const rowMap = new Map();
    for (let i = 0; i < result.content.length; i++) {
        const row = result.content[i];
        if (Array.isArray(row) && row[0] != null) rowMap.set(row[0], i);
    }
    const toDelete = new Set();
    for (const rd of (delta.rowDeltas || [])) {
        if (rd.op === 'delete') {
            const idx = rowMap.get(rd.row_id);
            if (idx !== undefined) toDelete.add(idx);
        } else if (rd.op === 'upsert') {
            const idx = rowMap.get(rd.row_id);
            if (idx !== undefined) result.content[idx] = rd.cells;
            else { result.content.push(rd.cells); rowMap.set(rd.row_id, result.content.length - 1); }
        }
    }
    if (toDelete.size) {
        for (const idx of [...toDelete].sort((a, b) => b - a)) result.content.splice(idx, 1);
    }
    return result;
}

function isDeltaTagData(tagData) { return tagData && tagData._acu_storage_mode === 'delta'; }

function readDatabaseSnapshot(chat) {
    if (!Array.isArray(chat) || chat.length === 0) return null;
    const isolationKey = detectIsolationKey(chat);
    const merged = {};
    const covered = new Set();
    const pendingDeltas = [];
    const knownSheets = Object.keys(SHEET_MAP);

    function collect(data) {
        const newly = [];
        if (!data || typeof data !== 'object') return newly;
        for (const sk of Object.keys(data)) {
            if (!sk.startsWith('sheet_') || isDiscardedSheet(sk, data[sk]) || covered.has(sk)) continue;
            const table = data[sk];
            if (!table || typeof table !== 'object') continue;
            merged[sk] = JSON.parse(JSON.stringify(table));
            covered.add(sk);
            newly.push(sk);
        }
        return newly;
    }
    function applyPending() {
        if (!pendingDeltas.length) return;
        pendingDeltas.reverse();
        for (const inc of pendingDeltas) {
            for (const sk of Object.keys(inc)) {
                if (!merged[sk]) continue;
                try { merged[sk] = applyTableDelta(merged[sk], inc[sk]); }
                catch (e) { console.warn(`[ProtagonistState] delta apply failed for ${sk}:`, e); }
            }
        }
        pendingDeltas.length = 0;
    }

    try {
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;
            const iso = msg?.TavernDB_ACU_IsolatedData?.[isolationKey];
            if (iso && typeof iso === 'object') {
                if (isDeltaTagData(iso)) {
                    if (iso.incrementalData) pendingDeltas.push(iso.incrementalData);
                } else if (collect(iso.independentData).length) {
                    applyPending();
                }
            }
            if (isolationKey === '') {
                let collected = false;
                if (collect(msg.TavernDB_ACU_IndependentData).length) collected = true;
                for (const legacyField of ['TavernDB_ACU_Data', 'TavernDB_ACU_SummaryData']) {
                    const ld = msg[legacyField];
                    if (ld && typeof ld === 'object') {
                        const filtered = {};
                        for (const k of Object.keys(ld)) if (k.startsWith('sheet_')) filtered[k] = ld[k];
                        if (collect(filtered).length) collected = true;
                    }
                }
                if (collected) applyPending();
            }
            if (knownSheets.every(k => covered.has(k))) break;
        }
    } catch (e) {
        console.warn('[ProtagonistState] read snapshot failed:', e);
        return null;
    }
    if (!Object.keys(merged).length) return null;
    normalizeKnownSheetLayouts(merged);
    normalizeSnapshotRowIds(merged);
    return merged;
}

// ── Write ─────────────────────────────────────────────────────────────
function isSameChatContext(expectedContext, currentContext = getContext()) {
    if (!expectedContext || !currentContext) return false;
    return currentContext.groupId === expectedContext.groupId
        && currentContext.chatId === expectedContext.chatId
        && (currentContext.groupId || currentContext.characterId === expectedContext.characterId);
}

function isTargetStillCurrent(expectedContext, target, requireLatestAssistant = false) {
    const currentContext = getContext();
    const currentTarget = currentContext.chat?.[target.index];
    const unchanged = isSameChatContext(expectedContext, currentContext)
        && currentTarget === target.assistantMessage
        && getStringHash(currentTarget?.mes || '') === target.messageHash;
    if (!unchanged || !requireLatestAssistant) return unchanged;
    for (let index = currentContext.chat.length - 1; index >= 0; index--) {
        const message = currentContext.chat[index];
        if (message && !message.is_user && !message.is_system && String(message.mes || '').trim()) {
            return index === target.index && message === target.assistantMessage;
        }
    }
    return false;
}

async function writeSnapshotToChat(snapshot, expectedContext = null, target = null, markerValue = undefined) {
    const context = getContext();
    if (expectedContext && !isSameChatContext(expectedContext, context)) return false;
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return false;
    const isolationKey = detectIsolationKey(chat);
    let targetIdx = target?.index ?? -1;
    if (target) {
        if (!isTargetStillCurrent(expectedContext || context, target, true)) return false;
    } else {
        // Manual edits use the latest non-user message; API updates always pass
        // their exact target so an in-flight result cannot drift to a newer turn.
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user) { targetIdx = i; break; }
        }
    }
    if (targetIdx === -1) targetIdx = chat.length - 1;
    const msg = chat[targetIdx];
    if (!msg) return false;
    const hadIsolationData = Object.hasOwn(msg, 'TavernDB_ACU_IsolatedData');
    const previousIsolationData = hadIsolationData ? cloneValue(msg.TavernDB_ACU_IsolatedData) : undefined;
    const hadExtra = Object.hasOwn(msg, 'extra');
    const hadMarker = Object.hasOwn(msg.extra || {}, 'protagonist_state_updated');
    const previousMarker = msg.extra?.protagonist_state_updated;
    if (!msg.TavernDB_ACU_IsolatedData || typeof msg.TavernDB_ACU_IsolatedData !== 'object') {
        msg.TavernDB_ACU_IsolatedData = {};
    }
    msg.TavernDB_ACU_IsolatedData[isolationKey] = {
        independentData: JSON.parse(JSON.stringify(snapshot)),
        modifiedKeys: [],
        updateGroupKeys: [],
        _acu_storage_mode: 'checkpoint',
        _acu_storage_version: 1,
    };
    if (markerValue !== undefined) {
        msg.extra = msg.extra || {};
        msg.extra.protagonist_state_updated = markerValue;
    }
    try {
        await context.saveChat();
        return true;
    } catch (e) {
        if (hadIsolationData) msg.TavernDB_ACU_IsolatedData = previousIsolationData;
        else delete msg.TavernDB_ACU_IsolatedData;
        if (markerValue !== undefined) {
            if (hadMarker) {
                msg.extra = msg.extra || {};
                msg.extra.protagonist_state_updated = previousMarker;
            } else if (msg.extra) {
                delete msg.extra.protagonist_state_updated;
                if (!hadExtra && !Object.keys(msg.extra).length) delete msg.extra;
            }
        }
        console.error('[ProtagonistState] saveChat failed:', e);
        toastr.error('保存聊天失败');
        return false;
    }
}

// ── <tableEdit> parsing ───────────────────────────────────────────────
function extractTableEditBlock(text) {
    if (typeof text !== 'string') return null;
    const re = /<tableEdit>([\s\S]*?)<\/tableEdit>/ig;
    let last = null, found = false, m;
    while ((m = re.exec(text)) !== null) { last = m[1]; found = true; }
    if (found) return last;
    // Comment-wrapped fallback
    const cRe = /<!--([\s\S]*?)-->/g;
    while ((m = cRe.exec(text)) !== null) {
        if (/(insertRow|updateRow|deleteRow)\s*\(/.test(m[1])) last = m[1];
    }
    return last;
}

function parseLenientObject(str) {
    if (!str) return {};
    let s = str.trim();
    // Preserve valid strict JSON verbatim, including apostrophes inside values.
    try { return JSON.parse(s); } catch { /* try legacy lenient forms below */ }
    // Quote unquoted keys
    s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    // Single quotes -> double quotes
    s = s.replace(/'/g, '"');
    try { return JSON.parse(s); } catch { return null; }
}

function parseStructuredEditsDetailed(editsString) {
    const ops = [];
    const errors = [];
    const cleaned = editsString.replace(/<!--|-->/g, '');
    const updateRe = /^updateRow\s*\(\s*(['"])([^'"]+)\1\s*,\s*(\d+)\s*,\s*(\{.*\})\s*\)$/i;
    const insertRe = /^insertRow\s*\(\s*(['"])([^'"]+)\1\s*,\s*(\{.*\})\s*\)$/i;
    const deleteRe = /^deleteRow\s*\(\s*(['"])([^'"]+)\1\s*,\s*(\d+)\s*\)$/i;
    for (const rawLine of cleaned.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/;$/, '').trim();
        if (!line) continue;
        let match = line.match(updateRe);
        if (match) {
            const cells = parseLenientObject(match[4]);
            if (cells) ops.push({ op: 'updateRow', table: match[2], rowId: Number(match[3]), cells });
            else errors.push(`Could not parse updateRow cells for ${match[2]}.`);
            continue;
        }
        match = line.match(insertRe);
        if (match) {
            const cells = parseLenientObject(match[3]);
            if (cells) ops.push({ op: 'insertRow', table: match[2], cells });
            else errors.push(`Could not parse insertRow cells for ${match[2]}.`);
            continue;
        }
        match = line.match(deleteRe);
        if (match) {
            ops.push({ op: 'deleteRow', table: match[2], rowId: Number(match[3]) });
            continue;
        }
        errors.push(`Unparseable <tableEdit> line: ${line.slice(0, 120)}`);
    }
    return { ops, errors };
}

function parseStructuredEdits(editsString) {
    return parseStructuredEditsDetailed(editsString).ops;
}

function applyEditsToSnapshot(snapshot, ops) {
    if (!snapshot || !Array.isArray(ops)) {
        return { ok: false, snapshot, appliedCount: 0, changedCount: 0, repairedCount: 0, errors: ['Missing snapshot or operations.'] };
    }
    const working = cloneValue(snapshot);
    normalizeKnownSheetLayouts(working);
    const repairedCount = normalizeSnapshotRowIds(working);
    let appliedCount = 0;
    let changedCount = 0;
    const errors = [];

    for (const op of ops) {
        const sheetKey = TABLE_TO_SHEET[op.table];
        const allowed = TABLE_ALLOWED_OPERATIONS[op.table];
        if (!sheetKey || !working[sheetKey] || !allowed) {
            errors.push(`Unknown table "${op.table}".`);
            break;
        }
        if (!allowed.includes(op.op)) {
            errors.push(`${op.op} is not allowed for ${op.table}.`);
            break;
        }
        const sheet = working[sheetKey];
        const cols = getEnglishColumns(sheet, op.table);
        const content = sheet.content;
        if (!Array.isArray(content) || !Array.isArray(content[0]) || !cols.length || cols[0] !== 'row_id') {
            errors.push(`Table ${op.table} has an invalid schema or content shape.`);
            break;
        }

        if (op.op !== 'deleteRow') {
            if (!op.cells || typeof op.cells !== 'object' || Array.isArray(op.cells) || !Object.keys(op.cells).length) {
                errors.push(`${op.op} for ${op.table} has no cell values.`);
                break;
            }
            for (const [column, value] of Object.entries(op.cells)) {
                if (column === 'row_id') {
                    errors.push('row_id cannot be changed or supplied by the model.');
                    break;
                }
                if (!cols.includes(column)) {
                    errors.push(`Unknown column "${column}" in ${op.table}.`);
                    break;
                }
                if (value !== null && typeof value === 'object') {
                    errors.push(`Column "${column}" in ${op.table} must contain a scalar value.`);
                    break;
                }
            }
            if (errors.length) break;
        }

        if (op.op === 'updateRow' || op.op === 'deleteRow') {
            if (!Number.isInteger(op.rowId) || op.rowId <= 0) {
                errors.push(`Invalid row_id ${op.rowId} for ${op.table}.`);
                break;
            }
            const rowIdx = content.findIndex((r, i) => i > 0 && r && r[0] == op.rowId);
            if (rowIdx === -1) {
                errors.push(`row_id ${op.rowId} was not found in ${op.table}.`);
                break;
            }
            if (op.op === 'deleteRow') {
                content.splice(rowIdx, 1);
                changedCount++;
            } else {
                const newRow = [...content[rowIdx]];
                for (const [k, v] of Object.entries(op.cells)) {
                    const ci = cols.indexOf(k);
                    newRow[ci] = v;
                }
                const constraintError = validateConstrainedRow(op.table, content, cols, newRow, {
                    operation: op.op,
                    previousRow: content[rowIdx],
                    rowIndex: rowIdx,
                });
                if (constraintError) {
                    errors.push(constraintError);
                    break;
                }
                if (JSON.stringify(newRow) !== JSON.stringify(content[rowIdx])) changedCount++;
                content[rowIdx] = newRow;
            }
        } else if (op.op === 'insertRow') {
            const maxId = content.reduce((mx, r, i) => (i > 0 && r && r[0] != null ? Math.max(mx, Number(r[0]) || 0) : mx), 0);
            const newRow = new Array(cols.length).fill('');
            newRow[0] = maxId + 1;
            const insertCells = { ...(TABLE_WRITE_CONSTRAINTS[op.table]?.defaults || {}), ...op.cells };
            for (const [k, v] of Object.entries(insertCells)) {
                const ci = cols.indexOf(k);
                if (ci !== -1) newRow[ci] = v;
            }
            const constraintError = validateConstrainedRow(op.table, content, cols, newRow, { operation: op.op });
            if (constraintError) {
                errors.push(constraintError);
                break;
            }
            content.push(newRow);
            changedCount++;
        }
        sheet.content = content;
        appliedCount++;
    }

    if (errors.length) {
        return { ok: false, snapshot, appliedCount: 0, changedCount: 0, repairedCount: 0, errors };
    }
    return { ok: true, snapshot: working, appliedCount, changedCount, repairedCount, errors: [] };
}

function processTableEditResponse(aiResponse, snapshot) {
    const block = extractTableEditBlock(aiResponse);
    if (block === null) {
        return { ok: false, snapshot, appliedCount: 0, changedCount: 0, repairedCount: 0, errors: ['No valid <tableEdit> block was returned.'] };
    }
    if (!block.trim()) {
        const working = cloneValue(snapshot);
        normalizeKnownSheetLayouts(working);
        const repairedCount = normalizeSnapshotRowIds(working);
        return { ok: true, snapshot: working, appliedCount: 0, changedCount: 0, repairedCount, errors: [] };
    }
    const parsed = parseStructuredEditsDetailed(block);
    if (parsed.errors.length) {
        return { ok: false, snapshot, appliedCount: 0, changedCount: 0, repairedCount: 0, errors: parsed.errors };
    }
    if (!parsed.ops.length) {
        return { ok: false, snapshot, appliedCount: 0, changedCount: 0, repairedCount: 0, errors: ['The non-empty <tableEdit> block contains no parseable operations.'] };
    }
    return applyEditsToSnapshot(snapshot, parsed.ops);
}

async function applyTableEditFromResponse(aiResponse, options = {}) {
    const context = options.context || getContext();
    if (options.context && !isSameChatContext(options.context)) return false;
    const snapshot = options.snapshot || readDatabaseSnapshot(context.chat);
    if (!snapshot) return false;
    const result = processTableEditResponse(aiResponse, snapshot);
    if (!result.ok) {
        console.warn('[ProtagonistState] tableEdit rejected:', result.errors.join(' '));
        return false;
    }
    if (!result.appliedCount && !result.repairedCount) return false;
    const saved = await writeSnapshotToChat(result.snapshot, options.context || null, options.target || null);
    if (!saved) return false;
    lastSnapshot = result.snapshot;
    updatePromptInjection();
    renderBottomBar();
    toastr.success(`Applied ${result.changedCount} state change${result.changedCount === 1 ? '' : 's'}.`);
    return true;
}

// ── Format ────────────────────────────────────────────────────────────
function truncateText(text, maxLength) {
    if (!text) return '';
    text = text.trim();
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

function buildCurrentStateText() {
    const settings = extension_settings.protagonistState;
    if (!settings?.enabled) return '';
    const context = getContext();
    const snapshot = readDatabaseSnapshot(context.chat);
    lastSnapshot = snapshot;
    if (!snapshot) { lastFormattedText = ''; return ''; }

    const sections = [];
    for (const [sheetKey, info] of Object.entries(SHEET_MAP)) {
        const tableKey = info.key;
        if (!settings.tables[tableKey]) continue;
        const sheet = snapshot[sheetKey];
        if (!sheet) continue;
        const cols = getEnglishColumns(sheet, tableKey);
        const rows = sheetContentToObjects(sheet, cols);
        if (!rows.length) continue;
        const formatted = formatTable(tableKey, rows);
        if (!formatted.trim()) continue;
        // State injection is deliberately lossless: selected tables are sent in
        // full so the model never receives a fabricated trailing ellipsis.
        sections.push(`[${info.name}]\n${formatted}`);
    }
    if (!sections.length) { lastFormattedText = ''; return ''; }
    const fullText = `[Current Protagonist State]\n\n${sections.join('\n\n')}`;
    lastFormattedText = fullText;
    return lastFormattedText;
}

function formatTable(tableKey, rows) {
    const r0 = rows[0] || {};
    switch (tableKey) {
        case 'global_state': {
            const p = [];
            if (r0.current_location) p.push(`Location: ${r0.current_location}`);
            if (r0.cur_time) p.push(`Time: ${r0.cur_time}`);
            if (r0.prev_scene_time) p.push(`Previous Time: ${r0.prev_scene_time}`);
            if (r0.elapsed_time) p.push(`Elapsed: ${r0.elapsed_time}`);
            return p.join(' | ');
        }
        case 'protagonist_info': {
            const p = [];
            if (r0.char_name) p.push(`Name: ${r0.char_name}`);
            if (r0.gender_age) p.push(`Gender/Age: ${r0.gender_age}`);
            if (r0.appearance) p.push(`Appearance: ${r0.appearance}`);
            if (r0.occupation) p.push(`Occupation: ${r0.occupation}`);
            if (r0.past_experience) p.push(`Past: ${r0.past_experience}`);
            if (r0.personality) p.push(`Personality: ${r0.personality}`);
            return p.join('\n');
        }
        case 'important_characters':
            return rows.map(r => {
                const absent = r.is_absent === '是' ? ' [Absent]' : '';
                const details = [];
                if (r.gender_age) details.push(`Gender/Age: ${r.gender_age}`);
                if (r.brief_intro) details.push(`Intro: ${r.brief_intro}`);
                if (r.appearance) details.push(`Appearance: ${r.appearance}`);
                if (r.key_items) details.push(`Items: ${r.key_items}`);
                if (r.past_experience) details.push(`Past: ${r.past_experience}`);
                return `- ${r.name || 'Unnamed'}${absent}${details.length ? ` | ${details.join(' | ')}` : ''}`;
            }).join('\n');
        case 'protagonist_skills':
            return rows.map(r => `- ${r.skill_name || 'Unnamed'}${r.skill_type ? ` [${r.skill_type}]` : ''}${r.skill_level ? ` (${r.skill_level})` : ''}: ${r.effect_desc || ''}`).join('\n');
        case 'inventory':
            return rows.map(r => `- ${r.item_name || 'Unnamed'} ${r.quantity != null ? `x${r.quantity}` : ''}${r.category ? ` [${r.category}]` : ''}: ${r.description || ''}`).join('\n');
        case 'quests_events':
            return rows.map(r => {
                const details = [];
                if (r.issuer) details.push(`Issuer: ${r.issuer}`);
                if (r.detail_desc) details.push(`Details: ${r.detail_desc}`);
                if (r.current_progress) details.push(`Progress: ${r.current_progress}`);
                if (r.time_limit) details.push(`Deadline: ${r.time_limit}`);
                if (r.reward) details.push(`Reward: ${r.reward}`);
                if (r.penalty) details.push(`Penalty: ${r.penalty}`);
                return `- ${r.quest_name || 'Unnamed'}${r.quest_type ? ` [${r.quest_type}]` : ''}${details.length ? ` | ${details.join(' | ')}` : ''}`;
            }).join('\n');
        case 'options': {
            const p = [];
            for (let i = 1; i <= 4; i++) if (r0[`option_${i}`]) p.push(`${i}. ${r0[`option_${i}`]}`);
            return p.join('\n');
        }
    }
    return '';
}

function getCurrentStateTextForMemory() {
    const settings = extension_settings.protagonistState;
    if (!settings?.enabled || !settings?.provideToMemory) return '';
    return buildCurrentStateText();
}

function getTimelineContextForMemory() {
    const fallback = { location: '未明确', currentTime: '未明确', previousTime: '未明确', elapsedTime: '未明确' };
    try {
        const snapshot = readDatabaseSnapshot(getContext().chat);
        const sheet = snapshot?.[TABLE_TO_SHEET.global_state];
        if (!sheet) return fallback;
        const row = sheetContentToObjects(sheet, getEnglishColumns(sheet, 'global_state'))[0] || {};
        return {
            location: String(row.current_location || fallback.location),
            currentTime: String(row.cur_time || fallback.currentTime),
            previousTime: String(row.prev_scene_time || fallback.previousTime),
            elapsedTime: String(row.elapsed_time || fallback.elapsedTime),
        };
    } catch (error) {
        console.warn('[ProtagonistState] Failed to read timeline context:', error);
        return fallback;
    }
}

// ── State update API ──────────────────────────────────────────────────
function buildStateUpdateSchema() {
    return Object.values(SHEET_MAP).map(info => {
        const columns = TABLE_COLUMNS[info.key] || [];
        return `- ${info.key}: ${columns.join(', ')}`;
    }).join('\n');
}

function buildStructuredStateForUpdate(snapshot) {
    const tables = {};
    for (const [sheetKey, info] of Object.entries(SHEET_MAP)) {
        const sheet = snapshot?.[sheetKey];
        if (!sheet) continue;
        const columns = getEnglishColumns(sheet, info.key);
        tables[info.key] = {
            columns,
            rows: sheetContentToObjects(sheet, columns),
        };
    }
    return JSON.stringify(tables, null, 2);
}

function buildStateUpdateSystemPrompt(initializing = false) {
    const initializationInstructions = initializing ? `
This request initializes the first protagonist-state snapshot for this chat. The singleton rows already exist as row_id 1 but their cells may be blank. Use updateRow to populate clearly established global_state, protagonist_info, and options fields. Use insertRow for clearly established important characters, skills, inventory, and quests. Reconstruct the current state and durable background conclusions from all supplied conversation history and optional Memory Summary, rather than limiting the edit to the final turn. Leave facts blank or omit them when the supplied context does not establish them; never invent initialization data.
` : '';
    return `You update the protagonist-state database after a completed roleplay turn.

Use only the exact table and English column names below. Keep existing row_id values when updating or deleting a row. For insertRow, omit row_id; it is assigned automatically.

${buildStateUpdateSchema()}

Return only one <tableEdit> block and no Markdown, explanation, or dialogue. Use one operation per line and strict JSON with double-quoted keys and string values:
<tableEdit>
updateRow('global_state', 1, {"current_location":"Market","cur_time":"2026-07-10 10:00"})
insertRow('inventory', {"item_name":"Healing potion","quantity":"1","description":"Bought at the market","category":"Consumable"})
deleteRow('quests_events', 3)
</tableEdit>

Allowed operations are strict:
- global_state, protagonist_info, options: updateRow only; never insert or delete their single row.
- important_characters: updateRow or insertRow; never delete.
- protagonist_skills, inventory, quests_events: updateRow, insertRow, or deleteRow.
- Never include row_id inside the JSON cells object.
- Before insertRow, compare the table's existing business key: important_characters.name, protagonist_skills.skill_name, inventory.item_name, or quests_events.quest_name. If it already exists, update that row instead of inserting a duplicate.
- insertRow must include all required identity fields: important_characters requires name and gender_age (is_absent defaults to 否); protagonist_skills requires skill_name and skill_type; inventory requires item_name and category (quantity defaults to 1); quests_events requires quest_name and quest_type.
- Never clear a required identity field. inventory.quantity must remain a positive integer, and important_characters.is_absent must be exactly 是 or 否.
${initializationInstructions}

State-table content policy:
- Memory Summary stores the detailed event history. The protagonist-state tables store only current facts and compact conclusions that remain useful in later scenes. Use conversation history and Memory Summary as evidence, but do not copy their scene-by-scene narration into table cells.
- protagonist_info.past_experience is a compact growth and identity history. Keep major background facts, lasting identity changes, and pivotal milestones in roughly 200-300 Chinese characters or a comparable length in another language. Rewrite and compress the whole field when it materially changes; never mechanically append a new scene recap.
- important_characters.brief_intro is an objective identity and story-role description of about 20 Chinese characters or a comparable short phrase. Do not put opinions or scene narration there.
- important_characters.appearance contains stable, identifying physical features. Temporary clothing, poses, expressions, or momentary conditions belong only when the history clearly establishes that they will remain relevant.
- important_characters.key_items is a concise semicolon-separated list of possessions that the character currently holds and that have continuing relevance to identity, capability, relationships, access, obligations, or future events. Keep this definition setting-neutral and omit ordinary possessions.
- important_characters.is_absent only answers whether the character can directly participate in the protagonist's current scene.
- important_characters.past_experience is a compact relationship history: stable background, the character's current relationship to the protagonist, major relationship transitions, and shared events that still affect future behavior. Keep it in roughly 80-160 Chinese characters or a comparable length in another language.
- For important_characters.past_experience, retain durable changes such as hostility becoming cooperation, trust gained or lost, betrayal and reconciliation, consequential promises, secrets, agreements, or relationship confirmation. Remove routine dialogue, action-by-action combat, travel paths, temporary emotions, ordinary interactions, and details already preserved by Memory Summary.
- When an important character materially changes this turn, rewrite and compress the entire past_experience field into "stable background -> major relationship transition -> current relationship or stance" as applicable. Do not append a chronological scene log. If the character's identity, relationship, stance, or lasting condition did not materially change, do not update that row merely to restyle or shorten it.
- protagonist_skills, inventory, and quests_events contain current effective facts only. Do not append acquisition sequences, scene narration, or obsolete historical states to their descriptive fields.
- All length targets above are soft guidance. Preserve essential facts and never truncate a value solely to hit a number.

Only include changes clearly established by the supplied conversation history. Preserve all unrelated data. Do not infer or invent changes that are not in that history. Vague phrases such as "at dusk", "later", or "after a while" do not justify inventing an exact timestamp or elapsed duration. Update cur_time, prev_scene_time, or elapsed_time only when the history states an exact time or an explicit duration that can be calculated from the current state. A clearly established location transition may update current_location by itself. If there is no state change, return exactly <tableEdit></tableEdit>.`;
}

function getStateUpdateTarget(context, messageId = null) {
    const chat = context.chat || [];
    let index = Number.isInteger(messageId) ? messageId : -1;
    if (index < 0 || index >= chat.length) {
        index = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (message && !message.is_user && !message.is_system && String(message.mes || '').trim()) {
                index = i;
                break;
            }
        }
    }
    const assistantMessage = chat[index];
    if (!assistantMessage || assistantMessage.is_user || assistantMessage.is_system || !String(assistantMessage.mes || '').trim()) {
        return null;
    }

    let userMessage = '';
    for (let i = index - 1; i >= 0; i--) {
        if (chat[i]?.is_user && String(chat[i].mes || '').trim()) {
            userMessage = String(chat[i].mes).trim();
            break;
        }
    }
    return { index, assistantMessage, userMessage, messageHash: getStringHash(assistantMessage.mes) };
}

function selectUpdateHistoryMessages(chat, throughIndex, maxMessages) {
    const history = (chat || []).slice(0, throughIndex + 1).filter(message => (
        message && !message.is_system && String(message.mes || '').trim()
    ));
    const limit = Math.max(0, Number(maxMessages) || 0);
    return limit === 0 ? history : history.slice(-limit);
}

function formatUpdateHistory(messages) {
    if (!messages.length) return '(No user or assistant messages available)';
    return messages.map(message => {
        const role = message.is_user ? 'User' : 'Assistant';
        return `[${role}]\n${String(message.mes).trim()}`;
    }).join('\n\n');
}

function getMemorySummaryText() {
    return String(window.memoryExtension?.getSummaryText?.() || '');
}

function buildStateUpdateRequestMessages(snapshot, context, target, { initializing = false } = {}) {
    const settings = { ...defaultSettings, ...(extension_settings.protagonistState || {}) };
    const history = selectUpdateHistoryMessages(context.chat, target.index, settings.updateHistoryMessages);
    const sections = [
        `[Current structured state]\n${buildStructuredStateForUpdate(snapshot)}`,
        `[Conversation history]\n${formatUpdateHistory(history)}`,
    ];
    const summary = settings.includeMemorySummary ? getMemorySummaryText().trim() : '';
    if (summary) sections.push(`[Memory Summary]\n${summary}`);
    return [
        { role: 'system', content: buildStateUpdateSystemPrompt(initializing) },
        { role: 'user', content: sections.join('\n\n') },
    ];
}

function getMemoryApiSettings() {
    return window.memoryExtension?.getSettings?.() || extension_settings.memory || null;
}

async function requestStateUpdate(messages) {
    const memorySettings = getMemoryApiSettings();
    if (!memorySettings) throw new Error('Configure the Summarize extension before updating protagonist state.');

    if (memorySettings.source === 'main') {
        return String(await generateRaw({
            prompt: messages[1].content,
            systemPrompt: messages[0].content,
            responseLength: Number(memorySettings.overrideResponseLength) > 0 ? Number(memorySettings.overrideResponseLength) : null,
        }));
    }

    if (memorySettings.source !== 'custom') {
        throw new Error('The Summarize extension has an invalid API source.');
    }

    const customKey = memorySettings.custom_key || '';
    const requestBody = {
        chat_completion_source: 'custom',
        custom_url: String(memorySettings.custom_url || '').replace(/\/+$/, ''),
        custom_include_headers: customKey ? `Authorization: Bearer ${customKey}` : '',
        model: memorySettings.custom_model || '',
        messages,
        temperature: Number(memorySettings.custom_temp),
        stream: false,
    };
    if (Number(memorySettings.custom_max_tokens) > 0) {
        requestBody.max_tokens = Number(memorySettings.custom_max_tokens);
    }

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error?.message || errorData.error || response.statusText);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || data.error);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('The state update API returned no content.');
    return String(content);
}

let stateUpdateInProgress = false;

async function updateStateForMessage(messageId = null, { force = false, quiet = false } = {}) {
    if (stateUpdateInProgress) return false;
    const context = getContext();
    const target = getStateUpdateTarget(context, messageId);
    if (!target) {
        if (!quiet) toastr.warning('No completed assistant message is available for a state update.');
        return false;
    }
    if (!force && target.assistantMessage.extra?.protagonist_state_updated) return false;

    const { snapshot, initializing } = prepareStateUpdateSnapshot(context.chat);

    stateUpdateInProgress = true;
    const toastMessage = initializing ? 'Initializing protagonist state...' : 'Updating protagonist state...';
    const toast = quiet ? null : toastr.info(toastMessage, 'Please wait', { timeOut: 0, extendedTimeOut: 0 });
    try {
        const messages = buildStateUpdateRequestMessages(snapshot, context, target, { initializing });
        const responseText = await requestStateUpdate(messages);
        if (!isTargetStillCurrent(context, target)) return false;
        if (!/<tableEdit\b[\s\S]*?<\/tableEdit>/i.test(responseText)) {
            throw new Error('The state update API returned no valid tableEdit block.');
        }

        const result = processTableEditResponse(responseText, snapshot);
        if (!result.ok) throw new Error(result.errors.join(' '));
        if (!isTargetStillCurrent(context, target, true)) return false;
        const saved = await writeSnapshotToChat(result.snapshot, context, target, Date.now());
        if (!saved) throw new Error('The protagonist-state snapshot could not be saved to its target message.');
        lastSnapshot = result.snapshot;
        updatePromptInjection();
        refreshStateEditors(result.snapshot);
        if (!quiet) {
            if (result.changedCount > 0) {
                toastr.success(`Applied ${result.changedCount} state change${result.changedCount === 1 ? '' : 's'}.`);
            } else if (result.repairedCount > 0) {
                toastr.success(`Repaired ${result.repairedCount} state row ID${result.repairedCount === 1 ? '' : 's'}.`);
            } else {
                toastr.info('No database changes were returned for this turn.');
            }
        }
        return true;
    } catch (error) {
        console.error('[ProtagonistState] update failed:', error);
        if (!quiet) toastr.error(error.message || String(error), 'State update failed');
        return false;
    } finally {
        if (toast) toastr.clear(toast);
        stateUpdateInProgress = false;
    }
}

// ── Prompt injection ──────────────────────────────────────────────────
function updatePromptInjection() {
    const settings = extension_settings.protagonistState;
    if (!settings?.enabled || Number(settings.position) === extension_prompt_types.NONE) {
        setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, 0);
        return;
    }
    const text = buildCurrentStateText();
    if (!text) { setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, 0); return; }
    setExtensionPrompt(MODULE_NAME, text, settings.position, settings.depth, false, settings.role);
}
const updatePromptInjectionDebounced = debounce(updatePromptInjection, debounce_timeout.default);

// ── Bottom bar ────────────────────────────────────────────────────────
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function getSelectedTableKeys(snapshot) {
    const settings = extension_settings.protagonistState;
    return Object.entries(SHEET_MAP)
        .filter(([sheetKey, info]) => settings?.tables?.[info.key] && snapshot?.[sheetKey])
        .map(([, info]) => info.key);
}

function renderEditableStateRecords(snapshot, tableKey, extraClass = '') {
    const sheetKey = TABLE_TO_SHEET[tableKey];
    const sheet = snapshot?.[sheetKey];
    if (!sheet) return '<div class="ps_empty">此表无数据</div>';

    const columns = getEnglishColumns(sheet, tableKey);
    const content = getSheetRows(sheet);
    const headers = Array.isArray(content[0]) ? content[0] : columns;
    let html = `<div class="ps_state_records ${extraClass}">`;
    for (let rowIndex = 1; rowIndex < content.length; rowIndex++) {
        const row = content[rowIndex] || [];
        const recordName = row[0] == null || row[0] === '' ? `记录 ${rowIndex}` : `记录 #${row[0]}`;
        html += `<section class="ps_record_card" data-table="${tableKey}" data-row="${rowIndex}">
            <div class="ps_record_header">
                <span>${escapeHtml(recordName)}</span>
                <span class="ps_row_delete" title="删除记录"><i class="fa-solid fa-trash"></i></span>
            </div>
            <div class="ps_record_fields">`;
        columns.forEach((column, columnIndex) => {
            if (column === 'row_id') return;
            html += `<div class="ps_state_field">
                <div class="ps_field_label">${escapeHtml(headers[columnIndex] ?? column)}</div>
                <div contenteditable="true" class="ps_cell" data-col="${columnIndex}" data-colname="${column}">${escapeHtml(row[columnIndex])}</div>
            </div>`;
        });
        html += '</div></section>';
    }
    if (content.length <= 1) html += '<div class="ps_empty">暂无记录，可新增一行。</div>';
    html += '</div>';
    html += `<div class="ps_table_actions"><span class="menu_button menu_button_icon ps_add_row" data-table="${tableKey}"><i class="fa-solid fa-plus"></i> 新增记录</span></div>`;
    return html;
}

function ensureSheetContent(sheet, tableKey) {
    const columns = getEnglishColumns(sheet, tableKey);
    if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) {
        sheet.content = [columns];
    }
    return sheet.content;
}

function renderMemorySummaryCard() {
    const summary = getMemorySummaryText().trim();
    const content = summary ? escapeHtml(summary).replace(/\n/g, '<br>') : '<span class="ps_bottom_empty">暂无 Summary</span>';
    return `<section class="ps_card ps_memory_card">
        <div class="ps_card_title"><i class="fa-solid fa-book-open"></i> 剧情简介 / Memory Summary</div>
        <div class="ps_card_body">${content}</div>
    </section>`;
}

function refreshStateEditors(snapshot = lastSnapshot) {
    if (!snapshot) return;
    renderBottomBar(snapshot);
    if ($('#protagonist_state_popup').is(':visible')) renderPopupBody(snapshot, true);
}

function renderBottomBar(snapshotOverride = null) {
    const settings = extension_settings.protagonistState;
    if (!settings?.showBottomBar) {
        $('#protagonist_state_bottom_bar').remove();
        return;
    }
    const context = getContext();
    const snapshot = snapshotOverride || readDatabaseSnapshot(context.chat);
    let $bar = $('#protagonist_state_bottom_bar');
    if (!$bar.length) {
        $bar = $('<div id="protagonist_state_bottom_bar" class="protagonist_state_bottom_bar"></div>');
        const $anchor = $('#form_sheld');
        if ($anchor.length) $anchor.before($bar);
        else $('#sheld').append($bar);
    }
    if (!snapshot) {
        $bar.html('<div class="ps_bottom_header"><span class="ps_bottom_title"><i class="fa-solid fa-table-list"></i> 主角状态</span><span class="ps_bottom_empty">无状态数据</span></div>');
        return;
    }
    lastSnapshot = snapshot;

    const tableKeys = getSelectedTableKeys(snapshot);
    if (!tableKeys.length) {
        $bar.html('<div class="ps_bottom_header"><span class="ps_bottom_title"><i class="fa-solid fa-table-list"></i> 主角状态</span><span class="ps_bottom_empty">未勾选可显示的表</span></div>');
        return;
    }

    const summaries = [];
    for (const tableKey of tableKeys) {
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const cols = getEnglishColumns(snapshot[sheetKey], tableKey);
        const rows = sheetContentToObjects(snapshot[sheetKey], cols);
        const formatted = formatTable(tableKey, rows);
        const name = SHEET_MAP[sheetKey].name;
        summaries.push(`<b>${escapeHtml(name)}</b> ${escapeHtml(truncateText(formatted.replace(/\n/g, ' · '), 80) || '（空）')}`);
    }

    const chevronIcon = bottomBarExpanded ? 'fa-chevron-down' : 'fa-chevron-up';

    if (bottomBarExpanded) {
        const tablesHtml = tableKeys.map(tableKey => {
            const sheetKey = TABLE_TO_SHEET[tableKey];
            const info = SHEET_MAP[sheetKey];
            const icon = TABLE_ICONS[tableKey] || 'fa-table';
            return `<section class="ps_card ps_bottom_table_card">
                <div class="ps_card_title"><i class="fa-solid ${icon}"></i> ${escapeHtml(info.name)}</div>
                ${renderEditableStateRecords(snapshot, tableKey, 'ps_bottom_records')}
            </section>`;
        }).join('');
        $bar.html(`
            <div class="ps_bottom_header" id="ps_bottom_header">
                <span class="ps_bottom_title"><i class="fa-solid fa-table-list"></i> 主角状态（可直接编辑）</span>
                <span class="ps_bottom_actions">
                    <span id="ps_open_popup" class="menu_button menu_button_icon" title="打开编辑弹窗"><i class="fa-solid fa-table"></i></span>
                    <span id="ps_bottom_toggle" class="ps_bottom_toggle" title="收起"><i class="fa-solid ${chevronIcon}"></i></span>
                </span>
            </div>
            <div class="ps_bottom_expanded">${tablesHtml}${renderMemorySummaryCard()}</div>
        `);
        $('#ps_open_popup').off('click').on('click', openStatePopup);
        $('#ps_bottom_toggle').off('click').on('click', () => { bottomBarExpanded = false; renderBottomBar(); });
    } else {
        $bar.html(`
            <div class="ps_bottom_header" id="ps_bottom_header">
                <span class="ps_bottom_collapsed">${summaries.join('  ·  ')}</span>
                <span id="ps_bottom_toggle" class="ps_bottom_toggle" title="展开"><i class="fa-solid ${chevronIcon}"></i></span>
            </div>
        `);
        $('#ps_bottom_toggle').off('click').on('click', () => { bottomBarExpanded = true; renderBottomBar(); });
        $('#ps_bottom_header').off('click').on('click', function(e) {
            if ($(e.target).closest('#ps_bottom_toggle').length) return;
            bottomBarExpanded = true; renderBottomBar();
        });
    }
}

// ── Popup ─────────────────────────────────────────────────────────────
function getFreshSnapshot() {
    const context = getContext();
    const snap = readDatabaseSnapshot(context.chat);
    lastSnapshot = snap;
    return snap;
}

function renderPopupTable(snapshot, tableKey) {
    return renderEditableStateRecords(snapshot, tableKey);
}

function renderPopupContent(snapshot) {
    const navigation = [];
    const sections = [];
    for (const [sheetKey, info] of Object.entries(SHEET_MAP)) {
        const active = activePopupTab === info.key ? ' active' : '';
        const icon = TABLE_ICONS[info.key] || 'fa-table';
        const rowCount = Math.max(0, getSheetRows(snapshot?.[sheetKey]).length - 1);
        navigation.push(`<button type="button" class="ps_nav_item${active}" data-section="${info.key}">
            <i class="fa-solid ${icon}"></i><span>${escapeHtml(info.name)}</span><small>${rowCount}</small>
        </button>`);
        sections.push(`<section id="ps_popup_section_${info.key}" class="ps_popup_section" data-section="${info.key}">
            <div class="ps_popup_section_header"><span><i class="fa-solid ${icon}"></i> ${escapeHtml(info.name)}</span><small>${rowCount} 条记录</small></div>
            ${renderPopupTable(snapshot, info.key)}
        </section>`);
    }
    const memoryActive = activePopupTab === 'memory' ? ' active' : '';
    navigation.push(`<button type="button" class="ps_nav_item${memoryActive}" data-section="memory">
        <i class="fa-solid fa-book-open"></i><span>Memory Summary</span>
    </button>`);
    sections.push(`<section id="ps_popup_section_memory" class="ps_popup_section" data-section="memory">
        <div class="ps_popup_section_header"><span><i class="fa-solid fa-book-open"></i> 剧情简介 / Memory Summary</span></div>
        ${renderMemoryTab()}
    </section>`);
    return `<div class="ps_popup_root">
        <aside class="ps_popup_sidebar">${navigation.join('')}</aside>
        <div class="ps_popup_content_scroll">${sections.join('')}</div>
    </div>`;
}

function renderMemoryTab() {
    const mem = window.memoryExtension;
    const summary = mem?.getSummaryText?.() || '';
    const escaped = summary.replace(/</g, '&lt;').replace(/\n/g, '<br>') || '<i class="ps_empty">暂无 summary</i>';
    return `<div class="ps_memory_tab">
        <div class="ps_mem_actions">
            <span id="ps_mem_summarize" class="menu_button menu_button_icon"><i class="fa-solid fa-bolt"></i> 立即总结</span>
            <span id="ps_mem_refresh" class="menu_button menu_button_icon"><i class="fa-solid fa-sync"></i> 刷新</span>
        </div>
        <div class="ps_mem_summary">${escaped}</div>
    </div>`;
}

function renderPopupBody(snapshot, preserveScroll = false) {
    const $body = $('#protagonist_state_popup .ps_popup_body');
    if (!$body.length) return;
    const scrollTop = preserveScroll ? $body.find('.ps_popup_content_scroll').scrollTop() : 0;
    $body.html(renderPopupContent(snapshot));
    $body.find('.ps_popup_content_scroll').scrollTop(scrollTop);
}

async function openStatePopup() {
    let $popup = $('#protagonist_state_popup');
    if (!$popup.length) {
        $popup = $(`
            <div id="protagonist_state_popup">
                <div class="ps_popup_header">
                    <span class="ps_popup_title"><i class="fa-solid fa-table-list"></i> 主角状态</span>
                    <span class="ps_popup_close" title="关闭"><i class="fa-solid fa-xmark"></i></span>
                </div>
                <div class="ps_popup_body"></div>
            </div>
        `);
        $('body').append($popup);
        $popup.find('.ps_popup_close').on('click', async () => {
            await flushEdits();
            $popup.hide();
        });
        makeDraggable($popup, $popup.find('.ps_popup_header'));
    }
    const snapshot = getFreshSnapshot();
    activePopupTab = 'global_state';
    renderPopupBody(snapshot);
    resetPopupPosition($popup);
    $popup.show();
}

function resetPopupPosition($popup) {
    $popup.css({
        left: '',
        right: '',
        top: '',
        marginLeft: '',
        marginRight: '',
        transform: '',
    });
}

function makeDraggable($el, $handle) {
    let dragging = false, dragStarted = false, startX = 0, startY = 0, origX = 0, origY = 0;
    $handle.on('mousedown.ps_drag', function (e) {
        if (e.button !== 0 || $(e.target).closest('button, .ps_popup_close').length) return;
        dragging = true;
        dragStarted = false;
        const rect = $el[0].getBoundingClientRect();
        origX = rect.left; origY = rect.top;
        startX = e.clientX; startY = e.clientY;
        e.preventDefault();
    });
    $(document).on('mousemove.ps_drag', function (e) {
        if (!dragging) return;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        if (!dragStarted && deltaX === 0 && deltaY === 0) return;
        dragStarted = true;
        $el.css({
            left: (origX + deltaX) + 'px',
            right: 'auto',
            top: (origY + deltaY) + 'px',
            marginLeft: 0,
            marginRight: 0,
            transform: 'none',
        });
    });
    $(document).on('mouseup.ps_drag', function () {
        dragging = false;
        dragStarted = false;
    });
}

function setActivePopupSection(section) {
    activePopupTab = section;
    $('#protagonist_state_popup .ps_nav_item').each(function () {
        $(this).toggleClass('active', $(this).data('section') === section);
    });
}

function bindPopupEvents() {
    $(document).off('.ps_popup').on('click.ps_popup', '.ps_nav_item', function () {
        const section = $(this).data('section');
        const $scrollArea = $(this).closest('.ps_popup_root').find('.ps_popup_content_scroll');
        const $target = $scrollArea.find(`#ps_popup_section_${section}`);
        if (!$target.length) return;
        setActivePopupSection(section);
        const targetTop = $target[0].getBoundingClientRect().top - $scrollArea[0].getBoundingClientRect().top + $scrollArea.scrollTop();
        $scrollArea.stop(true).animate({ scrollTop: Math.max(0, targetTop - 10) }, 220);
    }).on('scroll.ps_popup', '.ps_popup_content_scroll', function () {
        const containerTop = this.getBoundingClientRect().top;
        let active = 'global_state';
        $(this).find('.ps_popup_section').each(function () {
            if (this.getBoundingClientRect().top <= containerTop + 40) active = $(this).data('section');
        });
        setActivePopupSection(active);
    });
    $(document).on('click.ps_popup', '.ps_add_row', function () {
        const tableKey = $(this).data('table');
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet) return;
        const cols = getEnglishColumns(sheet, tableKey);
        const content = ensureSheetContent(sheet, tableKey);
        const maxId = content.reduce((mx, r, i) => (i > 0 && r && r[0] != null ? Math.max(mx, Number(r[0]) || 0) : mx), 0);
        const newRow = new Array(cols.length).fill('');
        newRow[0] = maxId + 1;
        content.push(newRow);
        sheet.content = content;
        markDirty();
        refreshStateEditors(snapshot);
    });
    $(document).on('click.ps_popup', '.ps_row_delete', function () {
        const $record = $(this).closest('.ps_record_card');
        const tableKey = $record.data('table');
        const ri = Number($record.data('row'));
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet || !Array.isArray(sheet.content)) return;
        sheet.content.splice(ri, 1);
        markDirty();
        refreshStateEditors(snapshot);
    });
    $(document).on('blur.ps_popup', '.ps_cell', function () {
        const $td = $(this);
        const $record = $td.closest('.ps_record_card');
        const tableKey = $record.data('table');
        const ri = Number($record.data('row'));
        const ci = Number($td.data('col'));
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet || !Array.isArray(sheet.content) || !sheet.content[ri]) return;
        sheet.content[ri][ci] = $td.text();
        markDirty();
        renderBottomBar(snapshot);
    });
    $(document).on('click.ps_popup', '#ps_mem_summarize', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        try { await window.memoryExtension?.summarizeNow?.(false); }
        catch (e) { console.error(e); toastr.error('总结失败'); }
        finally { $btn.prop('disabled', false); }
        renderPopupBody(lastSnapshot || getFreshSnapshot(), true);
        renderBottomBar();
    });
    $(document).on('click.ps_popup', '#ps_mem_refresh', function () {
        renderPopupBody(lastSnapshot || getFreshSnapshot(), true);
    });
}

let dirty = false;
async function persistManualSnapshot() {
    if (!lastSnapshot) return false;
    const saved = await writeSnapshotToChat(lastSnapshot);
    if (!saved) {
        lastSnapshot = readDatabaseSnapshot(getContext().chat);
        refreshStateEditors(lastSnapshot);
        return false;
    }
    updatePromptInjection();
    renderBottomBar(lastSnapshot);
    return true;
}
const flushEditsDebounced = debounce(async () => {
    if (!dirty) return;
    dirty = false;
    await persistManualSnapshot();
}, 800);
function markDirty() { dirty = true; flushEditsDebounced(); }
async function flushEdits() { if (dirty) { dirty = false; await persistManualSnapshot(); } }

// ── Events ────────────────────────────────────────────────────────────
function onChatChanged() {
    lastSnapshot = null; lastFormattedText = '';
    updatePromptInjection(); renderBottomBar();
    if ($('#protagonist_state_popup').is(':visible')) {
        renderPopupBody(getFreshSnapshot(), true);
    }
}
function onGenerationEnded() {
    updatePromptInjectionDebounced();
    renderBottomBar();
}

function hasStateUpdateMarker(message) {
    return message?.extra?.protagonist_state_updated !== undefined
        && message?.extra?.protagonist_state_updated !== null;
}

function getAssistantTurnsSinceStateUpdate(chat, throughIndex = chat.length - 1) {
    let markerIndex = -1;
    for (let i = Math.min(throughIndex, chat.length - 1); i >= 0; i--) {
        if (hasStateUpdateMarker(chat[i])) {
            markerIndex = i;
            break;
        }
    }
    return chat.slice(markerIndex + 1, throughIndex + 1).filter(message => (
        message && !message.is_user && !message.is_system && String(message.mes || '').trim()
    )).length;
}

async function onCharacterMessageRendered(messageId) {
    onGenerationEnded();
    const interval = Math.max(0, Number(extension_settings.protagonistState?.updateInterval) || 0);
    if (interval === 0) return;

    const context = getContext();
    const throughIndex = Number.isInteger(Number(messageId))
        ? Number(messageId)
        : (context.chat?.length || 1) - 1;
    if (getAssistantTurnsSinceStateUpdate(context.chat || [], throughIndex) < interval) return;
    await updateStateForMessage(Number(messageId), { quiet: true });
}

function onEnabledInput() { extension_settings.protagonistState.enabled = $(this).prop('checked'); saveSettings(); updatePromptInjection(); renderBottomBar(); }
function onPositionChange() { extension_settings.protagonistState.position = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onDepthInput() { extension_settings.protagonistState.depth = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onRoleChange() { extension_settings.protagonistState.role = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onProvideToMemoryInput() { extension_settings.protagonistState.provideToMemory = $(this).prop('checked'); saveSettings(); }
function onUpdateIntervalInput() {
    extension_settings.protagonistState.updateInterval = Math.max(0, Number($(this).val()) || 0);
    $(this).val(extension_settings.protagonistState.updateInterval);
    saveSettings();
}
function onUpdateHistoryMessagesInput() {
    extension_settings.protagonistState.updateHistoryMessages = Math.max(0, Number($(this).val()) || 0);
    $(this).val(extension_settings.protagonistState.updateHistoryMessages);
    saveSettings();
}
function onIncludeMemorySummaryInput() {
    extension_settings.protagonistState.includeMemorySummary = $(this).prop('checked');
    saveSettings();
}
function onShowBottomBarInput() { extension_settings.protagonistState.showBottomBar = $(this).prop('checked'); saveSettings(); renderBottomBar(); }
function onTableToggle() { const tk = $(this).data('table'); extension_settings.protagonistState.tables[tk] = $(this).prop('checked'); saveSettings(); updatePromptInjection(); renderBottomBar(); }
function onOpenPopupClick() { openStatePopup(); }
async function onUpdateNowClick() { await updateStateForMessage(null, { force: true }); }

function setupListeners() {
    $('#protagonist_state_enabled').off('input').on('input', onEnabledInput);
    $('#protagonist_state_position').off('change').on('change', onPositionChange);
    $('#protagonist_state_depth').off('input').on('input', onDepthInput);
    $('#protagonist_state_role').off('change').on('change', onRoleChange);
    $('#protagonist_state_provide_to_memory').off('input').on('input', onProvideToMemoryInput);
    $('#protagonist_state_update_interval').off('input').on('input', onUpdateIntervalInput);
    $('#protagonist_state_update_history_messages').off('input').on('input', onUpdateHistoryMessagesInput);
    $('#protagonist_state_include_memory_summary').off('input').on('input', onIncludeMemorySummaryInput);
    $('#protagonist_state_show_bottom_bar').off('input').on('input', onShowBottomBarInput);
    $('#protagonist_state_open_popup').off('click').on('click', onOpenPopupClick);
    $('#protagonist_state_update_now').off('click').on('click', onUpdateNowClick);
    for (const tableKey of Object.keys(SHEET_MAP).map(k => SHEET_MAP[k].key)) {
        $(`#protagonist_state_table_${tableKey}`).off('input').on('input', onTableToggle);
    }
    $(document).off('input.ps_memory_summary', '#memory_contents').on('input.ps_memory_summary', '#memory_contents', () => renderBottomBar());
    bindPopupEvents();
}

export async function init() {
    const settingsHtml = await renderExtensionTemplateAsync('protagonist-state', 'settings', { defaultSettings });
    $('#extensions_settings').append(settingsHtml);
    loadSettings();
    setupListeners();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.MESSAGE_DELETED, onGenerationEnded);
    eventSource.on(event_types.MESSAGE_SWIPED, onGenerationEnded);

    window.protagonistStateExtension = {
        getCurrentStateText: getCurrentStateTextForMemory,
        getTimelineContext: getTimelineContextForMemory,
        getLastSnapshot: () => lastSnapshot,
        getSettings: () => extension_settings.protagonistState,
        openPopup: openStatePopup,
        applyTableEdit: applyTableEditFromResponse,
        updateNow: () => updateStateForMessage(null, { force: true }),
    };

    updatePromptInjection();
    renderBottomBar();
}
