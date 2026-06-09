# OBR bridge init: replace 500ms sleep with retry logic

## Problem

Both `bridges/vortex/src/main.ts` and `bridges/vortex/src/logger.ts` contain:

```ts
await new Promise((resolve) => setTimeout(resolve, 500));
await renderContent();
```

This is a workaround for `OBR.onReady()` not guaranteeing that `OBR.room.getMetadata()` is
immediately usable. Without the delay, the first metadata read can fail or return stale data.
The hardcoded 500ms adds latency on every panel open and will silently break on slow connections
where 500ms isn't enough.

## Proposed fix

Replace the sleep with a retry-with-backoff wrapper around the first `renderContent()` call:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 150): Promise<T> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === attempts - 1) throw err;
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw new Error('unreachable');
}

// boot
await withRetry(renderContent);
```

`renderContent` already has a try/catch that swallows errors — change it to re-throw so the
retry wrapper can catch them, then restore the swallow only in the `onMetadataChange` subscriber
(where a failed re-render is non-fatal).

## Scope

- `bridges/vortex/src/main.ts` — boot call + `renderContent` error handling
- `bridges/vortex/src/logger.ts` — boot call + `renderContent` error handling

No changes to OBR SDK usage or the BroadcastChannel architecture.
