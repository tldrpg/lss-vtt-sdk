import {
    VORTEX_ORIGIN,
    ROOM_METADATA_KEY,
    LOGGER_POPOVER_ID,
    loggerPopoverAnchor,
    IFRAME_SANDBOX,
    PILL_HEIGHT,
    BRIDGE_CHANNEL,
    isVortexMessage,
    buildVortexUrl,
    resolveOBR,
} from './shared';
import type { BridgeMessage } from './shared';

let loggerOpen = false;

declare global { interface Window { OBR: any; } }

async function init() {
    await resolveOBR();

    console.log('[Vortex Bridge] Initializing...');
    // OBR.onReady() takes a callback; wrap it in a Promise so we wait until
    // the OBR_READY handshake completes and room API calls become available.
    await new Promise<void>((resolve) => window.OBR.onReady(resolve));
    console.log('[Vortex Bridge] OBR is ready');

    const contentEl = document.getElementById('content')!;

    // Relative to the action page (index.html), not the JS bundle in assets/
    const loggerUrl = new URL('logger.html', window.location.href).href;

    function loggerPopoverConfig(height: number) {
        return {
            id: LOGGER_POPOVER_ID,
            url: loggerUrl,
            width: 380,
            height,
            disableClickAway: true,
            hidePaper: true,
            ...loggerPopoverAnchor(),
        };
    }

    // Logger resizes itself via BroadcastChannel — main frame calls OBR on its behalf
    // because OBR.popover.open from within a popover frame may be a no-op.
    const bridgeChannel = new BroadcastChannel(BRIDGE_CHANNEL);
    bridgeChannel.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
        if (event.data.type === 'logger:resize') {
            window.OBR.popover.open(loggerPopoverConfig(event.data.height)).catch(console.error);
        }
    });

    async function syncLogger(roomId: string | undefined) {
        if (roomId) {
            // Always (re-)open so the logger comes back if OBR closed it externally.
            loggerOpen = true;
            await window.OBR.popover.open(loggerPopoverConfig(PILL_HEIGHT));
        } else if (loggerOpen) {
            loggerOpen = false;
            await window.OBR.popover.close(LOGGER_POPOVER_ID);
        }
    }

    async function renderContent() {
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

        if (event.data.type === 'vortex:windowResize') {
            window.OBR.action.setHeight(event.data.height).catch((error: unknown) => {
                console.error('[Vortex Bridge] Failed to resize action:', error);
            });
        }
    });

    await renderContent().catch((error) => {
        console.error('[Vortex Bridge] Error rendering content:', error);
    });

    // Subscribe to metadata changes
    window.OBR.room.onMetadataChange(() => {
        renderContent().catch((error) => {
            console.error('[Vortex Bridge] Metadata change handler error:', error);
        });
    });

    // OBR may close the logger popover when the action popup is shown/hidden.
    // Re-open it whenever the action becomes visible.
    window.OBR.action.onOpenChange((isOpen: boolean) => {
        if (!isOpen) {
            // Treat external close as a signal to re-open on the next show.
            loggerOpen = false;
            return;
        }
        renderContent().catch((error) => {
            console.error('[Vortex Bridge] onOpenChange render error:', error);
        });
    });
}

init().catch(console.error);
