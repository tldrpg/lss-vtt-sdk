import { MARKER, VERSION } from './postMessageProtocol';

const phases = ['queued', 'claimed', 'applied', 'saved', 'rejected', 'unknown'] as const;

export interface RoomCharacterCommand {
    version: 1;
    roomId: string;
    characterId: string;
    requestId: string;
    action: { type: 'health.damage'; amount: number };
}

export interface RoomCharacterResult {
    requestId: string;
    characterId: string;
    phase: typeof phases[number];
    code?: string;
    revision?: number;
    serverVersion?: string;
}

export type RoomCharacterMessage =
    | { type: 'lss:room-character-command'; payload: RoomCharacterCommand }
    | { type: 'lss:room-character-result'; payload: { version: 1; roomId: string; result: RoomCharacterResult } };

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 128 && value.trim().length > 0;
}

function isRequestId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function readRoomCharacterCommand(value: unknown): RoomCharacterCommand | undefined {
    const payload = asRecord(value);
    if (!payload) return;
    const { version, roomId, characterId, requestId } = payload;
    const action = asRecord(payload.action);
    const amount = action?.amount;
    if (version !== 1 || !isText(roomId) || !isText(characterId) || !isRequestId(requestId)
        || action?.type !== 'health.damage' || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return;
    return { version, roomId, characterId, requestId, action: { type: 'health.damage', amount } };
}

function readResult(value: unknown): RoomCharacterResult | undefined {
    const result = asRecord(value);
    if (!result) return;
    const { requestId, characterId, phase, code, revision, serverVersion } = result;
    if (!isRequestId(requestId) || !isText(characterId) || !phases.some(candidate => candidate === phase)
        || (code !== undefined && !isText(code))
        || (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0))
        || (serverVersion !== undefined && (!isText(serverVersion) || !Number.isFinite(Date.parse(serverVersion))))
        || (phase === 'saved' && (revision === undefined || serverVersion === undefined))) return;
    return {
        requestId, characterId, phase: phase as RoomCharacterResult['phase'],
        ...(code === undefined ? {} : { code }),
        ...(revision === undefined ? {} : { revision }),
        ...(serverVersion === undefined ? {} : { serverVersion }),
    };
}

export function packRoomCharacterMessage(message: RoomCharacterMessage) {
    return { [MARKER]: VERSION, event: message };
}

export function parseRoomCharacterMessage(data: unknown): RoomCharacterMessage | undefined {
    const envelope = asRecord(data);
    if (envelope?.[MARKER] !== VERSION) return;

    const event = asRecord(envelope.event);
    if (event?.type === 'lss:room-character-command') {
        const payload = readRoomCharacterCommand(event.payload);
        if (payload) return { type: event.type, payload };
    } else if (event?.type === 'lss:room-character-result') {
        const payload = asRecord(event.payload);
        if (payload?.version !== 1 || !isText(payload.roomId)) return;
        const result = readResult(payload.result);
        if (result) return { type: event.type, payload: { version: 1, roomId: payload.roomId, result } };
    }
}
