import type {
    CapabilityManifest, DiceRollPayload, MessageHost, SheetEvent, SheetSource,
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

/** A `SheetSource` (for `createSheetBridge`) plus raw access and inbound `send`. */
export interface BridgeSheetSource extends SheetSource {
    /** Subscribe to the sheet's capability manifest (sent once at handshake). Returns an unsubscribe fn. */
    onManifest(handler: (manifest: CapabilityManifest) => void): () => void;
    /** Subscribe to every event coming from the sheet (not only rolls). */
    onEvent(handler: (event: SheetEvent) => void): () => void;
    /** Post an inbound command to the sheet (e.g. `dnd:command`). */
    send(event: SheetEvent): void;
    dispose(): void;
}

/**
 * Bridge-side half of the postMessage transport. Runs in the bridge frame (the
 * VTT extension), listens to the embedded sheet iframe, and exposes a
 * `SheetSource` so `createSheetBridge` can drive the VTT adapter — without the
 * bridge ever touching the sheet's internals.
 *
 * `contentWindow` is read live on every message/send, so it survives the sheet
 * iframe navigating or reloading (e.g. Gatsby dev's full-reload on navigation).
 */
export function createBridgeSheetSource(options: BridgeSheetSourceOptions): BridgeSheetSource {
    const host = (options.host ?? (typeof window !== 'undefined' ? window as unknown as MessageHost : undefined));
    const targetOrigin = options.targetOrigin ?? '*';
    const { iframe, allowedOrigins } = options;

    const handlers = new Set<(event: SheetEvent) => void>();

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
        handlers.forEach((handler) => handler(sheetEvent));
    };

    if (host) {
        host.addEventListener('message', listener);
    }

    return {
        onRoll(handler: (roll: DiceRollPayload) => void): () => void {
            const wrapped = (event: SheetEvent): void => {
                if (event.type === 'dnd:roll') {
                    handler(event.payload);
                }
            };
            handlers.add(wrapped);
            return () => { handlers.delete(wrapped); };
        },
        onManifest(handler: (manifest: CapabilityManifest) => void): () => void {
            const wrapped = (event: SheetEvent): void => {
                if (event.type === 'dnd:manifest') {
                    handler(event.payload);
                }
            };
            handlers.add(wrapped);
            return () => { handlers.delete(wrapped); };
        },
        onEvent(handler: (event: SheetEvent) => void): () => void {
            handlers.add(handler);
            return () => { handlers.delete(handler); };
        },
        send(event: SheetEvent): void {
            iframe.contentWindow?.postMessage(wrapEnvelope(event), targetOrigin);
        },
        dispose(): void {
            handlers.clear();
            if (host) {
                host.removeEventListener('message', listener);
            }
        },
    };
}
