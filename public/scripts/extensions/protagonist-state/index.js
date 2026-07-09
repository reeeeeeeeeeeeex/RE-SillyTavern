import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../script.js';
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { debounce_timeout } from '../../constants.js';
import { debounce } from '../../utils.js';

const MODULE_NAME = 'protagonist_state';

// Reverse-lookup helpers built from SHEET_MAP below.
const SHEET_MAP = {
    'sheet_dCudvUnH': { key: 'global_state', name: '全局状态' },
    'sheet_DpKcVGqg': { key: 'protagonist_info', name: '主角信息' },
    'sheet_NcBlYRH5': { key: 'important_characters', name: '重要角色' },
    'sheet_lEARaBa8': { key: 'protagonist_skills', name: '主角技能' },
    'sheet_in05z9vz': { key: 'inventory', name: '背包物品' },
    'sheet_etak47Ve': { key: 'quests_events', name: '任务与事件' },
    'sheet_3NoMc1wI': { key: 'chronicle', name: '纪要' },
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
    chronicle: 'fa-book',
    options: 'fa-list-ol',
};

const TABLE_COLUMNS = {
    global_state: ['row_id', 'current_location', 'cur_time', 'prev_scene_time', 'elapsed_time'],
    protagonist_info: ['row_id', 'char_name', 'gender_age', 'appearance', 'occupation', 'past_experience', 'personality'],
    important_characters: ['row_id', 'name', 'gender_age', 'brief_intro', 'appearance', 'key_items', 'is_absent', 'past_experience'],
    protagonist_skills: ['row_id', 'skill_name', 'skill_type', 'skill_level', 'effect_desc'],
    inventory: ['row_id', 'item_name', 'quantity', 'description', 'category'],
    quests_events: ['row_id', 'quest_name', 'quest_type', 'issuer', 'detail_desc', 'current_progress', 'time_limit', 'reward', 'penalty'],
    chronicle: ['row_id', 'time_span', 'location', 'chronicle_text', 'summary', 'code_index'],
    options: ['row_id', 'option_1', 'option_2', 'option_3', 'option_4'],
};

const defaultSettings = {
    enabled: true,
    position: extension_prompt_types.IN_CHAT,
    depth: 0,
    role: extension_prompt_roles.SYSTEM,
    maxTotalLength: 2000,
    provideToMemory: true,
    autoApplyTableEdit: true,
    showBottomBar: true,
    bottomBarTables: ['global_state', 'protagonist_info', 'options'],
    tables: {
        global_state: true,
        protagonist_info: true,
        important_characters: false,
        protagonist_skills: true,
        inventory: false,
        quests_events: false,
        chronicle: false,
        options: false,
    },
    tableLimits: {
        global_state: 200,
        protagonist_info: 400,
        important_characters: 400,
        protagonist_skills: 400,
        inventory: 300,
        quests_events: 400,
        chronicle: 300,
        options: 300,
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
    settings.tableLimits = { ...defaultSettings.tableLimits, ...settings.tableLimits };
    if (!Array.isArray(settings.bottomBarTables)) settings.bottomBarTables = [...defaultSettings.bottomBarTables];

    $('#protagonist_state_enabled').prop('checked', settings.enabled).trigger('input');
    $('#protagonist_state_position').val(settings.position).trigger('change');
    $('#protagonist_state_depth').val(settings.depth).trigger('input');
    $('#protagonist_state_role').val(settings.role).trigger('change');
    $('#protagonist_state_max_total_length').val(settings.maxTotalLength).trigger('input');
    $('#protagonist_state_provide_to_memory').prop('checked', settings.provideToMemory).trigger('input');
    $('#protagonist_state_auto_apply_table_edit').prop('checked', settings.autoApplyTableEdit).trigger('input');
    $('#protagonist_state_show_bottom_bar').prop('checked', settings.showBottomBar).trigger('input');

    for (const tableKey of Object.keys(SHEET_MAP).map(k => SHEET_MAP[k].key)) {
        $(`#protagonist_state_table_${tableKey}`).prop('checked', settings.tables[tableKey]).trigger('input');
        $(`#protagonist_state_limit_${tableKey}`).val(settings.tableLimits[tableKey]).trigger('input');
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
            if (!sk.startsWith('sheet_') || covered.has(sk)) continue;
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
    return Object.keys(merged).length > 0 ? merged : null;
}

// ── Write ─────────────────────────────────────────────────────────────
async function writeSnapshotToChat(snapshot) {
    const context = getContext();
    const chat = context.chat;
    if (!Array.isArray(chat) || chat.length === 0) return false;
    const isolationKey = detectIsolationKey(chat);
    // Find latest non-user message; fall back to last message.
    let targetIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) { targetIdx = i; break; }
    }
    if (targetIdx === -1) targetIdx = chat.length - 1;
    const msg = chat[targetIdx];
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
    try {
        await context.saveChat();
        return true;
    } catch (e) {
        console.error('[ProtagonistState] saveChat failed:', e);
        toastr.error('保存聊天失败');
        return false;
    }
}

// ── <tableEdit> parsing ───────────────────────────────────────────────
function extractTableEditBlock(text) {
    if (typeof text !== 'string') return null;
    const re = /<tableEdit>([\s\S]*?)<\/tableEdit>/ig;
    let last = null, m;
    while ((m = re.exec(text)) !== null) last = m[1];
    if (last) return last;
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
    // Quote unquoted keys
    s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    // Single quotes -> double quotes
    s = s.replace(/'/g, '"');
    try { return JSON.parse(s); } catch { return null; }
}

function parseStructuredEdits(editsString) {
    const ops = [];
    const cleaned = editsString.replace(/<!--|-->/g, '');
    const updateRe = /updateRow\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*,\s*(\{[\s\S]*?\})\s*\)/gi;
    const insertRe = /insertRow\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/gi;
    const deleteRe = /deleteRow\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*\)/gi;
    let m;
    while ((m = updateRe.exec(cleaned)) !== null) {
        const cells = parseLenientObject(m[3]);
        if (cells) ops.push({ op: 'updateRow', table: m[1], rowId: Number(m[2]), cells });
    }
    while ((m = insertRe.exec(cleaned)) !== null) {
        const cells = parseLenientObject(m[2]);
        if (cells) ops.push({ op: 'insertRow', table: m[1], cells });
    }
    while ((m = deleteRe.exec(cleaned)) !== null) {
        ops.push({ op: 'deleteRow', table: m[1], rowId: Number(m[2]) });
    }
    return ops;
}

function applyEditsToSnapshot(snapshot, ops) {
    if (!snapshot || !ops.length) return snapshot;
    for (const op of ops) {
        const sheetKey = TABLE_TO_SHEET[op.table];
        if (!sheetKey || !snapshot[sheetKey]) {
            console.warn(`[ProtagonistState] tableEdit: table "${op.table}" not found`);
            continue;
        }
        const sheet = snapshot[sheetKey];
        const cols = getEnglishColumns(sheet, op.table);
        const content = Array.isArray(sheet.content) ? sheet.content : [['row_id']];
        if (!Array.isArray(content[0])) content.unshift(['row_id']);

        if (op.op === 'updateRow' || op.op === 'deleteRow') {
            const rowIdx = content.findIndex((r, i) => i > 0 && r && r[0] == op.rowId);
            if (rowIdx === -1) {
                console.warn(`[ProtagonistState] row_id ${op.rowId} not found in ${op.table}`);
                continue;
            }
            if (op.op === 'deleteRow') {
                content.splice(rowIdx, 1);
            } else {
                const newRow = [...content[rowIdx]];
                for (const [k, v] of Object.entries(op.cells)) {
                    const ci = cols.indexOf(k);
                    if (ci !== -1) newRow[ci] = v;
                }
                content[rowIdx] = newRow;
            }
        } else if (op.op === 'insertRow') {
            const maxId = content.reduce((mx, r, i) => (i > 0 && r && r[0] != null ? Math.max(mx, Number(r[0]) || 0) : mx), 0);
            const newRow = new Array(cols.length).fill('');
            newRow[0] = maxId + 1;
            for (const [k, v] of Object.entries(op.cells)) {
                const ci = cols.indexOf(k);
                if (ci !== -1) newRow[ci] = v;
            }
            content.push(newRow);
        }
        sheet.content = content;
    }
    return snapshot;
}

async function applyTableEditFromResponse(aiResponse) {
    const settings = extension_settings.protagonistState;
    if (!settings?.autoApplyTableEdit) return;
    const block = extractTableEditBlock(aiResponse);
    if (!block || !block.trim()) return;
    const ops = parseStructuredEdits(block);
    if (!ops.length) return;
    const context = getContext();
    const snapshot = readDatabaseSnapshot(context.chat);
    if (!snapshot) return;
    applyEditsToSnapshot(snapshot, ops);
    await writeSnapshotToChat(snapshot);
    lastSnapshot = snapshot;
    updatePromptInjection();
    updateVisualizerPanel();
    renderBottomBar();
    toastr.success(`已应用 ${ops.length} 条表格编辑`);
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
        const limit = settings.tableLimits[tableKey] || 500;
        sections.push(`[${info.name}]\n${truncateText(formatted, limit)}`);
    }
    if (!sections.length) { lastFormattedText = ''; return ''; }
    const fullText = `[Current Protagonist State]\n\n${sections.join('\n\n')}`;
    lastFormattedText = truncateText(fullText, settings.maxTotalLength || 2000);
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
                return `- ${r.name || 'Unnamed'}${absent}${r.brief_intro ? ` - ${r.brief_intro}` : ''}${r.appearance ? ` | ${r.appearance}` : ''}${r.key_items ? ` | Items: ${r.key_items}` : ''}`;
            }).join('\n');
        case 'protagonist_skills':
            return rows.map(r => `- ${r.skill_name || 'Unnamed'}${r.skill_type ? ` [${r.skill_type}]` : ''}${r.skill_level ? ` (${r.skill_level})` : ''}: ${r.effect_desc || ''}`).join('\n');
        case 'inventory':
            return rows.map(r => `- ${r.item_name || 'Unnamed'} ${r.quantity != null ? `x${r.quantity}` : ''}${r.category ? ` [${r.category}]` : ''}: ${r.description || ''}`).join('\n');
        case 'quests_events':
            return rows.map(r => `- ${r.quest_name || 'Unnamed'}${r.quest_type ? ` [${r.quest_type}]` : ''}${r.current_progress ? ` - ${r.current_progress}` : ''}${r.reward ? ` | Reward: ${r.reward}` : ''}`).join('\n');
        case 'chronicle':
            return rows.slice(-3).map(r => `- ${r.code_index || ''} ${r.time_span || ''} ${r.location || ''}: ${r.summary || r.chronicle_text || ''}`).join('\n');
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

// ── Visualizer panel (settings) ───────────────────────────────────────
function updateVisualizerPanel() {
    const text = buildCurrentStateText();
    const $panel = $('#protagonist_state_panel_content');
    if ($panel.length) $panel.text(text || 'No database state found.');
}

// ── Bottom bar ────────────────────────────────────────────────────────
function renderBottomBar() {
    const settings = extension_settings.protagonistState;
    if (!settings?.showBottomBar) {
        $('#protagonist_state_bottom_bar').remove();
        return;
    }
    const context = getContext();
    const snapshot = readDatabaseSnapshot(context.chat);
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

    const cards = [];
    for (const tableKey of (settings.bottomBarTables || [])) {
        const sheetKey = TABLE_TO_SHEET[tableKey];
        if (!sheetKey || !snapshot[sheetKey]) continue;
        const cols = getEnglishColumns(snapshot[sheetKey], tableKey);
        const rows = sheetContentToObjects(snapshot[sheetKey], cols);
        if (!rows.length) continue;
        const formatted = formatTable(tableKey, rows);
        if (!formatted.trim()) continue;
        const icon = TABLE_ICONS[tableKey] || 'fa-table';
        const name = SHEET_MAP[sheetKey].name;
        cards.push({ name, icon, formatted });
    }

    if (!cards.length) {
        $bar.html('<div class="ps_bottom_header"><span class="ps_bottom_title"><i class="fa-solid fa-table-list"></i> 主角状态</span><span class="ps_bottom_empty">无勾选的表</span></div>');
        return;
    }

    const chevronIcon = bottomBarExpanded ? 'fa-chevron-down' : 'fa-chevron-up';

    if (bottomBarExpanded) {
        const cardsHtml = cards.map(c => {
            const escaped = c.formatted.replace(/</g, '&lt;');
            return `<div class="ps_card">
                <div class="ps_card_title"><i class="fa-solid ${c.icon}"></i> ${c.name}</div>
                <div class="ps_card_body">${escaped}</div>
            </div>`;
        }).join('');
        $bar.html(`
            <div class="ps_bottom_header" id="ps_bottom_header">
                <span class="ps_bottom_title"><i class="fa-solid fa-table-list"></i> 主角状态</span>
                <span class="ps_bottom_actions">
                    <span id="ps_open_popup" class="menu_button menu_button_icon" title="打开编辑弹窗"><i class="fa-solid fa-table"></i></span>
                    <span id="ps_bottom_toggle" class="ps_bottom_toggle" title="收起"><i class="fa-solid ${chevronIcon}"></i></span>
                </span>
            </div>
            <div class="ps_bottom_expanded">${cardsHtml}</div>
        `);
        $('#ps_open_popup').off('click').on('click', openStatePopup);
        $('#ps_bottom_toggle').off('click').on('click', () => { bottomBarExpanded = false; renderBottomBar(); });
    } else {
        const summary = cards.map(c => `<b>${c.name}</b> ${truncateText(c.formatted.replace(/\n/g, ' · '), 80)}`).join('  ·  ');
        $bar.html(`
            <div class="ps_bottom_header" id="ps_bottom_header">
                <span class="ps_bottom_collapsed">${summary}</span>
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
    const sheetKey = TABLE_TO_SHEET[tableKey];
    if (!sheetKey || !snapshot || !snapshot[sheetKey]) {
        return '<div class="ps_empty">此表无数据</div>';
    }
    const sheet = snapshot[sheetKey];
    const cols = getEnglishColumns(sheet, tableKey);
    const content = getSheetRows(sheet);
    if (!content.length) return '<div class="ps_empty">此表无数据</div>';
    const headers = content[0];
    let html = '<table class="ps_table"><thead><tr>';
    cols.forEach((c, i) => { html += `<th>${String(headers[i] ?? c).replace(/</g, '&lt;')}</th>`; });
    html += '<th class="ps_row_actions_col">操作</th></tr></thead><tbody>';
    for (let ri = 1; ri < content.length; ri++) {
        const row = content[ri] || [];
        const rowId = row[0];
        html += `<tr data-table="${tableKey}" data-row="${ri}" data-rowid="${rowId}">`;
        cols.forEach((c, ci) => {
            const val = String(row[ci] ?? '').replace(/</g, '&lt;');
            html += `<td contenteditable="true" class="ps_cell" data-col="${ci}" data-colname="${c}">${val}</td>`;
        });
        html += `<td class="ps_row_actions"><span class="ps_row_delete" title="删除行"><i class="fa-solid fa-trash"></i></span></td></tr>`;
    }
    html += '</tbody></table>';
    html += `<div class="ps_table_actions"><span class="menu_button menu_button_icon ps_add_row" data-table="${tableKey}"><i class="fa-solid fa-plus"></i> 新增行</span></div>`;
    return html;
}

function renderPopupContent(snapshot) {
    const tabs = ['<div class="ps_tabs">'];
    for (const [sheetKey, info] of Object.entries(SHEET_MAP)) {
        const active = activePopupTab === info.key ? ' active' : '';
        tabs.push(`<div class="ps_tab${active}" data-tab="${info.key}">${info.name}</div>`);
    }
    tabs.push(`<div class="ps_tab${activePopupTab === 'memory' ? ' active' : ''}" data-tab="memory">Memory</div>`);
    tabs.push('</div>');
    let body;
    if (activePopupTab === 'memory') {
        body = renderMemoryTab();
    } else {
        body = `<div class="ps_tab_body">${renderPopupTable(snapshot, activePopupTab)}</div>`;
    }
    return `<div class="ps_popup_root">${tabs.join('')}<div class="ps_tab_content">${body}</div></div>`;
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
    $popup.find('.ps_popup_body').html(renderPopupContent(snapshot));
    $popup.show();
}

function makeDraggable($el, $handle) {
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
    $handle.on('mousedown.ps_drag', function (e) {
        if ($(e.target).closest('.ps_popup_close').length) return;
        dragging = true;
        const rect = $el[0].getBoundingClientRect();
        origX = rect.left; origY = rect.top;
        startX = e.clientX; startY = e.clientY;
        $el.css({ left: origX + 'px', top: origY + 'px', transform: 'none' });
        e.preventDefault();
    });
    $(document).on('mousemove.ps_drag', function (e) {
        if (!dragging) return;
        $el.css({ left: (origX + e.clientX - startX) + 'px', top: (origY + e.clientY - startY) + 'px' });
    });
    $(document).on('mouseup.ps_drag', function () { dragging = false; });
}

function bindPopupEvents() {
    $(document).off('.ps_popup').on('click.ps_popup', '.ps_tab', function () {
        activePopupTab = $(this).data('tab');
        const snapshot = lastSnapshot || getFreshSnapshot();
        const $content = $('.ps_popup_root .ps_tab_content');
        if ($content.length) $content.html(activePopupTab === 'memory' ? renderMemoryTab() : `<div class="ps_tab_body">${renderPopupTable(snapshot, activePopupTab)}</div>`);
    });
    $(document).on('click.ps_popup', '.ps_add_row', function () {
        const tableKey = $(this).data('table');
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet) return;
        const cols = getEnglishColumns(sheet, tableKey);
        const content = Array.isArray(sheet.content) ? sheet.content : [['row_id']];
        const maxId = content.reduce((mx, r, i) => (i > 0 && r && r[0] != null ? Math.max(mx, Number(r[0]) || 0) : mx), 0);
        const newRow = new Array(cols.length).fill('');
        newRow[0] = maxId + 1;
        content.push(newRow);
        sheet.content = content;
        markDirty();
        $('.ps_popup_root .ps_tab_content').html(`<div class="ps_tab_body">${renderPopupTable(snapshot, tableKey)}</div>`);
    });
    $(document).on('click.ps_popup', '.ps_row_delete', function () {
        const $tr = $(this).closest('tr');
        const tableKey = $tr.data('table');
        const ri = Number($tr.data('row'));
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet || !Array.isArray(sheet.content)) return;
        sheet.content.splice(ri, 1);
        markDirty();
        $('.ps_popup_root .ps_tab_content').html(`<div class="ps_tab_body">${renderPopupTable(snapshot, tableKey)}</div>`);
    });
    $(document).on('blur.ps_popup', '.ps_cell', function () {
        const $td = $(this);
        const tableKey = $td.closest('tr').data('table');
        const ri = Number($td.closest('tr').data('row'));
        const ci = Number($td.data('col'));
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const sheetKey = TABLE_TO_SHEET[tableKey];
        const sheet = snapshot[sheetKey];
        if (!sheet || !Array.isArray(sheet.content) || !sheet.content[ri]) return;
        sheet.content[ri][ci] = $td.text();
        markDirty();
    });
    $(document).on('click.ps_popup', '#ps_mem_summarize', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        try { await window.memoryExtension?.summarizeNow?.(false); }
        catch (e) { console.error(e); toastr.error('总结失败'); }
        finally { $btn.prop('disabled', false); }
        $('.ps_popup_root .ps_tab_content').html(renderMemoryTab());
    });
    $(document).on('click.ps_popup', '#ps_mem_refresh', function () {
        $('.ps_popup_root .ps_tab_content').html(renderMemoryTab());
    });
}

let dirty = false;
const flushEditsDebounced = debounce(async () => {
    if (!dirty) return;
    dirty = false;
    if (lastSnapshot) {
        await writeSnapshotToChat(lastSnapshot);
        updatePromptInjection();
        updateVisualizerPanel();
        renderBottomBar();
    }
}, 800);
function markDirty() { dirty = true; flushEditsDebounced(); }
async function flushEdits() { if (dirty) { dirty = false; if (lastSnapshot) await writeSnapshotToChat(lastSnapshot); } }

// ── Events ────────────────────────────────────────────────────────────
function onChatChanged() {
    lastSnapshot = null; lastFormattedText = '';
    updatePromptInjection(); updateVisualizerPanel(); renderBottomBar();
    if ($('#protagonist_state_popup').is(':visible')) {
        $('#protagonist_state_popup .ps_popup_body').html(renderPopupContent(getFreshSnapshot()));
    }
}
function onGenerationEnded(args) {
    updatePromptInjectionDebounced();
    updateVisualizerPanel();
    renderBottomBar();
    if (args?.mes) applyTableEditFromResponse(args.mes);
}

function onEnabledInput() { extension_settings.protagonistState.enabled = $(this).prop('checked'); saveSettings(); updatePromptInjection(); renderBottomBar(); }
function onPositionChange() { extension_settings.protagonistState.position = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onDepthInput() { extension_settings.protagonistState.depth = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onRoleChange() { extension_settings.protagonistState.role = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onMaxTotalLengthInput() { extension_settings.protagonistState.maxTotalLength = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onProvideToMemoryInput() { extension_settings.protagonistState.provideToMemory = $(this).prop('checked'); saveSettings(); }
function onAutoApplyTableEditInput() { extension_settings.protagonistState.autoApplyTableEdit = $(this).prop('checked'); saveSettings(); }
function onShowBottomBarInput() { extension_settings.protagonistState.showBottomBar = $(this).prop('checked'); saveSettings(); renderBottomBar(); }
function onTableToggle() { const tk = $(this).data('table'); extension_settings.protagonistState.tables[tk] = $(this).prop('checked'); saveSettings(); updatePromptInjection(); updateVisualizerPanel(); }
function onTableLimitInput() { const tk = $(this).data('table'); extension_settings.protagonistState.tableLimits[tk] = Number($(this).val()); saveSettings(); updatePromptInjection(); }
function onRefreshClick() { updatePromptInjection(); updateVisualizerPanel(); renderBottomBar(); toastr.success('已刷新'); }
function onOpenPopupClick() { openStatePopup(); }

function setupListeners() {
    $('#protagonist_state_enabled').off('input').on('input', onEnabledInput);
    $('#protagonist_state_position').off('change').on('change', onPositionChange);
    $('#protagonist_state_depth').off('input').on('input', onDepthInput);
    $('#protagonist_state_role').off('change').on('change', onRoleChange);
    $('#protagonist_state_max_total_length').off('input').on('input', onMaxTotalLengthInput);
    $('#protagonist_state_provide_to_memory').off('input').on('input', onProvideToMemoryInput);
    $('#protagonist_state_auto_apply_table_edit').off('input').on('input', onAutoApplyTableEditInput);
    $('#protagonist_state_show_bottom_bar').off('input').on('input', onShowBottomBarInput);
    $('#protagonist_state_refresh').off('click').on('click', onRefreshClick);
    $('#protagonist_state_open_popup').off('click').on('click', onOpenPopupClick);
    for (const tableKey of Object.keys(SHEET_MAP).map(k => SHEET_MAP[k].key)) {
        $(`#protagonist_state_table_${tableKey}`).off('input').on('input', onTableToggle);
        $(`#protagonist_state_limit_${tableKey}`).off('input').on('input', onTableLimitInput);
    }
    bindPopupEvents();
}

export async function init() {
    const settingsHtml = await renderExtensionTemplateAsync('protagonist-state', 'settings', { defaultSettings });
    $('#extensions_settings').append(settingsHtml);
    loadSettings();
    setupListeners();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.MESSAGE_DELETED, onGenerationEnded);
    eventSource.on(event_types.MESSAGE_SWIPED, onGenerationEnded);

    window.protagonistStateExtension = {
        getCurrentStateText: getCurrentStateTextForMemory,
        getLastSnapshot: () => lastSnapshot,
        getSettings: () => extension_settings.protagonistState,
        openPopup: openStatePopup,
        applyTableEdit: applyTableEditFromResponse,
    };

    updatePromptInjection();
    updateVisualizerPanel();
    renderBottomBar();
}
