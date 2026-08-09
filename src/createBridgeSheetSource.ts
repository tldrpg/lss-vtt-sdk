import type {
    DiceRollPayload, MessageHost, SheetEvent, SheetSource,
} from './types';
import { readEnvelope, wrapEnvelope } from './postMessageProtocol';

/** A reference to the embedded sheet iframe — only `contentWindow` is read (live). */
export interface SheetFrameRef {
    contentWindow: Window | null;
}

export interface BridgeSheetSourceOptions {
    /** The embedded sheet iframe. Its *live* `contentWindow` is the message peer. */
    iframe: SheetFrameRef;
    /** Window to listen on. Default: `window`. */
    host?: MessageHost;
    /** Honor inbound only from these origins (the sheet's origin). */
    allowedOrigins?: string[];
    /** Origin to post inbound commands to. Default `'*'`. */
    targetOrigin?: string;
}

/**
 * Event types that describe *current state* rather than something that happened at a
 * point in time. The last one of each is replayed to handlers that subscribe late —
 * see `onEvent`. Rolls are deliberately absent: replaying a roll would announce it twice.
 *
 * `dnd:group-status` belongs here for the same reason as `dnd:manifest`/`dnd:health`: a
 * host subscribing after the sheet already reported its connection status (e.g. opening a
 * "who's connected" panel later) must see the current value immediately, not wait for it
 * to change. `lss:group-selected`/`dnd:group-code` are one-off facts of a single setup
 * flow, not persistent sheet state, so they are deliberately not replayed.
 */
const STATE_EVENT_TYPES: ReadonlySet<SheetEvent['type']> = new Set(['dnd:manifest', 'dnd:health', 'dnd:group-status']);

/** Bridge-side source: `onRoll` convenience + full `onEvent` access + inbound `send`. */
export interface BridgeSheetSource extends SheetSource {
    /**
     * Subscribe to every event coming from the sheet. Returns an unsubscribe fn.
     *
     * The sheet announces its state (`dnd:manifest`, and `dnd:health` as soon as the
     * character has loaded) without waiting to be asked, so a handler registered after
     * the VTT finishes its own async init would otherwise miss it and leave the token
     * blank. The last state event of each type is therefore replayed to a new handler.
     */
    onEvent(handler: (event: SheetEvent) => void): () => void;
    /**
     * Post an inbound command to the sheet (e.g. `dnd:command`), addressed to this
     * bridge's specific iframe. Returns `false` — an explicit rejection, not a
     * silent no-op — when the sheet's `contentWindow` is unavailable (the panel is
     * closed, the iframe was removed, or it hasn't loaded yet); `true` means the
     * message was posted, not that the sheet necessarily handled it.
     */
    send(event: SheetEvent): boolean;
    dispose(): void;
}

/**
 * Bridge-side half of the postMessage transport. Runs in the bridge frame (the
 * VTT extension), listens to the embedded sheet iframe, and delivers typed
 * `SheetEvent`s — without the bridge ever touching the sheet's internals.
 *
 * `contentWindow` is read live on every message/send, so it survives the sheet
 * iframe navigating or reloading (e.g. Gatsby dev's full-reload on navigation).
 */
export function createBridgeSheetSource(options: BridgeSheetSourceOptions): BridgeSheetSource {
    const host = (options.host ?? (typeof window !== 'undefined' ? window as unknown as MessageHost : undefined));
    const targetOrigin = options.targetOrigin ?? '*';
    const { iframe, allowedOrigins } = options;

    const handlers = new Set<(event: SheetEvent) => void>();
    const lastStateEvents = new Map<SheetEvent['type'], SheetEvent>();

    const listener = (event: MessageEvent): void => {
        // Only honor messages from our embedded sheet (its current contentWindow)…
        if ((event.source as unknown) !== (iframe.contentWindow as unknown)) {
            return;
        }
        // …and, when configured, only from the sheet's origin(s).
        if (allowedOrigins && !allowedOrigins.includes(event.origin)) {
            return;
        }
        const sheetEvent = readEnvelope(event.data);
        if (!sheetEvent) {
            return;
        }
        if (STATE_EVENT_TYPES.has(sheetEvent.type)) {
            lastStateEvents.set(sheetEvent.type, sheetEvent);
        }
        handlers.forEach((handler) => handler(sheetEvent));
    };

    if (host) {
        host.addEventListener('message', listener);
    }

    const subscribe = (handler: (event: SheetEvent) => void): (() => void) => {
        handlers.add(handler);
        lastStateEvents.forEach((event) => handler(event));
        return () => { handlers.delete(handler); };
    };

    return {
        onRoll(handler: (roll: DiceRollPayload) => void): () => void {
            // No replay reaches this one: rolls are never stored as state.
            return subscribe((event: SheetEvent): void => {
                if (event.type === 'dnd:roll') {
                    handler(event.payload);
                }
            });
        },
        onEvent(handler: (event: SheetEvent) => void): () => void {
            return subscribe(handler);
        },
        send(event: SheetEvent): boolean {
            if (!iframe.contentWindow) {
                return false;
            }
            iframe.contentWindow.postMessage(wrapEnvelope(event), targetOrigin);
            return true;
        },
        dispose(): void {
            handlers.clear();
            lastStateEvents.clear();
            if (host) {
                host.removeEventListener('message', listener);
            }
        },
    };
}
