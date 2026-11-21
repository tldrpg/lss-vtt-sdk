import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectCharacterSheet } from './connectCharacterSheet';
import type { CharacterSheetFrame } from './connectCharacterSheet';
import type { CharacterCommand, CharacterMessage, CharacterSnapshot } from './characterProtocol';
import type { MessageHost } from './types';

const origin = 'https://sheet.example';
const snapshot: CharacterSnapshot = {
    characterId: 'character', executionId: 'sheet-execution', revision: 4, savedThrough: 4,
    hp: { current: 10, max: 20, temp: 4 }, actions: ['health.damage'],
};
const command: CharacterCommand = {
    characterId: snapshot.characterId, executionId: snapshot.executionId, requestId: 'request-1',
    expectedRevision: 4, action: { type: 'health.damage', amount: 8 },
};

function setup() {
    let listener: ((event: MessageEvent) => void) | undefined;
    let load: (() => void) | undefined;
    const peer = { postMessage: vi.fn<(envelope: { event: CharacterMessage }, origin: string) => void>() };
    const host: MessageHost = {
        addEventListener: (_type, callback) => { listener = callback; },
        removeEventListener: () => { listener = undefined; },
    };
    const iframe: CharacterSheetFrame = {
        contentWindow: peer as unknown as Window,
        addEventListener: (_type, callback) => { load = callback; },
        removeEventListener: () => { load = undefined; },
    };
    const connection = connectCharacterSheet({ iframe, sheetOrigin: origin, host });
    vi.advanceTimersByTime(1);

    function deliver(message: CharacterMessage, actualOrigin = origin, source: unknown = peer) {
        listener?.({ origin: actualOrigin, source, data: { __lssSheetSdk: 2, event: message } } as MessageEvent);
    }

    function hello() {
        const message = peer.postMessage.mock.lastCall?.[0].event;
        if (message?.type !== 'lss:character-hello') throw Error('hello message not sent');
        return message.payload.helloId;
    }

    function ready(helloId: string, connectionId = 'connection'): CharacterMessage {
        return { type: 'lss:character-ready', payload: { status: 'ready', version: 1, helloId, connectionId, snapshot } };
    }

    return { connection, peer, hello, ready, deliver, load: () => load?.() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('connecting the character sheet', () => {
    it('requires the exact origin, live frame and matching hello nonce', () => {
        const t = setup();
        const helloId = t.hello();
        expect(t.peer.postMessage.mock.lastCall?.[1]).toBe(origin);
        t.deliver(t.ready(helloId), 'https://other.example');
        t.deliver(t.ready(helloId), origin, {});
        t.deliver(t.ready('old-hello'));
        expect(t.connection.getSnapshot()).toBeUndefined();

        t.deliver(t.ready(helloId));
        const state = vi.fn();
        t.connection.subscribeState(state);
        expect(state).toHaveBeenCalledTimes(1);
        expect(state).toHaveBeenCalledWith(snapshot);
        t.connection.dispose();
    });

    it('continues probing after a long wait on the character list without a frame load', () => {
        const t = setup();
        const hello = t.hello();
        const status = vi.fn();
        t.connection.subscribeStatus(status);
        vi.advanceTimersByTime(13_000);
        expect(status).toHaveBeenLastCalledWith('disconnected');
        const timedOut = t.peer.postMessage.mock.calls.length;

        // Gatsby can change from the list to the sheet in the same document.
        vi.advanceTimersByTime(2_000);
        expect(t.peer.postMessage.mock.calls.length).toBeGreaterThan(timedOut);
        expect(t.hello()).toBe(hello);
        t.deliver({ type: 'lss:character-ready', payload: { helloId: hello, status: 'waiting' } });
        const awaitingGrant = t.peer.postMessage.mock.calls.length;
        vi.advanceTimersByTime(2_000);
        expect(status).toHaveBeenLastCalledWith('waiting');
        expect(t.peer.postMessage.mock.calls.length).toBeGreaterThan(awaitingGrant);
        expect(t.peer.postMessage.mock.calls.every(([{ event }]) => event.type === 'lss:character-hello')).toBe(true);
        t.deliver(t.ready(hello));
        expect(t.connection.getSnapshot()).toEqual(snapshot);
        expect(status).toHaveBeenLastCalledWith('ready');

        const connected = t.peer.postMessage.mock.calls.length;
        vi.advanceTimersByTime(20_000);
        expect(t.peer.postMessage).toHaveBeenCalledTimes(connected);
        t.connection.dispose();
    });

    it('reports application separately from saving and coalesces concurrent identical sends', async () => {
        const t = setup();
        t.deliver(t.ready(t.hello()));
        const result = vi.fn();
        t.connection.onResult(result);
        const pending = t.connection.send(command);
        expect(t.connection.send(command)).toBe(pending);
        expect(t.peer.postMessage.mock.calls.filter(([{ event }]) => event.type === 'lss:character-command')).toHaveLength(1);
        await expect(t.connection.send({ ...command, action: { ...command.action, amount: 9 } })).resolves.toMatchObject({
            phase: 'rejected', code: 'request_id_reused',
        });

        const applied = { ...command, phase: 'applied' as const, revision: 5 };
        let settled = false;
        void pending.then(() => { settled = true; });
        t.deliver({ type: 'lss:character-result', payload: { version: 1, connectionId: 'connection', result: applied } });
        await Promise.resolve();
        expect(result).toHaveBeenCalledWith(expect.objectContaining({ phase: 'applied', revision: 5 }));
        expect(settled).toBe(false);

        t.deliver({
            type: 'lss:character-result', payload: {
                version: 1, connectionId: 'connection',
                result: { ...applied, phase: 'saved', savedThrough: 6, serverVersion: 'version-6' },
            },
        });
        await expect(pending).resolves.toMatchObject({ phase: 'saved', revision: 5, savedThrough: 6 });
        t.connection.dispose();
    });

    it('invalidates pending results after navigation and does not replay the command', async () => {
        const t = setup();
        const oldHello = t.hello();
        t.deliver(t.ready(oldHello));
        const pending = t.connection.send(command);
        t.load();

        await expect(pending).resolves.toMatchObject({ phase: 'unknown', code: 'disconnected' });
        expect(t.connection.getSnapshot()).toBeUndefined();
        const newHello = t.hello();
        expect(newHello).not.toBe(oldHello);
        t.deliver(t.ready(oldHello));
        expect(t.connection.getSnapshot()).toBeUndefined();
        t.deliver(t.ready(newHello, 'replacement'));
        expect(t.connection.getSnapshot()).toEqual(snapshot);
        expect(t.peer.postMessage.mock.calls.filter(([{ event }]) => event.type === 'lss:character-command')).toHaveLength(1);
        t.connection.dispose();
    });

    it('keeps a timed-out command uncertain and still reports a later trusted receipt', async () => {
        const t = setup();
        t.deliver(t.ready(t.hello()));
        const listener = vi.fn();
        t.connection.onResult(listener);
        const pending = t.connection.send(command);
        vi.advanceTimersByTime(20_000);
        await expect(pending).resolves.toMatchObject({ phase: 'unknown', code: 'timeout' });

        t.deliver({
            type: 'lss:character-result', payload: {
                version: 1, connectionId: 'connection', result: { ...command,
                    phase: 'saved', revision: 5, savedThrough: 5, serverVersion: 'version-5',
                },
            },
        });
        expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saved', revision: 5 }));
        t.connection.dispose();
    });
});
