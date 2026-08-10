import type {
    MessageHost, MessageTarget, SheetClient, SheetClientOptions, SheetEvent,
} from './types';
import { readEnvelope, wrapEnvelope } from './postMessageProtocol';

/**
 * Sheet-side half of the postMessage transport. The character sheet (running in
 * its own origin, embedded by a VTT bridge in a foreign origin) uses this to push
 * outbound events (rolls) to the bridge and to receive inbound commands — the
 * frame boundary keeps the sheet's DOM, cookies, and token unreadable to the
 * bridge, so only the explicit protocol crosses.
 *
 * Inbound is honored only from the same window we post to (the bridge) and,
 * optionally, an origin allowlist. Returns a safe no-op client during SSR / when
 * no message host is available. The counterpart on the bridge side is
 * `createBridgeSheetSource`.
 */
export function createSheetClient(options: SheetClientOptions = {}): SheetClient {
    const host = (options.host ?? (typeof window !== 'undefined' ? window as unknown as MessageHost : undefined));
    const target = (options.target ?? (typeof window !== 'undefined' ? window.parent as unknown as MessageTarget : undefined));
    const targetOrigin = options.targetOrigin ?? '*';
    const { allowedOrigins } = options;

    if (!host) {
        return { send: () => {}, onEvent: () => () => {}, dispose: () => {} };
    }

    const handlers = new Set<(event: SheetEvent) => void>();

    const listener = (event: MessageEvent): void => {
        // Only honor messages from the window we post to (the bridge)…
        if (target && (event.source as unknown) !== (target as unknown)) {
            return;
        }
        // …and, when configured, only from allowed origins.
        if (allowedOrigins && !allowedOrigins.includes(event.origin)) {
            return;
        }
        const sheetEvent = readEnvelope(event.data);
        if (!sheetEvent) {
            return;
        }
        handlers.forEach((handler) => handler(sheetEvent));
    };

    host.addEventListener('message', listener);

    return {
        send(event: SheetEvent): void {
            if (!target) {
                return;
            }
            target.postMessage(wrapEnvelope(event), targetOrigin);

            // Transitional duplicate: bridges built against ≤0.6.0 listen for the old
            // `dnd:roll` name and would go silent the moment the sheet stopped sending
            // it. Hosts on 0.7.0+ drop this copy on arrival (createBridgeSheetSource),
            // so nobody sees a roll twice. Delete both halves once our own bridges are
            // redeployed — the sheet is the only emitter, so that is the whole migration.
            if (event.type === 'lss:roll') {
                target.postMessage(wrapEnvelope({ type: 'dnd:roll', payload: event.payload }), targetOrigin);
            }
        },
        onEvent(handler: (event: SheetEvent) => void): () => void {
            handlers.add(handler);
            return () => { handlers.delete(handler); };
        },
        dispose(): void {
            handlers.clear();
            host.removeEventListener('message', listener);
        },
    };
}
