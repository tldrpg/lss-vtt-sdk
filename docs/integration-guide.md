# Integration guide — embedding the LSS sheet in your VTT

This guide explains how to build a VTT bridge: a static page that embeds the LSS character sheet in an iframe and relays dice rolls to your virtual tabletop.

The D&D/OBR bridge in [`bridges/dnd/`](../bridges/dnd/) is the deployed reference. The skeleton in [`bridges/_template/`](../bridges/_template/) is a copy-and-modify starting point for any other VTT.

---

## Architecture

```
Your VTT extension
  └── bridge page  (your origin — the static HTML/JS you deploy)
        │  embeds ↓            ← trust boundary — postMessage only
        └── LSS sheet iframe   (longstoryshort.app)
```

The bridge and the sheet run at **different origins**. They communicate only via `window.postMessage` — the bridge never touches the sheet's DOM, cookies, or auth token. This is the contract the SDK enforces, and it is why `allow-same-origin` must be in the iframe sandbox (the sheet needs to read its _own_ auth cookie, not the bridge's).

---

## Step 1: Embed the sheet iframe

```ts
import { SHEET_IFRAME_SANDBOX } from '@longstoryshort/vtt-sdk';

const iframe = document.createElement('iframe');
iframe.src = 'https://longstoryshort.app/iframe/characters/list/';
iframe.title = 'LSS Character Sheet';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);
```

`SHEET_IFRAME_SANDBOX` expands to:

```
allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals
```

| Token | Why it's needed |
|-------|-----------------|
| `allow-same-origin` | The sheet reads its own auth cookie and `localStorage`. Without it the sheet gets an opaque origin — login breaks. |
| `allow-scripts` | The sheet is a JS app. |
| `allow-popups` | OAuth redirect windows. |
| `allow-popups-to-escape-sandbox` | Auth pop-ups must open in a normal browsing context, not inherit the sandbox. |
| `allow-forms` | Form submissions inside the sheet. |
| `allow-modals` | Native dialog boxes. |

`clipboard-write` is a Permissions Policy token, set via `allow=`, not `sandbox=`.

---

## Step 2: Create the sheet source

```ts
import { createBridgeSheetSource } from '@longstoryshort/vtt-sdk';

const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});
```

`createBridgeSheetSource` attaches a `message` listener on `window` and filters for envelopes that:

1. come from an allowed origin (`https://longstoryshort.app`)
2. carry the current protocol version tag (a version mismatch is silently dropped — deploy the bridge and the sheet together when the SDK version changes)
3. originate from the specific `iframe.contentWindow` (ignores messages from unrelated frames on the same page)

The returned `BridgeSheetSource` exposes:

| Method | What it does |
|--------|--------------|
| `onRoll(handler)` | subscribe to `dnd:roll` events; returns an unsubscribe fn |
| `onManifest(handler)` | subscribe to `dnd:manifest` (experimental) |
| `onEvent(handler)` | subscribe to all events from the sheet |
| `send(event)` | post a `dnd:command` inbound to the sheet |
| `dispose()` | remove the `message` listener |

`onRoll` is the convenience method for the common case. For experimental events, use `onEvent` directly (see [Going beyond rolls](#going-beyond-rolls)).

---

## Step 3: Implement a VTTAdapter

`VTTAdapter` is the seam between the SDK and your VTT's own SDK. Every method is either a thin wrapper over your VTT API or a no-op returning a sensible default.

The full interface:

```ts
export interface VTTAdapter {
    readonly isAvailable: boolean;
    ready(): Promise<boolean>;
    getSessionId(): string | undefined;
    getCurrentUser(): VTTUser | undefined;
    broadcast(event: SheetEvent): void;
    onEvent(handler: (event: SheetEvent) => void): () => void;
    notify(message: string, variant?: NotifyVariant): void;
    labelOverSelection(text: string, ttlMs?: number): Promise<boolean>;
    dispose(): void;
}
```

### Method-by-method

**`isAvailable`**

Guards against the bridge being opened in a plain browser tab (for debugging, CI, etc.). Return `true` only when the page is actually running inside your VTT.

```ts
get isAvailable(): boolean {
    return typeof window !== 'undefined' && 'MyVTT' in window;
}
```

**`ready(): Promise<boolean>`**

Called once by `createRollBridge`. Await your VTT SDK's init/connect handshake here. Resolve `false` if `isAvailable` is false — the bridge skips all further work.

```ts
async ready(): Promise<boolean> {
    if (!this.isAvailable) return false;
    await MyVTT.initialize();
    return true;
}
```

**`getSessionId()` / `getCurrentUser()`**

Return context used for logging and correlation. Return `undefined` if not yet available — no operations depend on these being present.

**`broadcast(event)` / `onEvent(handler)`**

These form the peer-messaging channel. When a player makes a roll:
- `broadcast` sends the event to every other player in the room.
- Other players' adapters receive it via `onEvent` and display the roll in their UI.

```ts
broadcast(event: SheetEvent): void {
    MyVTT.room.broadcast(JSON.stringify(event));
}

onEvent(handler: (event: SheetEvent) => void): () => void {
    return MyVTT.room.onBroadcast((raw: string) => {
        try { handler(JSON.parse(raw) as SheetEvent); }
        catch { /* ignore malformed messages */ }
    });
}
```

**`notify(message, variant?)`**

Show a local toast on this client. `variant` is `'info' | 'success' | 'warning' | 'error'`.

**`labelOverSelection(text, ttlMs?)`**

Place a transient text label over the currently selected token. Scene items are shared — everyone at the table sees the floating roll result. This is best-effort: resolve `false` when there is no selection or the VTT doesn't support scene writes, and `createRollBridge` falls back to a `notify` instead of throwing.

```ts
async labelOverSelection(text: string, ttlMs = 1500): Promise<boolean> {
    const selected = await MyVTT.scene.getSelection();
    if (selected.length !== 1) return false;
    try {
        await MyVTT.scene.addLabel(selected[0].id, { text, ttlMs });
        return true;
    } catch {
        return false;
    }
}
```

If your VTT doesn't have a scene label API, simply `return false` — the bridge remains fully functional via toasts.

**`dispose()`**

Tear down any subscriptions registered outside of `onEvent`. Subscriptions returned from `onEvent` are the caller's responsibility.

---

## Step 4: Wire it together

```ts
const disposeRollBridge = createRollBridge(source, new MyVTTAdapter(), {
    messages: {
        connected: 'Sheet connected',
        labelHint: 'Select a token to show your roll result above it',
    },
});
```

**What `createRollBridge` does internally:**

1. Calls `adapter.ready()` asynchronously. When it resolves `true`:
   - Shows `messages.connected` as a `'success'` toast.
   - Subscribes to `adapter.onEvent` to display rolls broadcast by other clients.

2. Subscribes to `source.onRoll`. On each roll from the sheet:
   - `adapter.notify(formatRollMessage(roll), rollVariant(roll))` — local toast for the roller (broadcast is remote-only; without this the roller would see nothing).
   - `adapter.broadcast({ type: 'dnd:roll', payload: roll })` — sends to all other clients.
   - `adapter.labelOverSelection(roll.total)` — attempts a token label. If it resolves `false`, shows `messages.labelHint` as a `'warning'` toast.

3. Returns a dispose fn. Call it on extension cleanup:

```ts
disposeRollBridge();
source.dispose();
```

`createRollBridge` is **one opinionated policy** — toast + broadcast + best-effort label. If your VTT needs a different flow (no label, custom broadcast format, additional side-effects), skip it and wire `source.onRoll` directly against your adapter methods.

---

## Full example: the D&D/OBR bridge

`bridges/dnd/src/main.ts` is the complete deployed bridge, annotated:

```ts
import * as obrSdk from '@owlbear-rodeo/sdk';
import { syncObrref, OwlbearAdapter, preloadObrSdk } from '@longstoryshort/vtt-sdk/owlbear';
import { createBridgeSheetSource, createRollBridge, SHEET_IFRAME_SANDBOX } from '@longstoryshort/vtt-sdk';

// OBR loads extensions inside an iframe whose parent window already holds the
// OBR SDK singleton. `syncObrref` reads a cookie OBR injects (`obrref`) and
// re-attaches it as a global so the SDK's internal postMessage peer is correct.
syncObrref();

// Cache the statically-imported OBR SDK module so `loadObrSdk()` (called by
// OwlbearAdapter internally) can reuse it instead of a late dynamic import.
// OBR fires a one-shot OBR_READY event; a dynamic import that arrives after
// the event would never see it, leaving the adapter in a permanent pending state.
// Calling this before OBR fires is the fix.
preloadObrSdk(obrSdk);

// Embed the sheet.
const SHEET_URL = 'https://longstoryshort.app/iframe/characters/list/';
const iframe = document.createElement('iframe');
iframe.src = SHEET_URL;
iframe.title = 'LSS Character Sheet';
iframe.setAttribute('sandbox', SHEET_IFRAME_SANDBOX);
iframe.setAttribute('allow', 'clipboard-write');
iframe.style.cssText = 'border:none;width:100%;height:100vh;display:block';
document.body.appendChild(iframe);

// Wire the bridge. OwlbearAdapter ships in the SDK — no need to write one.
const source = createBridgeSheetSource({
    iframe,
    allowedOrigins: ['https://longstoryshort.app'],
});
createRollBridge(source, new OwlbearAdapter());
```

For any other VTT, steps 1–2 (`syncObrref` / `preloadObrSdk`) are replaced by your VTT's own init pattern, and `OwlbearAdapter` is replaced by your `VTTAdapter` implementation.

---

## Going beyond rolls

`createRollBridge` handles `dnd:roll` only. To react to experimental outbound events or send inbound commands, use `BridgeSheetSource` directly:

```ts
// React to every event from the sheet
const unsub = source.onEvent((event) => {
    if (event.type === 'dnd:manifest') {
        // Capability manifest sent once at handshake — what the sheet can do
        console.log('Capabilities:', event.payload.capabilities);
    }
    if (event.type === 'dnd:health') {
        // HP updated after an adjust/set command
        updateTokenHP(event.payload.characterId, event.payload.current);
    }
});

// Send a command inbound to the sheet
source.send({
    type: 'dnd:command',
    payload: { op: 'adjust', capabilityId: 'hp', delta: -5 },
});
```

> `dnd:manifest`, `dnd:health`, and `dnd:command` are marked `🧪 reserved` — the protocol is wired end-to-end but the bridge-side API is experimental and may change. See the [protocol table in the README](../README.md#protocol-events).

---

## Static deployment

A bridge is a static page — any static host works.

**`vite.config.ts`** (minimal):
```ts
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/my-vtt/',  // must match your deployment path
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
});
```

```sh
vite build   # output → dist/
```

Deploy `dist/` to GitHub Pages, Cloudflare Pages, Netlify, or any CDN.

For VTTs that use an extension manifest (like OBR's `manifest.json`), point the action/panel URL at your deployed `index.html`. See [`bridges/dnd/public/manifest.json`](../bridges/dnd/public/manifest.json) for the OBR shape.
