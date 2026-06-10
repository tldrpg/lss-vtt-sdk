import * as obrSdk from '@owlbear-rodeo/sdk';
import { syncObrref, OwlbearAdapter, preloadObrSdk } from '@longstoryshort/vtt-sdk/owlbear';
import { createBridgeSheetSource, createRollBridge, SHEET_IFRAME_SANDBOX } from '@longstoryshort/vtt-sdk';

// Restore obrref before the SDK reads it, and stash the already-imported
// module so loadObrSdk() reuses it instead of a late dynamic import that
// could miss the one-shot OBR_READY handshake.
syncObrref();
preloadObrSdk(obrSdk);

const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';

const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute(
    'sandbox',
    SHEET_IFRAME_SANDBOX,
);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

createRollBridge(source, new OwlbearAdapter());
