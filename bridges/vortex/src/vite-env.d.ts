/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Deploy channel: 'prod' (default) or e.g. 'staging'. See shared.ts. */
    readonly VITE_BRIDGE_CHANNEL?: string;
    /** Override the embedded Vortex origin (defaults to prod / localhost in dev). */
    readonly VITE_VORTEX_ORIGIN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

/** Injected by Vite define (see vite.config.ts) — bridge build id. */
declare const __BRIDGE_BUILD__: string;
