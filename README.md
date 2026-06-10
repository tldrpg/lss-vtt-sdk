# @longstoryshort/vtt-sdk

Embed a [longstoryshort.app](https://longstoryshort.app) character sheet in any virtual tabletop (VTT) via iframe and postMessage.

## How it works

The SDK implements a postMessage-based protocol that lets a VTT extension (the "bridge") embed the LSS sheet in a nested iframe and receive dice rolls, manifests, and other events — without ever reading the sheet's DOM, cookies, or auth token.

```
OBR / Foundry / … ──► [bridge page, FOREIGN origin]
                           │  embeds iframe ↓   ← trust boundary (postMessage only)
                           └► [LSS sheet, lss origin]
```

## Installation

```sh
npm install @longstoryshort/vtt-sdk
```

The Owlbear adapter is an optional peer dependency:

```sh
npm install @owlbear-rodeo/sdk
```

## Packages

| Import | Contents |
|--------|----------|
| `@longstoryshort/vtt-sdk` | Core: protocol types, `createBridgeSheetSource`, `createSheetClient`, `formatRollMessage`, `SHEET_IFRAME_SANDBOX` |
| `@longstoryshort/vtt-sdk/owlbear` | `OwlbearAdapter`, `syncObrref`, OBR bootstrap helpers |

## Quick start — bridge side

```ts
import { createBridgeSheetSource, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

const source = createBridgeSheetSource({
    iframe: document.getElementById('sheet-frame') as HTMLIFrameElement,
    allowedOrigins: ['https://longstoryshort.app'],
});

source.onRoll((roll) => {
    // wire to your VTT's APIs — notify, broadcast, label, chat, etc.
    console.log(formatRollMessage(roll), rollVariant(roll));
});

// later:
source.dispose();
```

For the full Owlbear Rodeo bridge (notify + peer broadcast + token label), see [`bridges/dnd/src/main.ts`](bridges/dnd/src/main.ts).

## Quick start — sheet side

```ts
import { createSheetClient } from '@longstoryshort/vtt-sdk';

const client = createSheetClient();

// emit a roll to the bridge
client.send({ type: 'dnd:roll', payload: { ... } });

// receive inbound commands from the bridge
const unsub = client.onEvent((event) => {
    if (event.type === 'dnd:command') { /* handle damage, conditions, … */ }
});

// cleanup
client.dispose();
```

## iframe sandbox requirements

The bridge must embed the sheet iframe with at least these sandbox tokens:

```
sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"
```

`allow-same-origin` is required so the sheet can read its auth cookie and access localStorage. Without it the sheet gets an opaque origin and auth breaks.

## Adapt for your own VTT

The bridge template in [`bridges/_template/`](bridges/_template/) is a copy-and-modify starting point — a stub `VTTAdapter` wired to `createBridgeSheetSource` + `createRollBridge`, ready to build with Vite.

See the [integration guide](docs/integration-guide.md) for a line-by-line walkthrough: sandbox requirements, the `VTTAdapter` seam, what `createRollBridge` does internally, and how to handle experimental events.

## Reference bridge — Owlbear Rodeo (D&D 5e)

A deployable vanilla-TS bridge for Owlbear Rodeo lives in [`bridges/dnd/`](bridges/dnd/). It is automatically deployed to GitHub Pages on every push to `master`.

**Live manifest:** `https://bridge.longstoryshort.app/dnd/obr/manifest.json`

To install the extension in OBR: Extensions → Add extension → paste the manifest URL above.

To adapt for your own VTT: copy `bridges/dnd/src/main.ts`, swap `OwlbearAdapter` for your own `VTTAdapter` implementation, and deploy as a static page.

## Protocol events

| Type | Status | Direction | Description |
|------|--------|-----------|-------------|
| `dnd:roll`     | ✅ stable       | sheet → host | A roll result |
| `dnd:manifest` | 🧪 reserved     | sheet → host | Sheet capabilities at handshake |
| `dnd:health`   | 🧪 reserved     | sheet → host | HP after an adjust/set |
| `dnd:command`  | 🧪 reserved     | host → sheet | Narrow inbound ops (adjust HP, toggle condition, …) |

Reserved events are typed and functional — the sheet implements them — but the bridge-side wiring is considered experimental API and may change. Wire them directly via `BridgeSheetSource.onEvent` rather than through `createRollBridge`.

## License

MIT
