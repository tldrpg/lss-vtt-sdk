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
| `@longstoryshort/vtt-sdk` | Core: types, `createSheetBridge`, `createSheetClient`, `createBridgeSheetSource`, `formatRollMessage` |
| `@longstoryshort/vtt-sdk/owlbear` | `OwlbearAdapter`, `syncObrref`, constants |

## Quick start — bridge side

```ts
import { createSheetBridge, createBridgeSheetSource } from '@longstoryshort/vtt-sdk';
import { OwlbearAdapter } from '@longstoryshort/vtt-sdk/owlbear';

const adapter = new OwlbearAdapter();
const source = createBridgeSheetSource({
    iframe: document.getElementById('sheet-frame') as HTMLIFrameElement,
    allowedOrigins: ['https://longstoryshort.app'],
});

const dispose = createSheetBridge(source, adapter, {
    messages: {
        connected: '🎲 Sheet connected',
        labelHint: 'Select exactly one token to place a roll label',
    },
});

// later:
dispose();
source.dispose();
```

## Quick start — sheet side

```ts
import { createSheetClient } from '@longstoryshort/vtt-sdk';

const client = createSheetClient();

// emit a roll to the bridge
client.send({ type: 'DICE_ROLL', payload: { ... } });

// receive inbound commands from the bridge
const unsub = client.onEvent((event) => {
    if (event.type === 'CAPABILITY_COMMAND') { /* handle damage, conditions, … */ }
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

## Reference bridge

A ready-to-adapt React bridge page for Owlbear Rodeo lives in [`bridges/owlbear/index.tsx`](bridges/owlbear/index.tsx). It is NOT published to npm — deploy it as a separate page from your own infrastructure.

## Protocol events

| Type | Direction | Description |
|------|-----------|-------------|
| `DICE_ROLL` | sheet → bridge | A roll result |
| `MANIFEST` | sheet → bridge | Sheet capabilities at handshake |
| `HEALTH_CHANGED` | sheet → bridge | HP after an adjust/set |
| `CAPABILITY_COMMAND` | bridge → sheet | Narrow inbound ops (adjust HP, toggle condition, …) |

## License

MIT
