type OwlbearSdk = typeof import('@owlbear-rodeo/sdk');

const DEV = process.env['NODE_ENV'] !== 'production';

/**
 * The window shape expected by the SDK preload contract.
 * Set `__lssObrSdk` at the app entry (before any navigation) so
 * `loadObrSdk` can reuse the already-imported module and avoid missing
 * the one-shot OBR_READY handshake.
 */
export interface ObrPreloadWindow {
    __lssObrSdk?: OwlbearSdk;
}

/**
 * Call this at the bridge entry module — before any client-side navigation —
 * to stash the already-imported OBR SDK so `loadObrSdk` can find it.
 */
export function preloadObrSdk(sdk: OwlbearSdk): void {
    (window as unknown as ObrPreloadWindow).__lssObrSdk = sdk;
}

/**
 * Retrieves the OBR SDK for use inside an OBR extension frame.
 *
 * Prefers the copy stashed by `preloadObrSdk` (imported early enough to catch
 * the one-shot OBR_READY handshake). Falls back to a dynamic import if the
 * stash is absent, with a warning — the dynamic path may miss OBR_READY.
 *
 * Returns `null` when not running in a browser or when the import fails.
 */
export async function loadObrSdk(): Promise<OwlbearSdk | null> {
    if (typeof window === 'undefined') {
        return null;
    }
    const host = window as unknown as ObrPreloadWindow;
    for (let i = 0; i < 10 && !host.__lssObrSdk; i += 1) {
        await new Promise<void>((resolve) => { window.setTimeout(resolve, 50); });
    }
    if (host.__lssObrSdk) {
        return host.__lssObrSdk;
    }
    if (DEV) {
        console.warn('[LSS/OBR] no preloaded SDK — importing now (may miss OBR_READY)');
    }
    try {
        return await import('@owlbear-rodeo/sdk');
    } catch (error) {
        console.error('[LSS/OBR] SDK import failed:', error);
        return null;
    }
}
