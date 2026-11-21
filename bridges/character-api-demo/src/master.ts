import {
    createBridgeSheetSource,
    type BridgeSheetSource,
    type RoomCharacterCommand,
    type RoomCharacterResult,
} from '@longstoryshort/vtt-sdk';
import { byId } from './elements';

type Member = { characterId: string; name: string };
type Entry = { command: RoomCharacterCommand; name: string; attempts: number; results: RoomCharacterResult[] };

const phaseLabels = {
    queued: 'Ожидает открытого листа',
    claimed: 'Лист принял команду',
    applied: 'Урон применён в листе',
    saved: 'Урон сохранён сервером',
    rejected: 'Команда отклонена',
    unknown: 'Исход неизвестен',
} satisfies Record<RoomCharacterResult['phase'], string>;

const errorLabels: Record<string, string> = {
    forbidden: 'Команда недоступна этому аккаунту',
    unavailable: 'Лист не принял команду',
    timeout: 'Истекло ожидание ответа',
    disconnected: 'Связь с группой потеряна',
    request_id_reused: 'Этот ID уже относится к другой команде',
};

export function createMasterDemo(getGroupUrl: () => URL, createFrame: (title: string) => HTMLIFrameElement) {
    const frameHost = byId('master-frame-host');
    const status = byId('master-room-status');
    const form = byId<HTMLFormElement>('master-actions');
    const target = byId<HTMLSelectElement>('master-target');
    const amount = byId<HTMLInputElement>('master-amount');
    const damage = byId<HTMLButtonElement>('master-damage');
    const repeat = byId<HTMLButtonElement>('master-repeat');
    const journal = byId('master-command-log');
    const entries = new Map<string, Entry>();
    let bridge: BridgeSheetSource | undefined;
    let frameLoaded = false;
    let groupId: string | undefined;
    let groupName: string | undefined;
    let members: Member[] | undefined;
    let latestCommand: RoomCharacterCommand | undefined;

    function renderControls() {
        const value = amount.valueAsNumber;
        target.disabled = !members?.length;
        damage.disabled = !(
            frameLoaded && bridge?.roomCharacters && groupId && members?.some(member => member.characterId === target.value)
            && Number.isSafeInteger(value) && value > 0
        );
        repeat.disabled = !(
            frameLoaded && bridge?.roomCharacters && latestCommand?.roomId === groupId
            && members?.some(member => member.characterId === latestCommand?.characterId)
        );
    }

    function renderMembers() {
        const selected = target.value;
        target.replaceChildren(...(members?.map(({ name, characterId }) => new Option(name, characterId)) ?? []));
        if (members?.some(member => member.characterId === selected)) target.value = selected;
        status.textContent = members
            ? (members.length ? `Группа «${groupName ?? groupId}» подключена.` : 'В группе пока нет персонажей.')
            : (bridge ? 'Ожидаем входа мастера и состава группы.' : 'Выберите группу мастера.');
        renderControls();
    }

    function renderJournal() {
        const rows = Array.from(entries.values(), entry => {
            const row = document.createElement('li');
            row.dataset.requestId = entry.command.requestId;
            const heading = document.createElement('div');
            heading.className = 'command-head';
            const label = document.createElement('strong');
            label.textContent = `${entry.name}: урон ${entry.command.action.amount}`;
            const attempts = document.createElement('span');
            attempts.textContent = `Отправок ${entry.attempts}`;
            heading.append(label, attempts);
            const id = document.createElement('code');
            id.className = 'request-id';
            id.textContent = entry.command.requestId;
            const phases = document.createElement('div');
            phases.className = 'command-phases';
            if (!entry.results.length) phases.textContent = 'Отправляем команду';
            for (const result of entry.results) {
                const phase = document.createElement('span');
                phase.dataset.phase = result.phase;
                const detail = result.code ? errorLabels[result.code] ?? result.code : undefined;
                phase.textContent = [phaseLabels[result.phase], detail].filter(Boolean).join(' · ');
                phases.append(phase);
            }
            row.append(heading, id, phases);
            return row;
        });
        journal.replaceChildren(...rows);
        renderControls();
    }

    function recordResult(result: RoomCharacterResult, roomId: string) {
        const entry = entries.get(result.requestId);
        if (!entry || entry.command.roomId !== roomId || entry.command.characterId !== result.characterId) return;
        const signature = JSON.stringify(result);
        if (entry.results.some(previous => JSON.stringify(previous) === signature)) return;
        entry.results.push(result);
        renderJournal();
    }

    function send(command: RoomCharacterCommand) {
        const client = bridge?.roomCharacters;
        const member = members?.find(candidate => candidate.characterId === command.characterId);
        if (!client || !member || command.roomId !== groupId) return;
        let entry = entries.get(command.requestId);
        if (!entry) {
            entry = { command, name: member.name, attempts: 0, results: [] };
            entries.set(command.requestId, entry);
        }
        entry.attempts++;
        latestCommand = command;
        renderJournal();
        void client.send(command).then(result => recordResult(result, command.roomId)).catch(() => {
            recordResult({
                phase: 'unknown',
                code: 'disconnected',
                characterId: command.characterId,
                requestId: command.requestId,
            }, command.roomId);
        });
    }

    function closeGroup() {
        bridge?.dispose();
        bridge = undefined;
        frameLoaded = false;
        groupId = undefined;
        groupName = undefined;
        members = undefined;
        frameHost.replaceChildren();
        renderMembers();
    }

    function openGroup(code: string) {
        closeGroup();
        const url = getGroupUrl();
        url.searchParams.set('code', code);
        url.searchParams.set('roomCommands', '1');
        const iframe = createFrame('Группа мастера');
        bridge = createBridgeSheetSource({
            iframe,
            allowedOrigins: [url.origin],
            targetOrigin: url.origin,
            roomCharacters: { sheetOrigin: url.origin },
        });
        bridge.roomCharacters?.onResult(recordResult);
        bridge.onEvent(event => {
            if (event.type === 'lss:group-selected' && event.payload?.code === code
                && typeof event.payload.groupId === 'string' && event.payload.groupId) {
                groupName = event.payload.name;
                if (!groupId) groupId = event.payload.groupId;
                bridge?.send({ type: 'lss:group-members-request', payload: { groupId: event.payload.groupId } });
                renderMembers();
            }
            if (event.type !== 'lss:group-members') return;
            const roster = event.payload;
            if (typeof roster?.groupId !== 'string' || (groupId && groupId !== roster.groupId) || !Array.isArray(roster.members)) return;
            groupId = roster.groupId;
            members = roster.members.filter(member => (
                typeof member?.characterId === 'string' && typeof member.name === 'string'
            ));
            renderMembers();
        });
        iframe.addEventListener('load', () => {
            if (iframe.parentElement !== frameHost) return;
            frameLoaded = true;
            renderControls();
        });
        iframe.src = url.href;
        frameHost.replaceChildren(iframe);
        renderMembers();
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (damage.disabled || !groupId) return;
        send({
            version: 1,
            roomId: groupId,
            characterId: target.value,
            requestId: crypto.randomUUID(),
            action: { type: 'health.damage', amount: amount.valueAsNumber },
        });
    });
    target.addEventListener('change', renderControls);
    amount.addEventListener('input', renderControls);
    repeat.addEventListener('click', () => {
        if (latestCommand && !repeat.disabled) send(latestCommand);
    });

    return { openGroup, closeGroup };
}
