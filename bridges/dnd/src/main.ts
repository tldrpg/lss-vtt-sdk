import * as obrSdk from '@owlbear-rodeo/sdk';
import { syncObrref, OwlbearAdapter } from '@longstoryshort/vtt-sdk/owlbear';
import { createBridgeSheetSource, createSheetBridge } from '@longstoryshort/vtt-sdk';

// Restore obrref before the SDK reads it, and stash the already-imported
// module so OwlbearAdapter.loadSdk() reuses it instead of a late dynamic
// import that could miss the one-shot OBR_READY handshake.
syncObrref();
(window as Record<string, unknown>)['__lssObrSdk'] = obrSdk;

const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';

const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute(
    'sandbox',
    'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals',
);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

createSheetBridge(source, new OwlbearAdapter());
