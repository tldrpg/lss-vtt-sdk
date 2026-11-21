import {
    CHARACTER_API_VERSION, readCharacterCommand, packCharacterMessage, parseCharacterMessage,
} from './characterProtocol';
import type {
    CharacterActionPayload, CharacterAddress, CharacterCommand, CharacterMessage, CharacterResult, CharacterSnapshot,
} from './characterProtocol';
import type { MessageHost } from './types';
import { requireSheetOrigin } from './postMessageProtocol';

export type CharacterConnectionStatus = 'connecting' | 'waiting' | 'denied' | 'unsupported' | 'ready' | 'disconnected';

export interface CharacterSheetFrame {
    readonly contentWindow: Window | null;
    readonly isConnected?: boolean;
    addEventListener(type: 'load', listener: () => void): void;
    removeEventListener(type: 'load', listener: () => void): void;
}

export interface CharacterSheetOptions {
    iframe: CharacterSheetFrame;
    /** Exact HTTP(S) origin of the sheet, e.g. new URL(sheetUrl).origin. */
    sheetOrigin: string;
    /** Default is the host window. */
    host?: MessageHost;
}

export interface CharacterSheetConnection {
    getSnapshot(): CharacterSnapshot | undefined;
    subscribeState(listener: (snapshot: CharacterSnapshot | undefined) => void): () => void;
    subscribeStatus(listener: (status: CharacterConnectionStatus) => void): () => void;
    onResult(listener: (result: CharacterResult) => void): () => void;
    /**
     * Resolves on the first terminal response or transport uncertainty. See onResult for
     * local application and later receipts. Send never automatically retries a command.
     */
    send(command: CharacterCommand): Promise<CharacterResult>;
    dispose(): void;
}

type Timer = ReturnType<typeof setTimeout>;
type PendingCommand = {
    command: CharacterCommand;
    timer: Timer;
    promise: Promise<CharacterResult>;
    resolve: (result: CharacterResult) => void;
};

const HELLO_RETRY_MS = 300;
const HELLO_TIMEOUT_MS = 12_000;
const HELLO_PROBE_MS = 1_500;
const COMMAND_TIMEOUT_MS = 10_000;

function sameAddress(first: CharacterAddress, second: CharacterAddress): boolean {
    return first.characterId === second.characterId && first.executionId === second.executionId;
}

function sameAction(first: CharacterActionPayload, second: CharacterActionPayload): boolean {
    switch (first.type) {
        case 'health.damage':
        case 'health.heal':
            return second.type === first.type && first.amount === second.amount;
        case 'spell.spend-charge':
            return second.type === first.type && first.spellId === second.spellId;
        case 'resource.adjust':
            return second.type === first.type && first.resourceId === second.resourceId && first.delta === second.delta;
        case 'weapon.roll-attack':
            return second.type === first.type && first.weaponId === second.weaponId && first.intent === second.intent;
        case 'weapon.roll-damage':
            return second.type === first.type && first.weaponId === second.weaponId && first.critical === second.critical;
        case 'saving-throw.roll':
        case 'ability-check.roll':
            return second.type === first.type && first.ability === second.ability && first.intent === second.intent;
        case 'skill-check.roll':
            return second.type === first.type && first.skillId === second.skillId && first.intent === second.intent;
        case 'initiative.roll':
            return second.type === first.type && first.intent === second.intent;
    }
}

function freezeSnapshot(next: CharacterSnapshot) {
    Object.freeze(next.hp);
    Object.freeze(next.actions);
    Object.freeze(next.rollActions);
    next.resources?.forEach(resource => Object.freeze(resource));
    Object.freeze(next.resources);
    if (next.catalog) {
        next.catalog.attacks.forEach(attack => Object.freeze(attack));
        next.catalog.spells?.forEach((spell) => {
            Object.freeze(spell.charge);
            Object.freeze(spell);
        });
        Object.freeze(next.catalog.attacks);
        Object.freeze(next.catalog.spells);
        next.catalog.skills?.forEach(skill => Object.freeze(skill));
        Object.freeze(next.catalog.skills);
        Object.freeze(next.catalog);
    }
    Object.freeze(next);
}

function unknown(command: CharacterCommand, code: 'timeout' | 'disconnected'): CharacterResult {
    return {
        characterId: command.characterId, executionId: command.executionId, requestId: command.requestId,
        phase: 'unknown', code,
    };
}

export function connectCharacterSheet(options: CharacterSheetOptions): CharacterSheetConnection {
    return createCharacterSheetConnection(options, true).connection;
}

/** The bridge source dispatches its own messages, while standalone callers need a listener. */
export function createCharacterSheetConnection(options: CharacterSheetOptions, listenToHost: boolean) {
    const { iframe, sheetOrigin } = options;
    requireSheetOrigin(sheetOrigin);
    const host: MessageHost | undefined = options.host ?? (typeof window === 'undefined' ? undefined : window);
    const stateListeners = new Set<(snapshot: CharacterSnapshot | undefined) => void>();
    const statusListeners = new Set<(status: CharacterConnectionStatus) => void>();
    const resultListeners = new Set<(result: CharacterResult) => void>();
    const pending = new Map<string, PendingCommand>();
    let connected: { id: string; peer: Window } | undefined;
    let snapshot: CharacterSnapshot | undefined;
    let status: CharacterConnectionStatus = host ? 'connecting' : 'disconnected';
    let helloId: string | undefined;
    let helloTimer: Timer | undefined;
    let disposed = false;

    function publishStatus(next: CharacterConnectionStatus) {
        if (status === next) return;
        status = next;
        statusListeners.forEach(listener => listener(next));
    }

    function publishSnapshot(next: CharacterSnapshot | undefined) {
        if (snapshot === next) return;
        if (next) freezeSnapshot(next);
        snapshot = next;
        stateListeners.forEach(listener => listener(next));
    }

    function publishResult(result: CharacterResult) {
        const item = pending.get(result.requestId);
        if (item && result.phase !== 'applied') {
            clearTimeout(item.timer);
            pending.delete(result.requestId);
            item.resolve(result);
        }
        resultListeners.forEach(listener => listener(result));
    }

    function stopHello() {
        clearTimeout(helloTimer);
        helloTimer = undefined;
    }

    function disconnect(nextStatus: CharacterConnectionStatus = 'disconnected') {
        stopHello();
        connected = undefined;
        helloId = undefined;
        publishSnapshot(undefined);
        publishStatus(nextStatus);
        [...pending.values()].forEach(({ command }) => publishResult(unknown(command, 'disconnected')));
    }

    function framePeer() {
        return iframe.isConnected === false ? null : iframe.contentWindow;
    }

    function beginHandshake() {
        if (!host || disposed) return;
        disconnect('connecting');

        const attempt = globalThis.crypto.randomUUID();
        helloId = attempt;
        const deadline = Date.now() + HELLO_TIMEOUT_MS;

        function ping() {
            if (helloId !== attempt || disposed) return;
            const timedOut = Date.now() >= deadline;
            const peer = framePeer();
            if (timedOut && !peer) {
                disconnect();
                return;
            }
            // The user can remain on the list or login screen and then navigate into
            // a sheet without a frame load. Continue a slow, read-only handshake probe.
            if (timedOut && status !== 'waiting') publishStatus('disconnected');
            peer?.postMessage(packCharacterMessage({
                type: 'lss:character-hello', payload: { helloId: attempt, versions: [CHARACTER_API_VERSION] },
            }), sheetOrigin);
            helloTimer = setTimeout(ping, timedOut || status === 'waiting' ? HELLO_PROBE_MS : HELLO_RETRY_MS);
        }

        ping();
    }

    function acceptSnapshot(next: CharacterSnapshot) {
        if (snapshot && (!sameAddress(snapshot, next) || next.revision < snapshot.revision
            || next.savedThrough < snapshot.savedThrough)) return;
        publishSnapshot(next);
    }

    function receiveReady(payload: Extract<CharacterMessage, { type: 'lss:character-ready' }>['payload'], peer: Window) {
        if (payload.helloId !== helloId || (connected && payload.status !== 'ready')) return;
        if (payload.status !== 'waiting') stopHello();
        if (payload.status === 'ready') {
            if (connected && (connected.id !== payload.connectionId || connected.peer !== peer)) return;
            connected = { id: payload.connectionId, peer };
            acceptSnapshot(payload.snapshot);
        } else if (payload.status !== 'waiting') {
            helloId = undefined;
        }
        publishStatus(payload.status);
    }

    function receive(event: MessageEvent) {
        const peer = framePeer();
        if (disposed || !peer || event.source !== peer || event.origin !== sheetOrigin) return;
        const message = parseCharacterMessage(event.data);
        if (!message) return;
        if (message.type === 'lss:character-ready') {
            receiveReady(message.payload, peer);
            return;
        }
        if (!connected || peer !== connected.peer || message.type === 'lss:character-hello'
            || message.payload.connectionId !== connected.id) return;

        switch (message.type) {
            case 'lss:character-state':
                acceptSnapshot(message.payload.snapshot);
                break;
            case 'lss:character-result':
                if (snapshot && sameAddress(snapshot, message.payload.result)) publishResult(message.payload.result);
                break;
            case 'lss:character-closed':
                beginHandshake();
                break;
        }
    }

    if (listenToHost) host?.addEventListener('message', receive);
    iframe.addEventListener('load', beginHandshake);
    if (host) {
        // A caller may attach the listener before assigning src and inserting the iframe.
        helloTimer = setTimeout(beginHandshake, 0);
    }

    const connection: CharacterSheetConnection = {
        getSnapshot() {
            if (connected && framePeer() !== connected.peer) disconnect();
            return snapshot;
        },
        subscribeState(listener) {
            stateListeners.add(listener);
            listener(snapshot);
            return () => { stateListeners.delete(listener); };
        },
        subscribeStatus(listener) {
            statusListeners.add(listener);
            listener(status);
            return () => { statusListeners.delete(listener); };
        },
        onResult(listener) {
            resultListeners.add(listener);
            return () => { resultListeners.delete(listener); };
        },
        send(command) {
            const { characterId, executionId, requestId } = command;
            const reject = (code: Extract<CharacterResult, { phase: 'rejected' }>['code']): Promise<CharacterResult> => {
                const result: CharacterResult = { characterId, executionId, requestId, phase: 'rejected', code };
                resultListeners.forEach(listener => listener(result));
                return Promise.resolve(result);
            };
            const sent = readCharacterCommand(command);
            if (!sent) return reject('invalid_parameters');
            const peer = framePeer();
            if (connected && peer !== connected.peer) disconnect();
            if (disposed || !connected || !snapshot || !peer) return reject('not_ready');
            if (!sameAddress(snapshot, command)) return reject('stale_session');
            const action = sent.action;
            const offered = action.type === 'resource.adjust'
                ? snapshot.resources?.some(resource => resource.id === action.resourceId && resource.canAdjust)
                : snapshot.actions.some(type => type === action.type) || snapshot.rollActions?.some(type => type === action.type);
            if (!offered) return reject('forbidden');

            const existing = pending.get(requestId);
            if (existing) {
                const previous = existing.command;
                return previous.expectedRevision === sent.expectedRevision
                    && sameAction(previous.action, sent.action)
                    ? existing.promise : reject('request_id_reused');
            }

            let resolve!: (result: CharacterResult) => void;
            const promise = new Promise<CharacterResult>(complete => { resolve = complete; });
            const timer = setTimeout(() => {
                if (framePeer() !== peer) disconnect();
                else publishResult(unknown(sent, 'timeout'));
            }, COMMAND_TIMEOUT_MS);
            pending.set(requestId, { command: sent, timer, promise, resolve });
            try {
                peer.postMessage(packCharacterMessage({
                    type: 'lss:character-command',
                    payload: { version: CHARACTER_API_VERSION, connectionId: connected.id, command: sent },
                }), sheetOrigin);
            } catch {
                disconnect();
            }
            return promise;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (listenToHost) host?.removeEventListener('message', receive);
            iframe.removeEventListener('load', beginHandshake);
            disconnect();
            stateListeners.clear();
            statusListeners.clear();
            resultListeners.clear();
        },
    };
    return { connection, receive };
}
