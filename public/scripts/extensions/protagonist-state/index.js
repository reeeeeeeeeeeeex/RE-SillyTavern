import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../script.js';
import { getContext, extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { debounce_timeout } from '../../constants.js';
import { debounce } from '../../utils.js';

const MODULE_NAME = 'protagonist_state';

// Sheet key mapping discovered from SP·数据库 III plugin.
// These UIDs point to the default tables; user custom tables will be ignored unless added here.
const SHEET_MAP = {
    'sheet_dCudvUnH': { key: 'global_state', name: 'Global State' },
    'sheet_DpKcVGqg': { key: 'protagonist_info', name: 'Protagonist Info' },
    'sheet_lEARaBa8': { key: 'protagonist_skills', name: 'Protagonist Skills' },
    'sheet_in05z9vz': { key: 'inventory', name: 'Inventory' },
    'sheet_etak47Ve': { key: 'quests_events', name: 'Quests & Events' },
    'sheet_3NoMc1wI': { key: 'chronicle', name: 'Chronicle' },
};

const TABLE_CONFIG = {
    global_state: {
        label: '全局状态（时间/地点）',
        columns: ['current_location', 'cur_time', 'prev_scene_time', 'elapsed_time'],
        format: (rows) => {
            const r = rows[0] || {};
            const parts = [];
            if (r.current_location) parts.push(`Location: ${r.current_location}`);
            if (r.cur_time) parts.push(`Time: ${r.cur_time}`);
            if (r.prev_scene_time) parts.push(`Previous Time: ${r.prev_scene_time}`);
            if (r.elapsed_time) parts.push(`Elapsed: ${r.elapsed_time}`);
            return parts.join(' | ');
        },
    },
    protagonist_info: {
        label: '主角信息（身份/外貌/性格）',
        columns: ['char_name', 'gender_age', 'appearance', 'occupation', 'past_experience', 'personality'],
        format: (rows) => {
            const r = rows[0] || {};
            const parts = [];
            if (r.char_name) parts.push(`Name: ${r.char_name}`);
            if (r.gender_age) parts.push(`Gender/Age: ${r.gender_age}`);
            if (r.appearance) parts.push(`Appearance: ${r.appearance}`);
            if (r.occupation) parts.push(`Occupation: ${r.occupation}`);
            if (r.past_experience) parts.push(`Past: ${r.past_experience}`);
            if (r.personality) parts.push(`Personality: ${r.personality}`);
            return parts.join('\n');
        },
    },
    protagonist_skills: {
        label: '主角技能',
        columns: ['skill_name', 'skill_type', 'skill_level', 'effect_desc'],
        format: (rows) => {
            if (!rows.length) return '';
            return rows.map(r => {
                const name = r.skill_name || 'Unnamed';
                const type = r.skill_type || '';
                const level = r.skill_level || '';
                const effect = r.effect_desc || '';
                return `- ${name}${type ? ` [${type}]` : ''}${level ? ` (${level})` : ''}: ${effect}`;
            }).join('\n');
        },
    },
    inventory: {
        label: '背包物品',
        columns: ['item_name', 'quantity', 'description', 'category'],
        format: (rows) => {
            if (!rows.length) return '';
            return rows.map(r => {
                const qty = r.quantity !== undefined ? `x${r.quantity}` : '';
                const cat = r.category || '';
                return `- ${r.item_name || 'Unnamed'} ${qty}${cat ? ` [${cat}]` : ''}: ${r.description || ''}`;
            }).join('\n');
        },
    },
    quests_events: {
        label: '任务与事件',
        columns: ['quest_name', 'quest_type', 'issuer', 'detail_desc', 'current_progress', 'time_limit', 'reward', 'penalty'],
        format: (rows) => {
            if (!rows.length) return '';
            return rows.map(r => {
                const type = r.quest_type || '';
                const progress = r.current_progress || '';
                return `- ${r.quest_name || 'Unnamed'}${type ? ` [${type}]` : ''}${progress ? ` - ${progress}` : ''}`;
            }).join('\n');
        },
    },
    chronicle: {
        label: '纪要',
        columns: ['time_span', 'location', 'chronicle_text', 'summary'],
        format: (rows) => {
            if (!rows.length) return '';
            // Take last N rows (most recent)
            const recent = rows.slice(-3);
            return recent.map(r => `- ${r.time_span || ''} ${r.location || ''}: ${r.summary || r.chronicle_text || ''}`).join('\n');
        },
    },
};

const defaultSettings = {
    enabled: true,
    position: extension_prompt_types.IN_CHAT,
    depth: 0,
    role: extension_prompt_roles.SYSTEM,
    maxTotalLength: 1500,
    provideToMemory: true,
    tables: {
        global_state: true,
        protagonist_info: true,
        protagonist_skills: true,
        inventory: false,
        quests_events: false,
        chronicle: false,
    },
    tableLimits: {
        global_state: 200,
        protagonist_info: 400,
        protagonist_skills: 400,
        inventory: 300,
        quests_events: 400,
        chronicle: 300,
    },
};

let lastSnapshot = null;
let lastFormattedText = '';

function loadSettings() {
    if (!extension_settings.protagonistState) {
        extension_settings.protagonistState = {};
    }

    const settings = extension_settings.protagonistState;
    for (const key of Object.keys(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = defaultSettings[key];
        }
    }

    // Ensure nested defaults.
    settings.tables = { ...defaultSettings.tables, ...settings.tables };
    settings.tableLimits = { ...defaultSettings.tableLimits, ...settings.tableLimits };

    // UI binding
    $('#protagonist_state_enabled').prop('checked', settings.enabled).trigger('input');
    $('#protagonist_state_position').val(settings.position).trigger('change');
    $('#protagonist_state_depth').val(settings.depth).trigger('input');
    $('#protagonist_state_role').val(settings.role).trigger('change');
    $('#protagonist_state_max_total_length').val(settings.maxTotalLength).trigger('input');
    $('#protagonist_state_provide_to_memory').prop('checked', settings.provideToMemory).trigger('input');

    for (const tableKey of Object.keys(TABLE_CONFIG)) {
        $(`#protagonist_state_table_${tableKey}`).prop('checked', settings.tables[tableKey]).trigger('input');
        $(`#protagonist_state_limit_${tableKey}`).val(settings.tableLimits[tableKey]).trigger('input');
    }
}

function saveSettings() {
    saveSettingsDebounced();
}

function getSheetRows(sheetData) {
    if (!sheetData) return [];
    if (Array.isArray(sheetData.content)) return sheetData.content;
    if (Array.isArray(sheetData)) return sheetData;
    return [];
}

/**
 * Read the latest database snapshot from chat message tags.
 * The SP·数据库 III plugin stores snapshots in msg.TavernDB_ACU_IsolatedData[isolationKey].
 */
function readDatabaseSnapshot(chat) {
    if (!Array.isArray(chat) || chat.length === 0) {
        return null;
    }

    // TODO: read dataIsolationCode from plugin settings if exposed; default empty string.
    const isolationKey = '';
    const merged = {};
    const covered = new Set();

    try {
        for (let i = chat.length - 1; i >= 0; i--) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;

            const isoData = msg?.TavernDB_ACU_IsolatedData?.[isolationKey];
            if (!isoData || typeof isoData !== 'object') continue;

            const mode = isoData._acu_storage_mode;
            const data = isoData.independentData || {};

            for (const sheetKey of Object.keys(data)) {
                if (!sheetKey.startsWith('sheet_') || covered.has(sheetKey)) continue;
                const table = data[sheetKey];
                if (!table || typeof table !== 'object') continue;
                merged[sheetKey] = table;
                covered.add(sheetKey);
            }

            // If we hit a checkpoint and have collected all known sheets, stop.
            if (mode === 'checkpoint' || mode === 'legacy' || !mode) {
                const knownSheets = Object.keys(SHEET_MAP);
                if (knownSheets.every(k => covered.has(k))) {
                    break;
                }
            }
        }
    } catch (e) {
        console.warn('[ProtagonistState] Failed to read database snapshot:', e);
        return null;
    }

    return Object.keys(merged).length > 0 ? merged : null;
}

function getKnownTableData(snapshot, tableKey) {
    const sheetKey = Object.keys(SHEET_MAP).find(k => SHEET_MAP[k].key === tableKey);
    if (!sheetKey || !snapshot) return [];
    return getSheetRows(snapshot[sheetKey]);
}

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

    if (!snapshot) {
        lastFormattedText = '';
        return '';
    }

    const sections = [];
    for (const [tableKey, config] of Object.entries(TABLE_CONFIG)) {
        if (!settings.tables[tableKey]) continue;
        const rows = getKnownTableData(snapshot, tableKey);
        if (!rows.length) continue;
        const formatted = config.format(rows);
        if (!formatted.trim()) continue;
        const limit = settings.tableLimits[tableKey] || 500;
        sections.push(`[${config.label}]\n${truncateText(formatted, limit)}`);
    }

    if (!sections.length) {
        lastFormattedText = '';
        return '';
    }

    const fullText = `[Current Protagonist State]\n\n${sections.join('\n\n')}`;
    lastFormattedText = truncateText(fullText, settings.maxTotalLength || 2000);
    return lastFormattedText;
}

function updatePromptInjection() {
    const settings = extension_settings.protagonistState;
    if (!settings?.enabled || Number(settings.position) === extension_prompt_types.NONE) {
        setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, 0);
        return;
    }

    const text = buildCurrentStateText();
    if (!text) {
        setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, 0);
        return;
    }

    setExtensionPrompt(
        MODULE_NAME,
        text,
        settings.position,
        settings.depth,
        false,
        settings.role,
    );
}

const updatePromptInjectionDebounced = debounce(updatePromptInjection, debounce_timeout.default);

function updateVisualizerPanel() {
    const text = buildCurrentStateText();
    const $panel = $('#protagonist_state_panel_content');
    if ($panel.length) {
        $panel.text(text || 'No database state found. Make sure the database plugin has saved data to this chat.');
    }
}

function onChatChanged() {
    lastSnapshot = null;
    lastFormattedText = '';
    updatePromptInjection();
    updateVisualizerPanel();
}

function onGenerationEnded() {
    // State may have been updated after generation.
    updatePromptInjectionDebounced();
    updateVisualizerPanel();
}

// Settings event handlers
function onEnabledInput() {
    extension_settings.protagonistState.enabled = $(this).prop('checked');
    saveSettings();
    updatePromptInjection();
}

function onPositionChange() {
    extension_settings.protagonistState.position = Number($(this).val());
    saveSettings();
    updatePromptInjection();
}

function onDepthInput() {
    extension_settings.protagonistState.depth = Number($(this).val());
    saveSettings();
    updatePromptInjection();
}

function onRoleChange() {
    extension_settings.protagonistState.role = Number($(this).val());
    saveSettings();
    updatePromptInjection();
}

function onMaxTotalLengthInput() {
    extension_settings.protagonistState.maxTotalLength = Number($(this).val());
    saveSettings();
    updatePromptInjection();
}

function onProvideToMemoryInput() {
    extension_settings.protagonistState.provideToMemory = $(this).prop('checked');
    saveSettings();
}

function onTableToggle() {
    const tableKey = $(this).data('table');
    extension_settings.protagonistState.tables[tableKey] = $(this).prop('checked');
    saveSettings();
    updatePromptInjection();
    updateVisualizerPanel();
}

function onTableLimitInput() {
    const tableKey = $(this).data('table');
    extension_settings.protagonistState.tableLimits[tableKey] = Number($(this).val());
    saveSettings();
    updatePromptInjection();
    updateVisualizerPanel();
}

function onRefreshClick() {
    updatePromptInjection();
    updateVisualizerPanel();
    toastr.success('Protagonist state refreshed');
}

function setupListeners() {
    $('#protagonist_state_enabled').off('input').on('input', onEnabledInput);
    $('#protagonist_state_position').off('change').on('change', onPositionChange);
    $('#protagonist_state_depth').off('input').on('input', onDepthInput);
    $('#protagonist_state_role').off('change').on('change', onRoleChange);
    $('#protagonist_state_max_total_length').off('input').on('input', onMaxTotalLengthInput);
    $('#protagonist_state_provide_to_memory').off('input').on('input', onProvideToMemoryInput);
    $('#protagonist_state_refresh').off('click').on('click', onRefreshClick);

    for (const tableKey of Object.keys(TABLE_CONFIG)) {
        $(`#protagonist_state_table_${tableKey}`).off('input').on('input', onTableToggle);
        $(`#protagonist_state_limit_${tableKey}`).off('input').on('input', onTableLimitInput);
    }
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

    // Expose API for Memory extension or other consumers.
    window.protagonistStateExtension = {
        getCurrentStateText: buildCurrentStateText,
        getLastSnapshot: () => lastSnapshot,
    };

    updatePromptInjection();
    updateVisualizerPanel();
}
