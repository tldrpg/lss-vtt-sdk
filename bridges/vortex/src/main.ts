import {
    VORTEX_ORIGIN,
    VORTEX_COLOR_SCHEME,
    ROOM_METADATA_KEY,
    LOGGER_POPOVER_ID,
    IFRAME_SANDBOX,
    PILL_HEIGHT,
    BRIDGE_CHANNEL,
    isVortexMessage,
} from './shared';
import type { BridgeMessage } from './shared';

function buildVortexUrl(path: string): string {
    const url = new URL(path, VORTEX_ORIGIN);
    if (VORTEX_COLOR_SCHEME) url.searchParams.set('colorScheme', VORTEX_COLOR_SCHEME);
    return url.href;
}

let loggerOpen = false;

// In production, OBR is injected into window by OBR itself
// In test, window.OBR is our mock
declare global { interface Window { OBR: any; } }

async function init() {
    if (!window.OBR) {
        let parentOBR: unknown = null;
        try {
            parentOBR = (window.parent as any)?.OBR;
        } catch {
            // cross-origin parent (production OBR) — expected, fall through to SDK import
        }
        if (parentOBR) {
            (window as any).OBR = parentOBR;
        } else {
            const { default: RealOBR } = await import('@owlbear-rodeo/sdk');
            (window as any).OBR = RealOBR;
        }
    }

    console.log('[Vortex Bridge] Initializing...');
    await window.OBR.onReady();
    console.log('[Vortex Bridge] OBR is ready');

    const contentEl = document.getElementById('content');

    if (!contentEl) {
        throw new Error('Required DOM elements not found');
    }

    // Relative to the action page (index.html), not the JS bundle in assets/
    const loggerUrl = new URL('logger.html', window.location.href).href;

    // Logger resizes itself via BroadcastChannel — main frame calls OBR on its behalf
    // because OBR.popover.open from within a popover frame may be a no-op.
    const bridgeChannel = new BroadcastChannel(BRIDGE_CHANNEL);
    bridgeChannel.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
        if (event.data.type === 'logger:resize') {
            window.OBR.popover.open({
                id: LOGGER_POPOVER_ID,
                url: loggerUrl,
                width: 380,
                height: event.data.height,
                anchorPosition: 'BOTTOM_RIGHT',
            }).catch(console.error);
        }
    });

    async function syncLogger(roomId: string | undefined) {
        if (roomId && !loggerOpen) {
            loggerOpen = true;
            await window.OBR.popover.open({
                id: LOGGER_POPOVER_ID,
                url: loggerUrl,
                width: 380,
                height: PILL_HEIGHT,
                anchorPosition: 'BOTTOM_RIGHT',
            });
        } else if (!roomId && loggerOpen) {
            loggerOpen = false;
            await window.OBR.popover.close(LOGGER_POPOVER_ID);
        }
    }

    async function renderContent() {
        try {
            const room = (await window.OBR.room.getMetadata()) as Record<
                string,
                unknown
            >;
            const roomId = room[ROOM_METADATA_KEY] as string | undefined;
            const targetUrl = roomId
                ? buildVortexUrl(`/room/${roomId}`)
                : buildVortexUrl('/iframe/');

            const existing = contentEl.querySelector('iframe') as HTMLIFrameElement | null;
            if (existing && existing.src === targetUrl) {
                return;
            }

            contentEl.innerHTML = '';

            const iframe = document.createElement('iframe');
            iframe.src = targetUrl;
            iframe.sandbox.add(...IFRAME_SANDBOX.split(' '));
            iframe.allow = 'clipboard-write';
            contentEl.appendChild(iframe);

            await syncLogger(roomId);
        } catch (error) {
            console.error('[Vortex Bridge] Error rendering content:', error);
        }
    }

    window.addEventListener('message', (event) => {
        if (event.origin !== VORTEX_ORIGIN) {
            return;
        }

        if (!isVortexMessage(event.data)) {
            return;
        }

        if (event.data.type === 'vortex:roomSelected') {
            window.OBR.room.setMetadata({
                [ROOM_METADATA_KEY]: event.data.roomId,
            }).catch((error: unknown) => {
                console.error('[Vortex Bridge] Failed to set metadata:', error);
            });
        }

        if (event.data.type === 'vortex:roomNotFound') {
            window.OBR.room.setMetadata({
                [ROOM_METADATA_KEY]: undefined,
            }).catch((error: unknown) => {
                console.error('[Vortex Bridge] Failed to clear metadata after room not found:', error);
            });
        }
    });

    // Wait for OBR to be fully ready before using room API
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Initial render
    await renderContent();

    // Subscribe to metadata changes
    window.OBR.room.onMetadataChange(() => {
        renderContent().catch((error) => {
            console.error('[Vortex Bridge] Metadata change handler error:', error);
        });
    });
}

init().catch(console.error);
