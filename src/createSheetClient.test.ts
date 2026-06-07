import {
    describe, it, expect, vi,
} from 'vitest';

import { createSheetClient } from './createSheetClient';
import type { MessageHost, MessageTarget, SheetEvent } from './types';

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

/** Fake host/target so the client is testable in node without a DOM. */
function makeHarness() {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host: MessageHost = {
        addEventListener: vi.fn((_type, l) => { listener = l; }),
        removeEventListener: vi.fn(() => { listener = undefined; }),
    };
    const target: MessageTarget = { postMessage: vi.fn() };

    /** Simulate a message arriving at the sheet (default: from the bridge). */
    const deliver = (data: unknown, opts: { source?: unknown; origin?: string } = {}): void => {
        listener?.({
            data,
            origin: opts.origin ?? 'https://bridge.example',
            source: ('source' in opts ? opts.source : target),
        } as MessageEvent);
    };

    return { host, target, deliver };
}

describe('createSheetClient', () => {
    it('send() posts a marked envelope to the target', () => {
        const h = makeHarness();
        createSheetClient({ host: h.host, target: h.target }).send(roll);

        expect(h.target.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ __lssSheetSdk: 1, event: roll }),
            '*',
        );
    });

    it('send() honors a provided targetOrigin', () => {
        const h = makeHarness();
        createSheetClient({ host: h.host, target: h.target, targetOrigin: 'https://bridge.example' }).send(roll);

        expect(h.target.postMessage).toHaveBeenCalledWith(expect.anything(), 'https://bridge.example');
    });

    it('onEvent() receives marked inbound events from the bridge', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createSheetClient({ host: h.host, target: h.target }).onEvent(handler);

        h.deliver({ __lssSheetSdk: 1, event: roll });

        expect(handler).toHaveBeenCalledWith(roll);
    });

    it('ignores messages without the protocol marker', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createSheetClient({ host: h.host, target: h.target }).onEvent(handler);

        h.deliver({ some: 'thing' });
        h.deliver({ event: roll });

        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages from a window other than the bridge', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createSheetClient({ host: h.host, target: h.target }).onEvent(handler);

        h.deliver({ __lssSheetSdk: 1, event: roll }, { source: { postMessage: vi.fn() } });

        expect(handler).not.toHaveBeenCalled();
    });

    it('enforces allowedOrigins when set', () => {
        const h = makeHarness();
        const handler = vi.fn();
        createSheetClient({ host: h.host, target: h.target, allowedOrigins: ['https://ok.example'] }).onEvent(handler);

        h.deliver({ __lssSheetSdk: 1, event: roll }, { origin: 'https://evil.example' });
        expect(handler).not.toHaveBeenCalled();

        h.deliver({ __lssSheetSdk: 1, event: roll }, { origin: 'https://ok.example' });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('dispose() detaches the listener and stops delivery', () => {
        const h = makeHarness();
        const handler = vi.fn();
        const client = createSheetClient({ host: h.host, target: h.target });
        client.onEvent(handler);

        client.dispose();
        h.deliver({ __lssSheetSdk: 1, event: roll });

        expect(handler).not.toHaveBeenCalled();
        expect(h.host.removeEventListener).toHaveBeenCalled();
    });
});
