import {
    describe, it, expect, vi,
} from 'vitest';

import { createBridgeSheetSource } from './createBridgeSheetSource';
import type { SheetFrameRef } from './createBridgeSheetSource';
import type { MessageHost, SheetEvent } from './types';

const roll: SheetEvent = {
    type: 'dnd:roll',
    payload: {
        characterId: 'c1',
        characterName: 'Alice',
        title: 'Attack',
        formula: '(1d20) + 5',
        breakdown: '(13) + 5',
        total: '18',
        isCrit: false,
        timestamp: 0,
    },
};

const manifest: SheetEvent = {
    type: 'dnd:manifest',
    payload: { version: '1', sheetSystem: 'dnd5e', capabilities: [] },
};

const health: SheetEvent = {
    type: 'dnd:health',
    payload: {
        characterId: 'c1', current: 7, max: 12, temp: 0,
    },
};

const groupStatus: SheetEvent = {
    type: 'dnd:group-status',
    payload: { connected: true },
};

function makeHarness() {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host: MessageHost = {
        addEventListener: vi.fn((_type, l) => { listener = l; }),
        removeEventListener: vi.fn(() => { listener = undefined; }),
    };
    const contentWindow = { postMessage: vi.fn() };
    const iframe: SheetFrameRef = { contentWindow: contentWindow as unknown as Window };

    const deliver = (data: unknown, opts: { source?: unknown; origin?: string } = {}): void => {
        listener?.({
            data,
            origin: opts.origin ?? 'https://sheet.example',
            source: ('source' in opts ? opts.source : contentWindow),
        } as MessageEvent);
    };

    return { host, iframe, contentWindow, deliver };
}

describe('createBridgeSheetSource', () => {
    it('onRoll() delivers dnd:roll payloads from the sheet iframe', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        h.deliver({ __lssSheetSdk: 2, event: roll });

        expect(handler).toHaveBeenCalledWith(roll.payload);
    });

    it('ignores messages from a window other than the sheet iframe', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        h.deliver({ __lssSheetSdk: 2, event: roll }, { source: { postMessage: vi.fn() } });

        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores unmarked messages', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onEvent(handler);

        h.deliver({ event: roll });

        expect(handler).not.toHaveBeenCalled();
    });

    it('enforces allowedOrigins when set', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({
            iframe: h.iframe, host: h.host, allowedOrigins: ['https://ok.example'],
        }).onRoll(handler);

        h.deliver({ __lssSheetSdk: 2, event: roll }, { origin: 'https://evil.example' });
        expect(handler).not.toHaveBeenCalled();

        h.deliver({ __lssSheetSdk: 2, event: roll }, { origin: 'https://ok.example' });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('send() posts a marked envelope to the live contentWindow and reports success', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        expect(source.send(roll)).toBe(true);
        expect(h.contentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ __lssSheetSdk: 2, event: roll }),
            '*',
        );
    });

    it('send() rejects explicitly (returns false, no throw) when the sheet window is closed', () => {
        const h = makeHarness();
        h.iframe.contentWindow = null;
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        expect(source.send(roll)).toBe(false);
    });

    it('reads contentWindow live, so it survives an iframe reload', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        // Simulate the sheet iframe reloading → a brand-new contentWindow.
        const reloaded = { postMessage: vi.fn() };
        h.iframe.contentWindow = reloaded as unknown as Window;

        h.deliver({ __lssSheetSdk: 2, event: roll }, { source: reloaded });

        expect(handler).toHaveBeenCalledWith(roll.payload);
    });

    it('replays the last state event to a handler that subscribes late', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        // The sheet announces its state as soon as it loads — before a VTT that gates
        // its wiring on an async init (OBR's `ready()`) gets a chance to subscribe.
        h.deliver({ __lssSheetSdk: 2, event: manifest });
        h.deliver({ __lssSheetSdk: 2, event: health });
        h.deliver({ __lssSheetSdk: 2, event: groupStatus });

        const handler = vi.fn();
        source.onEvent(handler);

        expect(handler).toHaveBeenCalledWith(manifest);
        expect(handler).toHaveBeenCalledWith(health);
        expect(handler).toHaveBeenCalledWith(groupStatus);
    });

    it('replays the latest dnd:group-status, so a late-opening "who\'s connected" panel is correct immediately', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        const disconnected: SheetEvent = { type: 'dnd:group-status', payload: { connected: false } };
        h.deliver({ __lssSheetSdk: 2, event: groupStatus });
        h.deliver({ __lssSheetSdk: 2, event: disconnected });

        const handler = vi.fn();
        source.onEvent(handler);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(disconnected);
    });

    it('replays only the latest of each state event type', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        const healed: SheetEvent = {
            type: 'dnd:health',
            payload: {
                characterId: 'c1', current: 12, max: 12, temp: 0,
            },
        };
        h.deliver({ __lssSheetSdk: 2, event: health });
        h.deliver({ __lssSheetSdk: 2, event: healed });

        const handler = vi.fn();
        source.onEvent(handler);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(healed);
    });

    it('never replays rolls — a past roll must not be announced twice', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        h.deliver({ __lssSheetSdk: 2, event: roll });

        const handler = vi.fn();
        source.onRoll(handler);

        expect(handler).not.toHaveBeenCalled();
    });

    it('dispose() detaches the listener', () => {
        const h = makeHarness();
        const handler = vi.fn();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });
        source.onRoll(handler);

        source.dispose();
        h.deliver({ __lssSheetSdk: 2, event: roll });

        expect(handler).not.toHaveBeenCalled();
        expect(h.host.removeEventListener).toHaveBeenCalled();
    });
});
