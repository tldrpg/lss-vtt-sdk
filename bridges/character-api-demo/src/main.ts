import {
    createBridgeSheetSource,
    type BridgeSheetSource,
    SHEET_IFRAME_SANDBOX,
    type CharacterCommand,
    type CharacterConnectionStatus,
    type CharacterSheetConnection,
    type CharacterResource,
    type CharacterResult,
    type CharacterSaveAbility,
    type CharacterSnapshot,
} from '@longstoryshort/vtt-sdk';
import { byId } from './elements';
import { createMasterDemo } from './master';
import './style.css';

type JournalEntry = { command: CharacterCommand; label: string; attempts: number; results: CharacterResult[] };

const statusLabels = {
    connecting: 'Подключаем лист…',
    waiting: 'Ожидаем выбора персонажа и вступления в группу.',
    ready: 'Лист подключён.',
    denied: 'Доступ отклонён. Повторно откройте лист, чтобы изменить решение.',
    unsupported: 'Нет ответа Character API v1. Проверьте адрес, вход и разрешённый origin.',
    disconnected: 'Связь с листом потеряна.',
} satisfies Record<CharacterConnectionStatus, string>;

const phaseLabels = {
    rolled: 'Бросок выполнен',
    applied: 'Применено в листе',
    unchanged: 'Без изменений',
    saved: 'Сохранено сервером',
    save_failed: 'Запись отклонена',
    rejected: 'Команда отклонена',
    unknown: 'Исход неизвестен',
} satisfies Record<CharacterResult['phase'], string>;

const errorLabels: Record<string, string> = {
    forbidden: 'У листа нет права записи',
    conflict: 'Серверная версия изменилась. Откройте лист заново',
    storage: 'Сервер отклонил сохранение',
    timeout: 'Истекло ожидание ответа',
    disconnected: 'Лист закрылся до подтверждения',
    save_unconfirmed: 'Лист не получил подтверждение записи',
    roll_unconfirmed: 'Лист не подтвердил результат броска',
    not_ready: 'Лист ещё не готов',
    stale_session: 'Лист открыт в новой сессии',
    revision_conflict: 'Ревизия листа изменилась',
    unsupported_action: 'Действие недоступно',
    invalid_parameters: 'Недопустимые параметры команды',
    insufficient_resource: 'Недостаточно ресурса',
    request_id_reused: 'Этот ID уже относится к другой команде',
    session_limit: 'Лимит команд сессии достигнут',
};

const actionLabels = {
    'health.damage': 'Урон',
    'health.heal': 'Лечение',
    'spell.spend-charge': 'Расход заряда',
    'weapon.roll-attack': 'Бросок атаки',
    'weapon.roll-damage': 'Бросок урона',
    'saving-throw.roll': 'Спасбросок',
    'ability-check.roll': 'Проверка характеристики',
    'skill-check.roll': 'Проверка навыка',
    'initiative.roll': 'Бросок инициативы',
    'resource.adjust': 'Ресурс',
} satisfies Record<CharacterCommand['action']['type'], string>;

const frameHost = byId('frame-host');
const masterFrameHost = byId('master-frame-host');
const masterRoomStatus = byId('master-room-status');
const playerPanel = byId('player-panel');
const masterPanel = byId('master-panel');
const switchMode = byId<HTMLButtonElement>('switch-mode');
const groupStatus = byId('group-status');
const groupPicker = byId('group-picker');
const groupFrameHost = byId('group-frame-host');
const pickGroup = byId<HTMLButtonElement>('pick-group');
const connectionStatus = byId('connection-status');
const hpCurrent = byId('hp-current');
const hpMax = byId('hp-max');
const hpTemp = byId('hp-temp');
const revision = byId('revision');
const amount = byId<HTMLInputElement>('amount');
const damage = byId<HTMLButtonElement>('damage');
const heal = byId<HTMLButtonElement>('heal');
const repeat = byId<HTMLButtonElement>('repeat');
const open = byId<HTMLButtonElement>('open');
const close = byId<HTMLButtonElement>('close');
const journal = byId('command-log');
const emptyLog = byId('empty-log');
const json = byId<HTMLDetailsElement>('json');
const jsonText = byId('json-text');
const copyStatus = byId('copy-status');
const tokenArea = byId('token-area');
const token = byId<HTMLButtonElement>('token');
const tokenCatalog = byId('token-catalog');
const attacks = byId('attacks');
const attacksEmpty = byId('attacks-empty');
const savingThrow = byId<HTMLFormElement>('saving-throw');
const saveAbility = byId<HTMLSelectElement>('save-ability');
const abilityCheck = byId<HTMLFormElement>('ability-check');
const checkAbility = byId<HTMLSelectElement>('check-ability');
const skillCheck = byId<HTMLFormElement>('skill-check');
const checkSkill = byId<HTMLSelectElement>('check-skill');
const initiative = byId('initiative');
const spells = byId('spells');
const spellsEmpty = byId('spells-empty');
const resourceSection = byId('resource-section');
const resources = byId('resources');

const entries = new Map<string, JournalEntry>();
const params = new URLSearchParams(location.search);
const master = createMasterDemo(() => getGroupUrl('create'), createFrame);
let masterMode = false;
let groupCode = params.get('groupCode')?.trim() || null;
let groupName: string | undefined;
let groupConnected: boolean | undefined;
let groupBridge: BridgeSheetSource | undefined;
let bridge: BridgeSheetSource | undefined;
let sheet: CharacterSheetConnection | undefined;
let snapshot: CharacterSnapshot | undefined;
let latestCommand: CharacterCommand | undefined;
let status: CharacterConnectionStatus = 'connecting';
let renderedCatalog: CharacterSnapshot | undefined;

function canRun(snapshot: CharacterSnapshot, action: CharacterCommand['action']) {
    if (action.type === 'resource.adjust') {
        return snapshot.resources?.some(resource => resource.id === action.resourceId && resource.canAdjust);
    }
    return snapshot.actions.some(type => type === action.type) || snapshot.rollActions?.some(type => type === action.type);
}

function renderState() {
    connectionStatus.dataset.status = status;
    connectionStatus.textContent = status === 'ready' && !snapshot?.actions.length && !snapshot?.rollActions?.length
        && !snapshot?.resources?.some(resource => resource.canAdjust)
        ? 'Лист подключён для просмотра.'
        : statusLabels[status];
    hpCurrent.textContent = String(snapshot?.hp.current ?? '—');
    hpMax.textContent = String(snapshot?.hp.max ?? '—');
    hpTemp.textContent = String(snapshot?.hp.temp ?? '—');
    revision.textContent = snapshot
        ? `Ревизия ${snapshot.revision} · сохранено по ${snapshot.savedThrough}`
        : 'Снимок появится после разрешения доступа.';
    const validAmount = Number.isSafeInteger(amount.valueAsNumber) && amount.valueAsNumber > 0;
    damage.disabled = !(status === 'ready' && validAmount && snapshot?.actions.includes('health.damage'));
    heal.disabled = !(status === 'ready' && validAmount && snapshot?.actions.includes('health.heal'));
    repeat.disabled = !(
        status === 'ready' && latestCommand && snapshot?.executionId === latestCommand.executionId &&
        snapshot.characterId === latestCommand.characterId && canRun(snapshot, latestCommand.action)
    );
    const commands = Array.from(entries.values(), ({ command, attempts, results }) => ({ command, attempts, results }));
    jsonText.textContent = JSON.stringify({ snapshot: snapshot ?? null, commands }, null, 2);
    renderCatalog();
}

function signed(value: number) {
    return value >= 0 ? `+${value}` : String(value);
}

function listEntry(name: string, summary: string) {
    const row = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = name;
    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent = summary;
    row.append(label, description);
    return row;
}

function weaponRollButton(name: string, action: Extract<CharacterCommand['action'], { weaponId: string }>) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabels[action.type];
    button.setAttribute('aria-label', `${button.textContent} — ${name}`);
    button.addEventListener('click', () => runAction(action));
    return button;
}

function resourceRow(resource: CharacterResource) {
    const row = document.createElement('li');
    row.dataset.resourceId = resource.id;
    const name = document.createElement('strong');
    name.textContent = resource.name;
    const counter = document.createElement('div');
    counter.className = 'counter-actions';
    const count = document.createElement('span');
    count.dataset.testid = 'resource-count';
    count.textContent = resource.max === null ? String(resource.current) : `${resource.current} / ${resource.max}`;
    counter.append(count);

    for (const { delta, label, text, atLimit } of [
        { delta: -1, label: 'Потратить 1', text: '−1', atLimit: resource.current <= 0 },
        { delta: 1, label: 'Вернуть 1', text: '+1', atLimit: resource.max !== null && resource.current >= resource.max },
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', `${label}: ${resource.name}`);
        button.disabled = !resource.canAdjust || atLimit;
        button.addEventListener('click', () => runAction({ type: 'resource.adjust', resourceId: resource.id, delta }));
        counter.append(button);
    }
    row.append(name, counter);
    return row;
}

function renderCatalog() {
    const current = status === 'ready' ? snapshot : undefined;
    const catalog = current?.catalog;
    const skillEntries = catalog?.skills ?? [];
    const resourceEntries = current?.resources ?? [];
    tokenArea.hidden = !catalog && !current?.rollActions?.length && !resourceEntries.length;
    savingThrow.hidden = !current?.rollActions?.includes('saving-throw.roll');
    abilityCheck.hidden = !current?.rollActions?.includes('ability-check.roll');
    skillCheck.hidden = !current?.rollActions?.includes('skill-check.roll') || !skillEntries.length;
    initiative.hidden = !current?.rollActions?.includes('initiative.roll');
    resourceSection.hidden = !resourceEntries.length;
    if (!current || tokenArea.hidden) {
        tokenCatalog.hidden = true;
        token.setAttribute('aria-expanded', 'false');
        if (renderedCatalog) {
            attacks.replaceChildren();
            spells.replaceChildren();
            checkSkill.replaceChildren();
            resources.replaceChildren();
            renderedCatalog = undefined;
        }
        return;
    }
    if (tokenCatalog.hidden || renderedCatalog === current) return;
    renderedCatalog = current;

    const previousSkill = checkSkill.value;
    checkSkill.replaceChildren(...skillEntries.map(skill => new Option(skill.name, skill.id)));
    if (skillEntries.some(skill => skill.id === previousSkill)) checkSkill.value = previousSkill;
    resources.replaceChildren(...resourceEntries.map(resourceRow));

    const attackEntries = catalog?.attacks ?? [];
    attacksEmpty.hidden = attackEntries.length > 0;
    attacks.replaceChildren(...attackEntries.map(attack => {
        const row = listEntry(attack.name, [
            typeof attack.attackBonus === 'number' ? `${signed(attack.attackBonus)} к атаке` : '',
            [attack.damage, attack.damageType].filter(Boolean).join(' '),
        ].filter(Boolean).join(' · '));
        const actions = document.createElement('div');
        actions.className = 'action-row';
        if (current.rollActions?.includes('weapon.roll-attack')) {
            actions.append(weaponRollButton(attack.name, { type: 'weapon.roll-attack', weaponId: attack.id }));
        }
        if (attack.damage && current.rollActions?.includes('weapon.roll-damage')) {
            actions.append(weaponRollButton(attack.name, { type: 'weapon.roll-damage', weaponId: attack.id }));
        }
        if (actions.childElementCount) row.append(actions);
        return row;
    }));

    const spellEntries = catalog?.spells ?? [];
    spellsEmpty.hidden = spellEntries.length > 0;
    spellsEmpty.textContent = catalog?.spells ? 'В листе нет заклинаний.' : 'Список заклинаний недоступен.';
    spells.replaceChildren(...spellEntries.map(spell => {
        const row = listEntry(spell.name, [
            spell.level > 0 ? `Круг ${spell.level}` : 'Заговор',
            typeof spell.attackBonus === 'number' ? `${signed(spell.attackBonus)} к атаке` : '',
            typeof spell.saveDc === 'number' ? `СЛ ${spell.saveDc}` : '',
        ].filter(Boolean).join(' · '));
        row.dataset.spellId = spell.id;
        if (!spell.charge) return row;

        const charge = document.createElement('div');
        charge.className = 'counter-actions';
        const counter = document.createElement('span');
        const uses = document.createElement('strong');
        uses.dataset.testid = 'spell-charge';
        uses.textContent = `${spell.charge.current} / ${spell.charge.max}`;
        counter.append('Заряды ', uses);
        const spend = document.createElement('button');
        spend.type = 'button';
        spend.textContent = 'Потратить заряд';
        spend.setAttribute('aria-label', `Потратить заряд: ${spell.name}`);
        spend.disabled = !current.actions.includes('spell.spend-charge') || spell.charge.current < 1;
        spend.addEventListener('click', () => {
            runAction({ type: 'spell.spend-charge', spellId: spell.id });
        });
        charge.append(counter, spend);
        row.append(charge);
        return row;
    }));
}

function setTokenCatalogOpen(isOpen: boolean) {
    tokenCatalog.hidden = !isOpen;
    token.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) renderCatalog();
}


function renderJournal() {
    emptyLog.hidden = entries.size > 0;
    const rows = Array.from(entries.values(), ({ command, label, attempts, results }) => {
        const row = document.createElement('li');
        row.dataset.requestId = command.requestId;
        const heading = document.createElement('div');
        heading.className = 'command-head';
        const action = document.createElement('strong');
        action.textContent = label;
        const count = document.createElement('span');
        count.textContent = `Отправок ${attempts}`;
        heading.append(action, count);

        const id = document.createElement('code');
        id.className = 'request-id';
        id.textContent = command.requestId;

        const phases = document.createElement('div');
        phases.className = 'command-phases';
        if (!results.length) phases.textContent = 'Ожидаем ответ';
        for (const result of results) {
            const phase = document.createElement('span');
            phase.dataset.phase = result.phase;
            let detail: string;
            if ('code' in result) detail = errorLabels[result.code] ?? result.code;
            else if (result.phase === 'rolled') detail = `${result.roll.formula} = ${result.roll.total}`;
            else if (result.phase === 'saved') detail = `по ревизию ${result.savedThrough}`;
            else detail = `ревизия ${result.revision}`;
            phase.textContent = `${phaseLabels[result.phase]} · ${detail}`;
            phases.append(phase);
        }
        row.append(heading, id, phases);
        return row;
    });
    journal.replaceChildren(...rows);
    renderState();
}

function recordResult(result: CharacterResult) {
    const entry = entries.get(result.requestId);
    if (!entry || entry.command.executionId !== result.executionId || entry.command.characterId !== result.characterId) return;
    const signature = JSON.stringify(result);
    if (entry.results.some(recorded => JSON.stringify(recorded) === signature)) return;
    entry.results.push(result);
    renderJournal();
}

function send(command: CharacterCommand) {
    if (!sheet) return;
    let entry = entries.get(command.requestId);
    if (!entry) {
        const action = command.action;
        let detail: string;
        if (action.type === 'spell.spend-charge') {
            detail = snapshot?.catalog?.spells?.find(spell => spell.id === action.spellId)?.name ?? action.spellId;
        } else if ('weaponId' in action) {
            detail = snapshot?.catalog?.attacks.find(attack => attack.id === action.weaponId)?.name ?? action.weaponId;
        } else if (action.type === 'saving-throw.roll' || action.type === 'ability-check.roll') {
            detail = Array.from(saveAbility.options).find(option => option.value === action.ability)?.label ?? action.ability;
        } else if (action.type === 'skill-check.roll') {
            detail = snapshot?.catalog?.skills?.find(skill => skill.id === action.skillId)?.name ?? action.skillId;
        } else if (action.type === 'resource.adjust') {
            const name = snapshot?.resources?.find(resource => resource.id === action.resourceId)?.name ?? action.resourceId;
            detail = `${name} ${signed(action.delta)}`;
        } else if (action.type === 'initiative.roll') {
            detail = '';
        } else {
            detail = String(action.amount);
        }
        entry = { command, label: [actionLabels[action.type], detail].filter(Boolean).join(' '), attempts: 0, results: [] };
        entries.set(command.requestId, entry);
    }
    entry.attempts += 1;
    latestCommand = command;
    renderJournal();
    void sheet.send(command).then(recordResult).catch(() => {
        recordResult({
            characterId: command.characterId,
            executionId: command.executionId,
            requestId: command.requestId,
            phase: 'unknown',
            code: 'disconnected',
        });
    });
}

function runAction(action: CharacterCommand['action']) {
    if (status !== 'ready' || !snapshot || !canRun(snapshot, action)) return;
    if (action.type === 'spell.spend-charge') {
        const charge = snapshot.catalog?.spells?.find(spell => spell.id === action.spellId)?.charge;
        if (!charge || charge.current < 1) return;
    }
    send({
        characterId: snapshot.characterId,
        executionId: snapshot.executionId,
        expectedRevision: snapshot.revision,
        requestId: crypto.randomUUID(),
        action,
    });
}

savingThrow.addEventListener('submit', event => {
    event.preventDefault();
    runAction({ type: 'saving-throw.roll', ability: saveAbility.value as CharacterSaveAbility });
});
checkAbility.replaceChildren(...Array.from(saveAbility.options, option => option.cloneNode(true)));
abilityCheck.addEventListener('submit', event => {
    event.preventDefault();
    runAction({ type: 'ability-check.roll', ability: checkAbility.value as CharacterSaveAbility });
});
skillCheck.addEventListener('submit', event => {
    event.preventDefault();
    runAction({ type: 'skill-check.roll', skillId: checkSkill.value });
});
byId('roll-initiative').addEventListener('click', () => runAction({ type: 'initiative.roll' }));

function runHealthAction(type: 'health.damage' | 'health.heal') {
    const value = amount.valueAsNumber;
    if (!Number.isSafeInteger(value) || value < 1) return;
    runAction({ type, amount: value });
}

function renderGroupStatus() {
    if (!groupCode) {
        groupStatus.textContent = 'Группа не выбрана.';
        return;
    }
    const name = groupName ? ` «${groupName}»` : '';
    groupStatus.textContent = groupConnected
        ? `Персонаж в группе${name}.`
        : `Группа${name} выбрана. Подтвердите вступление в листе.`;
}

function offerGroup() {
    if (groupCode) bridge?.send({ type: 'lss:group-code', payload: { code: groupCode } });
}

function getSheetUrl() {
    const url = new URL(import.meta.env.VITE_SHEET_URL || 'https://longstoryshort.app/iframe/characters/list/');
    if (url.protocol !== 'https:') throw new Error('VITE_SHEET_URL должен быть HTTPS-адресом листа.');
    return url;
}

function getGroupUrl(mode: 'list' | 'create') {
    const sheetUrl = getSheetUrl();
    const url = new URL(mode === 'list' ? '/iframe/groups/' : '/iframe/group/', sheetUrl);
    url.searchParams.set('client', sheetUrl.hostname === 'localhost' ? 'dev' : 'owlbear');
    return url;
}

function createFrame(title: string) {
    const iframe = document.createElement('iframe');
    iframe.title = title;
    iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
    iframe.setAttribute('allow', 'clipboard-write');
    return iframe;
}

function closeGroupPicker() {
    groupBridge?.dispose();
    groupBridge = undefined;
    groupFrameHost.replaceChildren();
    groupPicker.hidden = true;
    pickGroup.setAttribute('aria-expanded', 'false');
}

function openGroupPicker(mode: 'list' | 'create' = 'list') {
    const url = getGroupUrl(mode);
    const iframe = createFrame('Выбор группы');
    groupBridge?.dispose();
    groupBridge = createBridgeSheetSource({
        iframe,
        allowedOrigins: [url.origin],
        targetOrigin: url.origin,
    });
    groupBridge.onEvent(event => {
        if (event.type !== 'lss:group-selected' || typeof event.payload?.code !== 'string') return;
        const code = event.payload.code.trim();
        if (!code) return;
        groupCode = code;
        groupName = typeof event.payload.name === 'string' ? event.payload.name : undefined;
        groupConnected = undefined;
        renderGroupStatus();
        closeGroupPicker();
        pickGroup.focus();
        if (masterMode) master.openGroup(code);
        else offerGroup();
    });
    iframe.src = url.href;
    groupFrameHost.replaceChildren(iframe);
    groupPicker.hidden = false;
    pickGroup.setAttribute('aria-expanded', 'true');
}

function openSheet() {
    if (bridge) return;
    const sheetUrl = getSheetUrl();
    const character = params.get('character');
    if (import.meta.env.DEV && character && /^[a-f0-9]{24}$/i.test(character)) {
        sheetUrl.pathname = `/iframe/characters/digital/${character}/`;
    }
    const iframe = createFrame('Лист персонажа');
    bridge = createBridgeSheetSource({
        iframe,
        allowedOrigins: [sheetUrl.origin],
        targetOrigin: sheetUrl.origin,
        characterApi: { sheetOrigin: sheetUrl.origin },
    });
    bridge.onEvent(event => {
        if (event.type === 'lss:manifest') {
            // The selected sheet can mount through client-side navigation without another iframe load.
            offerGroup();
        }
        if (event.type === 'lss:group-status' && typeof event.payload?.connected === 'boolean') {
            groupConnected = event.payload.connected;
            renderGroupStatus();
        }
    });
    iframe.addEventListener('load', () => {
        if (groupConnected === undefined) offerGroup();
    });
    sheet = bridge.character;
    if (!sheet) {
        status = 'unsupported';
        renderState();
    }
    sheet?.subscribeState(next => {
        snapshot = next;
        renderState();
    });
    sheet?.subscribeStatus(next => {
        status = next;
        if (next === 'connecting' || next === 'disconnected') {
            groupConnected = undefined;
            renderGroupStatus();
        }
        if (next === 'waiting' && groupConnected === undefined) offerGroup();
        renderState();
    });
    sheet?.onResult(recordResult);

    iframe.src = sheetUrl.href;
    frameHost.append(iframe);
    open.hidden = true;
    close.hidden = false;
}

function closeSheet() {
    bridge?.dispose();
    bridge = undefined;
    sheet = undefined;
    snapshot = undefined;
    status = 'disconnected';
    groupConnected = undefined;
    renderGroupStatus();
    frameHost.replaceChildren();
    open.hidden = false;
    close.hidden = true;
    renderState();
}

function setMasterMode(enabled: boolean) {
    masterMode = enabled;
    closeGroupPicker();
    switchMode.textContent = enabled ? 'Режим игрока' : 'Режим мастера';
    connectionStatus.hidden = enabled;
    groupStatus.hidden = enabled;
    masterRoomStatus.hidden = !enabled;
    playerPanel.hidden = enabled;
    masterPanel.hidden = !enabled;
    frameHost.hidden = enabled;
    masterFrameHost.hidden = !enabled;
    if (enabled) {
        closeSheet();
        open.hidden = true;
        if (groupCode) master.openGroup(groupCode);
        return;
    }
    master.closeGroup();
    openSheet();
}

switchMode.addEventListener('click', () => setMasterMode(!masterMode));
amount.addEventListener('input', renderState);
damage.addEventListener('click', () => runHealthAction('health.damage'));
heal.addEventListener('click', () => runHealthAction('health.heal'));
token.addEventListener('click', () => setTokenCatalogOpen(tokenCatalog.hidden));
token.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    setTokenCatalogOpen(true);
    token.focus();
});
function closeTokenCatalog() {
    setTokenCatalogOpen(false);
    token.focus();
}
byId('close-token-catalog').addEventListener('click', closeTokenCatalog);
tokenArea.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !tokenCatalog.hidden) closeTokenCatalog();
});
repeat.addEventListener('click', () => {
    if (latestCommand) send(latestCommand);
});
pickGroup.addEventListener('click', () => {
    if (groupPicker.hidden) openGroupPicker();
    else closeGroupPicker();
});
byId('list-groups').addEventListener('click', () => openGroupPicker('list'));
byId('create-group').addEventListener('click', () => openGroupPicker('create'));
byId('close-group-picker').addEventListener('click', () => {
    closeGroupPicker();
    pickGroup.focus();
});
open.addEventListener('click', openSheet);
close.addEventListener('click', closeSheet);
byId('copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(jsonText.textContent ?? '');
        copyStatus.textContent = 'JSON скопирован.';
    } catch {
        json.open = true;
        copyStatus.textContent = 'Буфер обмена недоступен. Выделите JSON и скопируйте его вручную.';
    }
    copyStatus.hidden = false;
});
let restoreSheet = false;
window.addEventListener('pagehide', () => {
    restoreSheet = Boolean(bridge);
    if (restoreSheet) closeSheet();
    if (masterMode) master.closeGroup();
    closeGroupPicker();
});
window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (masterMode && groupCode) master.openGroup(groupCode);
    else if (restoreSheet) openSheet();
});

renderGroupStatus();
setMasterMode(params.get('mode') === 'master');
