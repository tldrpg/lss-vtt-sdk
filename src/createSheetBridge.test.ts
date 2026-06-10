import {
    describe, it, expect, vi,
} from 'vitest';

import { createSheetBridge } from './createSheetBridge';
import type {
    DiceRollPayload, SheetEvent, SheetSource, VTTAdapter,
} from './types';

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function makeRoll(overrides: Partial<DiceRollPayload> = {}): DiceRollPayload {
    return {
        characterId: 'c1',
        characterName: 'Alice',
        title: 'Attack',
        formula: '(1d20) + 5',
        breakdown: '(13) + 5',
        total: '18',
        isCrit: false,
        timestamp: 0,
        ...overrides,
    };
}

/** Controllable fake source + adapter, so the bridge is testable without a VTT. */
function makeHarness(available = true) {
    let emitRoll: (roll: DiceRollPayload) => void = () => {};
    let emitIncoming: (event: SheetEvent) => void = () => {};

    const source: SheetSource = {
        onRoll: (handler) => {
            emitRoll = handler;
            return () => { emitRoll = () => {}; };
        },
    };

    const adapter: VTTAdapter = {
        isAvailable: available,
        ready: vi.fn().mockResolvedValue(available),
        getSessionId: () => 'room1',
        getCurrentUser: () => undefined,
        broadcast: vi.fn(),
        onEvent: vi.fn((handler) => { emitIncoming = handler; return () => {}; }),
        notify: vi.fn(),
        labelOverSelection: vi.fn().mockResolvedValue(true),
        dispose: vi.fn(),
    };

    return {
        source,
        adapter,
        emitRoll: (roll: DiceRollPayload) => emitRoll(roll),
        emitIncoming: (event: SheetEvent) => emitIncoming(event),
    };
}

describe('createSheetBridge', () => {
    it('on a local roll: notifies the roller, broadcasts, and labels the token', async () => {
        const h = makeHarness();
        createSheetBridge(h.source, h.adapter);
        await flush();

        h.emitRoll(makeRoll());

        expect(h.adapter.notify).toHaveBeenCalledWith(expect.stringContaining('Alice'), 'info');
        expect(h.adapter.broadcast).toHaveBeenCalledWith({
            type: 'dnd:roll',
            payload: expect.objectContaining({ total: '18' }),
        });
        expect(h.adapter.labelOverSelection).toHaveBeenCalledWith('18');
    });

    it('warns with the (overridable) label hint when no token could be labeled', async () => {
        const h = makeHarness();
        (h.adapter.labelOverSelection as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        createSheetBridge(h.source, h.adapter, { messages: { labelHint: 'pick a token' } });

        h.emitRoll(makeRoll());
        await flush();

        expect(h.adapter.notify).toHaveBeenCalledWith('pick a token', 'warning');
    });

    it('shows the connected message once the adapter is ready', async () => {
        const h = makeHarness();
        createSheetBridge(h.source, h.adapter, { messages: { connected: 'connected!' } });
        await flush();

        expect(h.adapter.notify).toHaveBeenCalledWith('connected!', 'success');
    });

    it('relays a roll broadcast by another client as a toast', async () => {
        const h = makeHarness();
        createSheetBridge(h.source, h.adapter);
        await flush();

        h.emitIncoming({ type: 'dnd:roll', payload: makeRoll({ characterName: 'Bob', total: '7' }) });

        expect(h.adapter.notify).toHaveBeenCalledWith(expect.stringContaining('Bob'), 'info');
    });

    it('ignores rolls while the adapter is unavailable', () => {
        const h = makeHarness(false);
        createSheetBridge(h.source, h.adapter);

        h.emitRoll(makeRoll());

        expect(h.adapter.broadcast).not.toHaveBeenCalled();
    });

    it('dispose() stops forwarding rolls', async () => {
        const h = makeHarness();
        const dispose = createSheetBridge(h.source, h.adapter);
        await flush();

        dispose();
        h.emitRoll(makeRoll());

        expect(h.adapter.broadcast).not.toHaveBeenCalled();
    });
});
