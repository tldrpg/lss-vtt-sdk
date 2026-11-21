import { MARKER, VERSION } from './postMessageProtocol';

export const CHARACTER_API_VERSION = 1;

const actions = ['health.damage', 'health.heal'] as const;
const rejectionCodes = [
    'not_ready', 'forbidden', 'stale_session', 'revision_conflict', 'unsupported_action',
    'invalid_parameters', 'request_id_reused', 'session_limit',
] as const;
const saveFailureCodes = ['forbidden', 'conflict', 'storage'] as const;
const unknownCodes = ['timeout', 'disconnected', 'save_unconfirmed'] as const;

export type CharacterAction = typeof actions[number];
export type CharacterAddress = { characterId: string; executionId: string };

export type CharacterSnapshot = Readonly<CharacterAddress & {
    revision: number;
    savedThrough: number;
    hp: Readonly<{ current: number; max: number; temp: number }>;
    actions: readonly CharacterAction[];
}>;

/** Addressable wire command. The executor validates which actions and amounts are allowed. */
export type CharacterWireCommand = CharacterAddress & {
    requestId: string;
    expectedRevision: number;
    action: { type: string; amount: number };
};

export type CharacterCommand = CharacterWireCommand & {
    action: { type: CharacterAction; amount: number };
};

export type CharacterResult = CharacterAddress & { requestId: string } & (
    | { phase: 'applied' | 'unchanged'; revision: number }
    | { phase: 'saved'; revision: number; savedThrough: number; serverVersion: string }
    | { phase: 'save_failed'; revision: number; code: typeof saveFailureCodes[number] }
    | { phase: 'rejected'; code: typeof rejectionCodes[number] }
    | { phase: 'unknown'; code: typeof unknownCodes[number] }
);

type CharacterConnectionPayload = { version: typeof CHARACTER_API_VERSION; connectionId: string };
type CharacterReadyPayload = { helloId: string } & (
    | ({ status: 'ready'; snapshot: CharacterSnapshot } & CharacterConnectionPayload)
    | { status: 'waiting' | 'denied' | 'unsupported'; version?: typeof CHARACTER_API_VERSION }
);

export type CharacterMessage =
    | { type: 'lss:character-hello'; payload: { helloId: string; versions: number[] } }
    | { type: 'lss:character-ready'; payload: CharacterReadyPayload }
    | { type: 'lss:character-state'; payload: CharacterConnectionPayload & { snapshot: CharacterSnapshot } }
    | { type: 'lss:character-command'; payload: CharacterConnectionPayload & { command: CharacterWireCommand } }
    | { type: 'lss:character-result'; payload: CharacterConnectionPayload & { result: CharacterResult } }
    | { type: 'lss:character-closed'; payload: CharacterConnectionPayload };

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;

const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 128 && value.trim().length > 0;

const isRevision = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isHp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
    return options.some(option => option === value);
}

function readAddress(value: JsonObject): CharacterAddress | undefined {
    const { characterId, executionId } = value;
    if (isId(characterId) && isId(executionId)) {
        return { characterId, executionId };
    }
}

function readConnection(value: JsonObject): CharacterConnectionPayload | undefined {
    if (value.version === CHARACTER_API_VERSION && isId(value.connectionId)) {
        return { version: value.version, connectionId: value.connectionId };
    }
}

function readSnapshot(value: unknown): CharacterSnapshot | undefined {
    const snapshot = object(value);
    if (!snapshot) return;
    const address = readAddress(snapshot);
    const hp = object(snapshot.hp);
    const { revision, savedThrough, actions: offered } = snapshot;
    if (!address || !hp || !isRevision(revision) || !isRevision(savedThrough) || savedThrough > revision
        || !Array.isArray(offered) || offered.length > actions.length
        || !offered.every(action => isOneOf(action, actions))) return;
    const { current, max, temp } = hp;
    if (isHp(current) && isHp(max) && isHp(temp)) {
        return { ...address, revision, savedThrough, hp: { current, max, temp }, actions: [...offered] };
    }
}

function readCommand(value: unknown): CharacterWireCommand | undefined {
    const command = object(value);
    if (!command) return;
    const address = readAddress(command);
    const { requestId, expectedRevision } = command;
    const action = object(command.action);
    if (address && isId(requestId) && isRevision(expectedRevision)
        && action && isId(action.type) && typeof action.amount === 'number') {
        return { ...address, requestId, expectedRevision, action: { type: action.type, amount: action.amount } };
    }
}

export function isCharacterCommand(value: unknown): value is CharacterCommand {
    const command = readCommand(value);
    return Boolean(command && isOneOf(command.action.type, actions)
        && isRevision(command.action.amount) && command.action.amount > 0);
}

function readResult(value: unknown): CharacterResult | undefined {
    const result = object(value);
    if (!result) return;
    const address = readAddress(result);
    const { requestId, phase, code, revision, savedThrough, serverVersion } = result;
    if (!address || !isId(requestId)) return;
    const initial = { ...address, requestId };
    switch (phase) {
        case 'applied':
        case 'unchanged':
            return isRevision(revision) ? { ...initial, phase, revision } : undefined;
        case 'saved':
            return isRevision(revision) && isRevision(savedThrough) && savedThrough >= revision && isId(serverVersion)
                ? { ...initial, phase, revision, savedThrough, serverVersion } : undefined;
        case 'save_failed':
            return isRevision(revision) && isOneOf(code, saveFailureCodes)
                ? { ...initial, phase, revision, code } : undefined;
        case 'rejected':
            return isOneOf(code, rejectionCodes) ? { ...initial, phase, code } : undefined;
        case 'unknown':
            return isOneOf(code, unknownCodes) ? { ...initial, phase, code } : undefined;
    }
}

export function packCharacterMessage(message: CharacterMessage) {
    return { [MARKER]: VERSION, event: message };
}

export function parseCharacterMessage(data: unknown): CharacterMessage | undefined {
    const envelope = object(data);
    const event = object(envelope?.event);
    const payload = object(event?.payload);
    if (envelope?.[MARKER] !== VERSION || !event || !payload) return;

    const { type } = event;
    const { helloId, versions } = payload;
    if (type === 'lss:character-hello') {
        if (isId(helloId) && Array.isArray(versions) && versions.length > 0 && versions.length <= 16
            && versions.every(version => isRevision(version) && version > 0)) {
            return { type, payload: { helloId, versions: [...versions] } };
        }
        return;
    }

    const connection = readConnection(payload);
    if (type === 'lss:character-ready') {
        if (!isId(helloId)) return;
        if (payload.status === 'ready') {
            const snapshot = readSnapshot(payload.snapshot);
            return connection && snapshot ? {
                type, payload: { ...connection, helloId, status: 'ready', snapshot },
            } : undefined;
        }
        const { status, version } = payload;
        if (isOneOf(status, ['waiting', 'denied', 'unsupported'] as const)
            && (version === undefined || version === CHARACTER_API_VERSION)) {
            return { type, payload: version === undefined ? { helloId, status } : { helloId, status, version } };
        }
        return;
    }
    if (!connection) return;

    switch (type) {
        case 'lss:character-state': {
            const snapshot = readSnapshot(payload.snapshot);
            return snapshot ? { type, payload: { ...connection, snapshot } } : undefined;
        }
        case 'lss:character-command': {
            const command = readCommand(payload.command);
            return command ? { type, payload: { ...connection, command } } : undefined;
        }
        case 'lss:character-result': {
            const result = readResult(payload.result);
            return result ? { type, payload: { ...connection, result } } : undefined;
        }
        case 'lss:character-closed':
            return { type, payload: connection };
    }
}
