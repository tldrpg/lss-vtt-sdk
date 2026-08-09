# @longstoryshort/vtt-sdk

Embed a [longstoryshort.app](https://longstoryshort.app) character sheet in any virtual tabletop via iframe and postMessage.

## How it works

The sheet and your VTT run at different origins. They communicate only via `window.postMessage` — your code never reads the sheet's DOM, cookies, or auth token.

```
Your page (your origin)
  └── LSS sheet iframe (longstoryshort.app)
        └── postMessage ──→ your page
```

## Installation

```sh
npm install @longstoryshort/vtt-sdk
```

For Owlbear Rodeo, also install the peer dependency:

```sh
npm install @owlbear-rodeo/sdk
```

## Packages

| Import | Contents |
|--------|----------|
| `@longstoryshort/vtt-sdk` | Core: protocol types, `createBridgeSheetSource`, `createSheetClient`, `formatRollMessage`, `SHEET_IFRAME_SANDBOX` |
| `@longstoryshort/vtt-sdk/owlbear` | `OwlbearAdapter`, `ObrAdapter`, OBR bootstrap helpers |

## Quick start

```ts
import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

// Embed the sheet
const iframe = document.createElement('iframe');
iframe.src = 'https://longstoryshort.app/iframe/characters/list/';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

// Receive rolls
const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

source.onRoll((roll) => {
    // wire to your VTT — notification, chat, peer broadcast, etc.
    console.log(formatRollMessage(roll), rollVariant(roll));
});

// cleanup
source.dispose();
```

## Documentation

The full guides — sandbox requirements, protocol reference, utilities, and the annotated
bridge/`OwlbearAdapter` reference — live in the Long Story Short docs, not in this repo:

- [SDK guide](https://longstoryshort.app/doc/developers/embedding/sdk-guide/) — start here regardless of your VTT architecture.
- [Bridge guide](https://longstoryshort.app/doc/developers/embedding/bridge-guide/) — for VTTs that use an extension/plugin model and need a separate static bridge page.

This repo keeps the code: the SDK source, the bridge template, and the deployed Owlbear
Rodeo reference bridge below.

## Reference bridge — Owlbear Rodeo (D&D 5e)

A deployable bridge for Owlbear Rodeo lives in [`bridges/dnd/`](bridges/dnd/). Deployed automatically to GitHub Pages on every push to `master`.

**Live manifest:** `https://bridge.longstoryshort.app/dnd/obr/manifest.json`

To install in OBR: Extensions → Add extension → paste the manifest URL above.

## Bridge template

[`bridges/_template/`](bridges/_template/) is a minimal copy-and-modify skeleton — iframe embed + `createBridgeSheetSource` + `TODO` comments for your VTT's APIs, ready to build with Vite.

## Protocol events

| Type | Status | Direction | Description |
|------|--------|-----------|-------------|
| `dnd:roll` | ✅ stable | sheet → host | A roll result |
| `dnd:manifest` | 🧪 reserved | sheet → host | Sheet capabilities at handshake |
| `dnd:health` | 🧪 reserved | sheet → host | HP after an adjust/set |
| `dnd:command` | 🧪 reserved | host → sheet | Inbound ops (adjust HP, toggle condition, …) |

Reserved events are typed and wired end-to-end, but the bridge-side API is experimental. Subscribe via `source.onEvent` directly.

## License

MIT
