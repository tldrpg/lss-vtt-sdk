import { createBridgeSheetSource, createRollBridge, SHEET_IFRAME_SANDBOX } from '@longstoryshort/vtt-sdk';
import { MyVTTAdapter } from './adapter';

// The URL of the LSS sheet page your VTT will embed.
// For production bridges this is always the list page — the sheet handles
// per-character routing itself once it loads.
const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';

// --- 1. Embed the sheet -------------------------------------------------------

const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

// --- 2. Create the postMessage transport -------------------------------------

const source = createBridgeSheetSource({
    iframe,
    // Only honor messages that originate from the LSS sheet origin.
    // Remove or adjust if you host the sheet yourself.
    allowedOrigins: ['https://longstoryshort.app'],
});

// --- 3. Wire up the roll bridge ----------------------------------------------

const disposeRollBridge = createRollBridge(source, new MyVTTAdapter(), {
    messages: {
        // Toast shown once when the adapter handshakes with your VTT.
        connected: 'Sheet connected',
        // Toast shown to the roller when no label could be placed (no token selected).
        labelHint: 'Select a token to show your roll result above it',
    },
});

// --- Cleanup (call on extension unload if your VTT supports it) --------------

// disposeRollBridge();
// source.dispose();
