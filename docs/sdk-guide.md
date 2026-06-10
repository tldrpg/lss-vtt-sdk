# LSS Sheet SDK — guide

How to embed a longstoryshort.app character sheet in your virtual tabletop and receive dice rolls.

This guide covers the SDK itself — the transport layer and protocol types. It applies to all VTT architectures: web apps, desktop apps, and browser extensions alike. If your VTT uses an extension model that loads pages by URL, also see [bridge-guide.md](./bridge-guide.md) for the static bridge page pattern.

---

## How it works

The sheet and your VTT run at **different origins**. They communicate only via `window.postMessage` — your code never reads the sheet's DOM, cookies, or auth token.

```
Your page (your origin)
  └── LSS sheet iframe (longstoryshort.app)
        └── postMessage ──→ your page
```

The SDK handles the envelope format, version negotiation, and origin filtering. You get typed events.

---

## Installation

```sh
npm install @longstoryshort/vtt-sdk
```

---

## Embedding the sheet

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

### Sandbox tokens

| Token | Why it is required |
|-------|--------------------|
| `allow-same-origin` | The sheet reads its **own** origin's auth cookie and `localStorage`. Without it the sheet gets an opaque origin and login breaks. |
| `allow-scripts` | The sheet is a JS app. |
| `allow-popups` | OAuth redirect windows. |
| `allow-popups-to-escape-sandbox` | Auth pop-ups must open in a normal browser context, not inherit the sandbox. |
| `allow-forms` | Form submissions inside the sheet. |
| `allow-modals` | Native dialog boxes. |

`clipboard-write` is a Permissions Policy token, set via `allow=`, not `sandbox=`.

### A note on `allow-same-origin`

This token looks alarming at first glance. The concern only applies when the iframe and the outer page are on the **same origin** — in that case `allow-same-origin` would let the iframe escape the sandbox and access the parent's cookies. That is not the case here: the sheet is at `longstoryshort.app`, your page is at your own origin. The browser enforces the boundary regardless of the sandbox, so `allow-same-origin` only grants the sheet access to its own auth data, which is exactly what it needs.

---

## Receiving events

```ts
import { createBridgeSheetSource } from '@longstoryshort/vtt-sdk';

const source = createBridgeSheetSource({
    iframe,
    // Only honor messages from the LSS sheet origin.
    allowedOrigins: ['https://longstoryshort.app'],
});
```

`createBridgeSheetSource` attaches a `message` listener on `window` and filters for envelopes that originate from an allowed origin, carry the current protocol version, and come from the specific `iframe.contentWindow`. Everything else is silently ignored.

### Dice rolls

```ts
import { formatRollMessage, rollVariant } from '@longstoryshort/vtt-sdk';

source.onRoll((roll) => {
    const message = formatRollMessage(roll); // "🎲 Alice: Longsword Attack — 18 💥"
    const severity = rollVariant(roll);      // 'info' | 'success' | 'warning'

    // Wire to your VTT however makes sense — notification, chat, broadcast, etc.
    myVTT.notification.show(message, severity);
});
```

### All events

```ts
source.onEvent((event) => {
    if (event.type === 'dnd:roll') {
        // event.payload: DiceRollPayload
    }
    if (event.type === 'dnd:manifest') {
        // event.payload: CapabilityManifest  (@experimental)
    }
    if (event.type === 'dnd:health') {
        // event.payload: HealthChangedPayload  (@experimental)
    }
});
```

`onRoll` is a convenience shortcut for the common case. `onEvent` covers everything, including experimental events.

### Cleanup

```ts
source.dispose(); // removes the message listener
```

---

## Sending commands to the sheet

```ts
// Send an inbound command (@experimental)
source.send({
    type: 'dnd:command',
    payload: { op: 'adjust', capabilityId: 'hp', delta: -5 },
});
```

---

## Protocol reference

| Event type | Status | Direction | Payload type |
|------------|--------|-----------|--------------|
| `dnd:roll` | ✅ stable | sheet → host | `DiceRollPayload` |
| `dnd:manifest` | 🧪 reserved | sheet → host | `CapabilityManifest` |
| `dnd:health` | 🧪 reserved | sheet → host | `HealthChangedPayload` |
| `dnd:command` | 🧪 reserved | host → sheet | `CapabilityOperation` |

Reserved events are typed and wired end-to-end in the sheet, but the bridge-side API is considered experimental and may change before stabilisation.

---

## Utilities

### `formatRollMessage(roll: DiceRollPayload): string`

Human-readable roll string for notifications or chat:

| Roll result | Output |
|-------------|--------|
| Normal | `🎲 Alice: Longsword Attack — 18` |
| Crit success | `🎲 Alice: Longsword Attack — 20 💥` |
| Crit failure | `🎲 Alice: Longsword Attack — 1 💀` |

### `rollVariant(roll: DiceRollPayload): NotifyVariant`

Maps crit state to a notification severity so you can colour-code toasts:

| Condition | Returns |
|-----------|---------|
| Crit success | `'success'` |
| Crit failure | `'warning'` |
| Normal roll | `'info'` |

`NotifyVariant` is `'info' | 'success' | 'warning' | 'error'`.

---

## Sheet side

If you are building the **sheet app itself** (not the embedding VTT), use `createSheetClient` to emit events and receive inbound commands:

```ts
import { createSheetClient } from '@longstoryshort/vtt-sdk';

const client = createSheetClient();

// Emit a dice roll to the embedding page
client.send({ type: 'dnd:roll', payload: { ... } });

// Receive inbound commands from the bridge
const unsub = client.onEvent((event) => {
    if (event.type === 'dnd:command') {
        // apply the operation to the character
    }
});

// Cleanup
unsub();
client.dispose();
```

`createSheetClient` defaults to posting to `window.parent` (the embedding bridge) and listening on `window`.
