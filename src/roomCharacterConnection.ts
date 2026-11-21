import { requireSheetOrigin } from './postMessageProtocol';
import { packRoomCharacterMessage, parseRoomCharacterMessage, readRoomCharacterCommand } from './roomCharacterProtocol';
import type { RoomCharacterCommand, RoomCharacterResult } from './roomCharacterProtocol';
import type { CharacterSheetFrame } from './connectCharacterSheet';

export interface RoomCharacterConnection {
    /** Resolves on saved, rejected, or unknown. Keep the request ID for retries. */
    send(command: RoomCharacterCommand): Promise<RoomCharacterResult>;
    /** Observes replies for pending commands, including queueing and local application. */
    onResult(handler: (result: RoomCharacterResult, roomId: string) => void): () => void;
}

type PendingCommand = {
    command: RoomCharacterCommand;
    peer: Window;
    promise: Promise<RoomCharacterResult>;
    resolve: (result: RoomCharacterResult) => void;
    timer: ReturnType<typeof setTimeout>;
};

const COMMAND_TIMEOUT_MS = 50_000;

function commandKey(roomId: string, requestId: string): string {
    return JSON.stringify([roomId, requestId]);
}

export function createRoomCharacterConnection(iframe: CharacterSheetFrame, sheetOrigin: string) {
    requireSheetOrigin(sheetOrigin);
    const pending = new Map<string, PendingCommand>();
    const listeners = new Set<(result: RoomCharacterResult, roomId: string) => void>();
    let disposed = false;

    function publish(command: RoomCharacterCommand, result: RoomCharacterResult) {
        listeners.forEach(listener => listener(result, command.roomId));
    }

    function finish(key: string, item: PendingCommand, result: RoomCharacterResult) {
        if (pending.get(key) !== item) return;
        pending.delete(key);
        clearTimeout(item.timer);
        item.resolve(result);
        publish(item.command, result);
    }

    function unknown(command: RoomCharacterCommand, code: string): RoomCharacterResult {
        return { requestId: command.requestId, characterId: command.characterId, phase: 'unknown', code };
    }

    function disconnect() {
        for (const [key, item] of [...pending]) finish(key, item, unknown(item.command, 'disconnected'));
    }

    function receive(event: MessageEvent) {
        if (disposed || event.origin !== sheetOrigin || event.source !== iframe.contentWindow) return;

        const message = parseRoomCharacterMessage(event.data);
        if (message?.type !== 'lss:room-character-result') return;

        const { roomId, result } = message.payload;
        const key = commandKey(roomId, result.requestId);
        const item = pending.get(key);
        if (!item || item.peer !== event.source || item.command.characterId !== result.characterId) return;

        if (result.phase === 'saved' || result.phase === 'rejected' || result.phase === 'unknown') {
            finish(key, item, result);
        } else {
            publish(item.command, result);
        }
    }

    const connection: RoomCharacterConnection = {
        send(value) {
            const command = readRoomCharacterCommand(value);
            if (!command) return Promise.reject(new TypeError('Invalid room character command'));

            const peer = iframe.isConnected === false ? null : iframe.contentWindow;
            if (disposed || !peer) return Promise.resolve(unknown(command, 'disconnected'));

            const key = commandKey(command.roomId, command.requestId);
            const existing = pending.get(key);
            if (existing && existing.peer !== peer) disconnect();
            if (existing?.peer === peer) {
                if (existing.command.characterId === command.characterId && existing.command.action.amount === command.action.amount) {
                    return existing.promise;
                }
                return Promise.resolve({
                    requestId: command.requestId, characterId: command.characterId, phase: 'rejected', code: 'request_id_reused',
                });
            }

            let resolve!: PendingCommand['resolve'];
            const promise = new Promise<RoomCharacterResult>(callback => { resolve = callback; });
            const timer = setTimeout(() => finish(key, item, unknown(command, 'timeout')), COMMAND_TIMEOUT_MS);
            const item = { command, peer, promise, resolve, timer };
            pending.set(key, item);

            try {
                peer.postMessage(packRoomCharacterMessage({ type: 'lss:room-character-command', payload: command }), sheetOrigin);
            } catch {
                finish(key, item, unknown(command, 'disconnected'));
            }
            return promise;
        },
        onResult(handler) {
            listeners.add(handler);
            return () => { listeners.delete(handler); };
        },
    };

    iframe.addEventListener('load', disconnect);
    return {
        connection, receive,
        dispose() {
            if (disposed) return;
            disposed = true;
            iframe.removeEventListener('load', disconnect);
            disconnect();
            listeners.clear();
        },
    };
}
