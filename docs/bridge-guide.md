# Bridge guide — VTT extension model

Some VTTs (Owlbear Rodeo is the primary example) load integrations as browser extensions that can only open a URL — they cannot run arbitrary npm code directly. For these VTTs you need a **bridge page**: a static HTML/JS page you deploy yourself, which the extension opens, and which then embeds the LSS sheet iframe.

```
VTT extension runtime
  └── bridge page  (your static page, deployed by you)
        └── LSS sheet iframe (longstoryshort.app)
              └── postMessage ──→ bridge page ──→ VTT SDK calls
```

If your VTT is a web app, a desktop app, or anything else where you fully control the code, **you don't need a bridge page** — install the SDK as an npm package and use it directly in your existing code. See [sdk-guide.md](./sdk-guide.md).

---

## Setting up a bridge page

The template in [`bridges/_template/`](../bridges/_template/) is a minimal starting point. It uses Vite:

```sh
cd bridges/_template
npm install
npm run dev     # local dev server
npm run build   # production build → dist/
```

`index.html` is a blank page that loads `src/main.ts`. All the wiring lives in `main.ts`.

---

## Wiring pattern

`bridges/_template/src/main.ts` shows the minimal pattern — no adapter interface, no abstraction layer:

```ts
import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

// 1. Embed the sheet
const iframe = document.createElement('iframe');
iframe.src = 'https://longstoryshort.app/iframe/characters/list/';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

// 2. Wire rolls to your VTT's APIs
const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});

source.onRoll((roll) => {
    const message = formatRollMessage(roll); // "🎲 Alice: Longsword Attack — 18"
    const variant = rollVariant(roll);       // 'info' | 'success' | 'warning'

    myVTT.notification.show(message, variant);
    myVTT.room.broadcast(JSON.stringify({ type: 'dnd:roll', payload: roll }));
});

// 3. Relay broadcasts from other players back as local notifications
myVTT.room.onBroadcast((raw) => {
    const event = JSON.parse(raw);
    if (event.type === 'dnd:roll') {
        myVTT.notification.show(
            formatRollMessage(event.payload),
            rollVariant(event.payload),
        );
    }
});
```

Replace `myVTT.*` with your VTT's own API. There is no adapter interface to implement — the SDK delivers typed events; what you do with them is your bridge's business.

---

## Owlbear Rodeo reference bridge

`bridges/dnd/src/main.ts` is the full deployed OBR bridge. It follows the same pattern but uses `OwlbearAdapter` — a helper class that wraps OBR's room, notification, and scene APIs.

```ts
import * as obrSdk from '@owlbear-rodeo/sdk';
import { syncObrref, OwlbearAdapter, preloadObrSdk } from '@longstoryshort/vtt-sdk/owlbear';
import { createBridgeSheetSource, SHEET_IFRAME_SANDBOX, formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

// OBR extensions load inside a frame whose parent already holds the OBR SDK.
// syncObrref() reads the obrref cookie OBR injects into the frame URL.
// preloadObrSdk() caches the already-imported module so a late dynamic import
// cannot miss the one-shot OBR_READY handshake.
syncObrref();
preloadObrSdk(obrSdk);

const iframe = document.createElement('iframe');
iframe.src = 'https://longstoryshort.app/iframe/characters/list/';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

const source = createBridgeSheetSource({ iframe, allowedOrigins: ['https://longstoryshort.app'] });
const adapter = new OwlbearAdapter();

// Gate subscriptions on OBR being ready — rolls that arrive before init are dropped.
void adapter.ready().then((ok) => {
    if (!ok) return;
    adapter.notify('🎲 Sheet connected to the table', 'success');

    source.onRoll((roll) => {
        // Local toast for the roller (OBR broadcast is remote-only).
        adapter.notify(formatRollMessage(roll), rollVariant(roll));
        // Broadcast to all other clients in the room.
        adapter.broadcast({ type: 'dnd:roll', payload: roll });
        // Try to place a floating label above the roller's selected token.
        void adapter.labelOverSelection(roll.total).then((placed) => {
            if (!placed) {
                adapter.notify('No label placed — select exactly one of your tokens on the map', 'warning');
            }
        });
    });

    // Display rolls broadcast by other players.
    source.onEvent((event) => {
        if (event.type === 'dnd:roll') {
            adapter.notify(formatRollMessage(event.payload), rollVariant(event.payload));
        }
    });
});
```

---

## `OwlbearAdapter` reference

`OwlbearAdapter` is exported from `@longstoryshort/vtt-sdk/owlbear`. It implements the `ObrAdapter` interface (also exported from the same entry point).

| Method | Description |
|--------|-------------|
| `ready()` | Awaits OBR's `onReady` event. Resolves `false` if the page is not inside an OBR extension. Safe to call multiple times. |
| `isAvailable` | `true` once `ready()` has resolved successfully. |
| `notify(message, variant?)` | Shows an OBR toast notification. `variant` is `'info' \| 'success' \| 'warning' \| 'error'`. |
| `broadcast(event)` | Sends via `OBR.broadcast` to all other clients in the room (the sender is excluded). |
| `onEvent(handler)` | Subscribes to broadcasts from other clients. Returns an unsubscribe fn. |
| `labelOverSelection(text, ttlMs?)` | Adds a transient text label item above the selected token on the OBR scene map. Shared — all players see it. Resolves `false` if no token is selected, the scene is unavailable, or the write is rejected. |
| `getSessionId()` | Returns the OBR room ID, available after `ready()`. |
| `getCurrentUser()` | Returns `{ id, name, role }` for the current OBR player, available after `ready()`. |
| `dispose()` | Marks the adapter as disposed. |

### OBR bootstrap helpers

Also exported from `@longstoryshort/vtt-sdk/owlbear`:

| Export | Description |
|--------|-------------|
| `preloadObrSdk(sdk)` | Cache the statically-imported OBR module so a late dynamic import cannot miss the one-shot `OBR_READY` event. Call before any `await`. |
| `syncObrref()` | Restore the `obrref` cookie that OBR injects into the extension frame URL. Required after client-side navigation resets URL state. |
| `whenObrReady(obr)` | Promisify `OBR.onReady()`. Used internally by `OwlbearAdapter`. |

---

## Deployment

A bridge page is a static site. Build with Vite:

```sh
vite build   # → dist/
```

Set `base` in `vite.config.ts` to match your deployment path:

```ts
export default defineConfig({
    base: '/my-vtt/',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
```

Deploy `dist/` to any static host — GitHub Pages, Cloudflare Pages, Netlify.

For OBR extensions, point the manifest's `action.url` at your deployed `index.html`. See [`bridges/dnd/public/manifest.json`](../bridges/dnd/public/manifest.json) for the OBR manifest shape.
