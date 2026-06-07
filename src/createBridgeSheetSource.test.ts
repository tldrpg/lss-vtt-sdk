import {
    describe, it, expect, vi,
} from 'vitest';

import { createBridgeSheetSource } from './createBridgeSheetSource';
import type { MessageHost, SheetEvent } from './types';

const roll: SheetEvent = {
    type: 'DICE_ROLL',
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

function makeHarness() {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host: MessageHost = {
        addEventListener: vi.fn((_type, l) => { listener = l; }),
        removeEventListener: vi.fn(() => { listener = undefined; }),
    };
    const contentWindow = { postMessage: vi.fn() };
    const iframe = { contentWindow: contentWindow as unknown as Window };

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
    it('onRoll() delivers DICE_ROLL payloads from the sheet iframe', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        h.deliver({ __lssSheetSdk: 1, event: roll });

        expect(handler).toHaveBeenCalledWith(roll.payload);
    });

    it('ignores messages from a window other than the sheet iframe', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        h.deliver({ __lssSheetSdk: 1, event: roll }, { source: { postMessage: vi.fn() } });

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

        h.deliver({ __lssSheetSdk: 1, event: roll }, { origin: 'https://evil.example' });
        expect(handler).not.toHaveBeenCalled();

        h.deliver({ __lssSheetSdk: 1, event: roll }, { origin: 'https://ok.example' });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('send() posts a marked envelope to the live contentWindow', () => {
        const h = makeHarness();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });

        source.send(roll);

        expect(h.contentWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ __lssSheetSdk: 1, event: roll }),
            '*',
        );
    });

    it('reads contentWindow live, so it survives an iframe reload', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createBridgeSheetSource({ iframe: h.iframe, host: h.host }).onRoll(handler);

        // Simulate the sheet iframe reloading → a brand-new contentWindow.
        const reloaded = { postMessage: vi.fn() };
        h.iframe.contentWindow = reloaded as unknown as Window;

        h.deliver({ __lssSheetSdk: 1, event: roll }, { source: reloaded });

        expect(handler).toHaveBeenCalledWith(roll.payload);
    });

    it('dispose() detaches the listener', () => {
        const h = makeHarness();
        const handler = vi.fn();
        const source = createBridgeSheetSource({ iframe: h.iframe, host: h.host });
        source.onRoll(handler);

        source.dispose();
        h.deliver({ __lssSheetSdk: 1, event: roll });

        expect(handler).not.toHaveBeenCalled();
        expect(h.host.removeEventListener).toHaveBeenCalled();
    });
});
