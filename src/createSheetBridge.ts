import type {
    SheetBridgeMessages, SheetBridgeOptions, SheetSource, VTTAdapter,
} from './types';
import { formatRollMessage, rollVariant } from './formatRoll';

const DEFAULT_MESSAGES: SheetBridgeMessages = {
    connected: '🎲 Sheet connected to the table',
    labelHint: 'No label placed — select exactly one of your tokens on the map',
};

/**
 * Wires a host {@link SheetSource} to a {@link VTTAdapter}. This is the whole
 * integration in one place, and it knows nothing about any specific sheet app or
 * any specific VTT:
 *
 *  - a roll on the sheet → local toast for the roller + broadcast to other
 *    clients + a transient label over the roller's selected token;
 *  - a roll broadcast by another client → local toast.
 *
 * Returns a dispose fn that tears down every subscription it created. The
 * adapter is left untouched — it may be shared and longer-lived than the bridge.
 */
export function createSheetBridge(
    source: SheetSource,
    adapter: VTTAdapter,
    options: SheetBridgeOptions = {},
): () => void {
    const messages: SheetBridgeMessages = { ...DEFAULT_MESSAGES, ...options.messages };
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    cleanups.push(source.onRoll((roll) => {
        if (!adapter.isAvailable) {
            return;
        }
        // Local feedback — broadcast is REMOTE-only, so without this the roller
        // would see nothing on their own screen.
        adapter.notify(formatRollMessage(roll), rollVariant(roll));
        adapter.broadcast({ type: 'DICE_ROLL', payload: roll });
        void adapter.labelOverSelection(roll.total).then((placed) => {
            if (!placed) {
                adapter.notify(messages.labelHint, 'warning');
            }
        });
    }));

    void adapter.ready().then((available) => {
        if (cancelled || !available) {
            return;
        }
        // Confirms the sheet is embedded and the adapter handshook — independent
        // of whether any roll has happened yet.
        adapter.notify(messages.connected, 'success');
        cleanups.push(adapter.onEvent((event) => {
            if (event.type !== 'DICE_ROLL') {
                return;
            }
            adapter.notify(formatRollMessage(event.payload), rollVariant(event.payload));
        }));
    });

    return () => {
        cancelled = true;
        cleanups.forEach((cleanup) => cleanup());
    };
}
