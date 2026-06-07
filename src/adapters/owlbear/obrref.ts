const PARAM = 'obrref';
const STORAGE_KEY = 'lss-obrref';

const DEV = process.env['NODE_ENV'] !== 'production';

/**
 * Keep the Owlbear handshake (`obrref`) reachable by the SDK across client-side
 * navigation.
 *
 * The OBR SDK reads `obrref` from the URL once, at module-import time, and
 * freezes `isAvailable` from it. But in-app links drop the param, and the host
 * app may load a fresh SDK copy on the next page. So: when we see the param
 * (entry page) we stash it; when it's missing (after navigation) we put it back
 * via `replaceState` before the SDK loads.
 */
export function syncObrref(): void {
    if (typeof window === 'undefined') {
        return;
    }

    let url: URL;
    try {
        url = new URL(window.location.href);
    } catch {
        return;
    }

    const current = url.searchParams.get(PARAM);
    if (current) {
        try {
            window.sessionStorage.setItem(STORAGE_KEY, current);
            if (DEV) {
                console.info('[LSS/OBR] obrref captured from URL');
            }
        } catch {
            // storage blocked — non-fatal, the live param is still in the URL
        }
        return;
    }

    let stashed: string | null = null;
    try {
        stashed = window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
        // storage blocked — nothing to restore
    }
    if (stashed) {
        url.searchParams.set(PARAM, stashed);
        window.history.replaceState(window.history.state, '', url.toString());
        if (DEV) {
            console.info('[LSS/OBR] obrref restored from stash');
        }
    } else if (DEV) {
        console.warn('[LSS/OBR] obrref missing and no stash to restore');
    }
}
