import * as obrSdk from '@owlbear-rodeo/sdk';
import { syncObrref, OwlbearAdapter, preloadObrSdk, NOTIFY_ROLLS_KEY } from '@longstoryshort/vtt-sdk/owlbear';
import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

// Restore obrref before the SDK reads it, and stash the already-imported
// module so loadObrSdk() reuses it instead of a late dynamic import that
// could miss the one-shot OBR_READY handshake.
syncObrref();
preloadObrSdk(obrSdk);

const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';

const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

const adapter = new OwlbearAdapter();

// Gate everything on OBR being ready — rolls that arrive before init are ignored.
void adapter.ready().then((ok) => {
    if (!ok) return;
    adapter.notify('🎲 Sheet connected to the table', 'success');

    // Vortex bridge writes NOTIFY_ROLLS_KEY=false when its logger is active so
    // notifications don't double up with the logger's own roll display.
    let notifyRolls = true;
    const applySettings = (meta: Record<string, unknown>): void => {
        notifyRolls = meta[NOTIFY_ROLLS_KEY] !== false;
    };
    void adapter.getRoomMetadata().then(applySettings);
    adapter.onRoomMetadataChange(() => { void adapter.getRoomMetadata().then(applySettings); });

    // When the sheet posts a roll: local toast for the roller, broadcast to peers.
    source.onRoll((roll) => {
        if (notifyRolls) adapter.notify(formatRollMessage(roll), rollVariant(roll));
        adapter.broadcast({ type: 'dnd:roll', payload: roll });
    });

    // Relay rolls broadcast by other players as local toasts.
    source.onEvent((event) => {
        if (event.type === 'dnd:roll' && notifyRolls) {
            adapter.notify(formatRollMessage(event.payload), rollVariant(event.payload));
        }
    });
});
