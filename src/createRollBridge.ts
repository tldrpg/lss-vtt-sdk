import type {
    RollBridgeMessages, RollBridgeOptions, SheetSource, VTTAdapter,
} from './types';
import { formatRollMessage, rollVariant } from './formatRoll';

const DEFAULT_MESSAGES: RollBridgeMessages = {
    connected: '🎲 Sheet connected to the table',
    labelHint: 'No label placed — select exactly one of your tokens on the map',
};

/**
 * The default roll bridge — one opinionated policy, not the full protocol.
 *
 * Wires {@link SheetSource} → {@link VTTAdapter} for the `dnd:roll` event only:
 *  - a roll on the sheet → local toast for the roller + broadcast to other
 *    clients + a transient label over the roller's selected token;
 *  - a roll broadcast by another client → local toast.
 *
 * Inbound capability wiring (`dnd:command`, `dnd:manifest`, `dnd:health`) is
 * deliberately out of scope here — wire those directly via
 * {@link BridgeSheetSource.onEvent} when your bridge needs them.
 *
 * Returns a dispose fn that tears down every subscription it created. The
 * adapter is left untouched — it may be shared and longer-lived than the bridge.
 */
export function createRollBridge(
    source: SheetSource,
    adapter: VTTAdapter,
    options: RollBridgeOptions = {},
): () => void {
    const messages: RollBridgeMessages = { ...DEFAULT_MESSAGES, ...options.messages };
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    cleanups.push(source.onRoll((roll) => {
        if (!adapter.isAvailable) {
            return;
        }
        // Local feedback — broadcast is REMOTE-only, so without this the roller
        // would see nothing on their own screen.
        adapter.notify(formatRollMessage(roll), rollVariant(roll));
        adapter.broadcast({ type: 'dnd:roll', payload: roll });
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
            if (event.type !== 'dnd:roll') {
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
