import {
    connectCharacterSheet,
    SHEET_IFRAME_SANDBOX,
    type CharacterCommand,
    type CharacterConnectionStatus,
    type CharacterSheetConnection,
    type CharacterResult,
    type CharacterSnapshot,
} from '@longstoryshort/vtt-sdk';
import './style.css';

type JournalEntry = { command: CharacterCommand; attempts: number; results: CharacterResult[] };

const statusLabels = {
    connecting: 'Подключаем лист…',
    waiting: 'Ожидаем выбора персонажа и разрешения доступа.',
    ready: 'Лист подключён.',
    denied: 'Доступ отклонён. Повторно откройте лист, чтобы изменить решение.',
    unsupported: 'Нет ответа Character API v1. Проверьте адрес, вход и разрешённый origin.',
    disconnected: 'Связь с листом потеряна.',
} satisfies Record<CharacterConnectionStatus, string>;

const phaseLabels = {
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
    not_ready: 'Лист ещё не готов',
    stale_session: 'Лист открыт в новой сессии',
    revision_conflict: 'Ревизия листа изменилась',
    unsupported_action: 'Действие недоступно',
    invalid_parameters: 'Недопустимые параметры команды',
    request_id_reused: 'Этот ID уже относится к другой команде',
    session_limit: 'Лимит команд сессии достигнут',
};

const actionLabels = {
    'health.damage': 'Урон',
    'health.heal': 'Лечение',
} satisfies Record<CharacterCommand['action']['type'], string>;

function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Нет элемента #${id}`);
    return element as T;
}

const frameHost = byId('frame-host');
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

const entries = new Map<string, JournalEntry>();
let sheet: CharacterSheetConnection | undefined;
let snapshot: CharacterSnapshot | undefined;
let latestCommand: CharacterCommand | undefined;
let status: CharacterConnectionStatus = 'connecting';

function renderState() {
    connectionStatus.dataset.status = status;
    connectionStatus.textContent = status === 'ready' && !snapshot?.actions.length
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
        snapshot.characterId === latestCommand.characterId && snapshot.actions.includes(latestCommand.action.type)
    );
    jsonText.textContent = JSON.stringify({ snapshot: snapshot ?? null, commands: [...entries.values()] }, null, 2);
}

function renderJournal() {
    emptyLog.hidden = entries.size > 0;
    const rows = Array.from(entries.values(), ({ command, attempts, results }) => {
        const row = document.createElement('li');
        row.dataset.requestId = command.requestId;
        const heading = document.createElement('div');
        heading.className = 'command-head';
        const action = document.createElement('strong');
        action.textContent = `${actionLabels[command.action.type]} ${command.action.amount}`;
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
            const detail = 'code' in result
                ? errorLabels[result.code] ?? result.code
                : result.phase === 'saved'
                    ? `по ревизию ${result.savedThrough}`
                    : `ревизия ${result.revision}`;
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
        entry = { command, attempts: 0, results: [] };
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

function runAction(type: CharacterCommand['action']['type']) {
    const value = amount.valueAsNumber;
    if (!snapshot?.actions.includes(type) || !Number.isSafeInteger(value) || value < 1) return;
    send({
        characterId: snapshot.characterId,
        executionId: snapshot.executionId,
        expectedRevision: snapshot.revision,
        requestId: crypto.randomUUID(),
        action: { type, amount: value },
    });
}

function openSheet() {
    if (sheet) return;
    const sheetUrl = new URL(import.meta.env.VITE_SHEET_URL || 'https://longstoryshort.app/iframe/characters/list/');
    if (sheetUrl.protocol !== 'https:') throw new Error('VITE_SHEET_URL должен быть HTTPS-адресом листа.');
    const character = new URLSearchParams(location.search).get('character');
    if (import.meta.env.DEV && character && /^[a-f0-9]{24}$/i.test(character)) {
        sheetUrl.pathname = `/iframe/characters/digital/${character}/`;
    }
    const iframe = document.createElement('iframe');
    iframe.title = 'Лист персонажа';
    iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
    iframe.setAttribute('allow', 'clipboard-write');
    sheet = connectCharacterSheet({ iframe, sheetOrigin: sheetUrl.origin });
    sheet.subscribeState(next => {
        snapshot = next;
        renderState();
    });
    sheet.subscribeStatus(next => {
        status = next;
        renderState();
    });
    sheet.onResult(recordResult);

    iframe.src = sheetUrl.href;
    frameHost.append(iframe);
    open.hidden = true;
    close.hidden = false;
}

function closeSheet() {
    sheet?.dispose();
    sheet = undefined;
    snapshot = undefined;
    status = 'disconnected';
    frameHost.replaceChildren();
    open.hidden = false;
    close.hidden = true;
    renderState();
}

amount.addEventListener('input', renderState);
damage.addEventListener('click', () => runAction('health.damage'));
heal.addEventListener('click', () => runAction('health.heal'));
repeat.addEventListener('click', () => {
    if (latestCommand) send(latestCommand);
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
    restoreSheet = Boolean(sheet);
    if (restoreSheet) closeSheet();
});
window.addEventListener('pageshow', (event) => {
    if (event.persisted && restoreSheet) openSheet();
});

openSheet();
