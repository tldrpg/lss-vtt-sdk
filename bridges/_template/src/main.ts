import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';

// --- Embed the sheet ---------------------------------------------------------

const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

// --- Listen for rolls --------------------------------------------------------

const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

source.onRoll((roll) => {
    const message = formatRollMessage(roll); // e.g. "🎲 Alice: Longsword Attack — 18"
    const variant = rollVariant(roll);       // 'info' | 'success' | 'warning'

    // TODO: wire to your VTT's notification and peer-broadcast APIs
    // e.g. myVTT.notification.show(message, variant);
    //      myVTT.room.broadcast(JSON.stringify({ type: 'dnd:roll', payload: roll }));
    console.log('[Roll]', message, variant);
});

// TODO: relay broadcasts from other clients back as local notifications
// e.g. myVTT.room.onBroadcast((raw) => {
//     const event = JSON.parse(raw);
//     if (event.type === 'dnd:roll') {
//         myVTT.notification.show(
//             formatRollMessage(event.payload),
//             rollVariant(event.payload),
//         );
//     }
// });

// --- Cleanup (call on extension unload if your VTT supports it) --------------
// source.dispose();
