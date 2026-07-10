/**
 * Deploy channel. 'prod' is the live extension; any other value (e.g. 'staging')
 * is an isolated parallel extension served under /vortex/obr-<channel>/ with its
 * own OBR metadata/popover/broadcast keys, so it never collides with prod in the
 * same room. Set at build time via VITE_BRIDGE_CHANNEL.
 */
const CHANNEL = import.meta.env.VITE_BRIDGE_CHANNEL ?? 'prod';
const channelSuffix = CHANNEL === 'prod' ? '' : `.${CHANNEL}`;

/** Base URL of the deployed Vortex app whose pages we embed. */
export const VORTEX_ORIGIN =
    import.meta.env.VITE_VORTEX_ORIGIN ??
    (process.env.NODE_ENV === 'development'
        ? 'http://localhost:4004'
        : 'https://vortex.longstoryshort.app');

/** Shared OBR room metadata key holding the bound Vortex room id (per channel). */
export const ROOM_METADATA_KEY = `rodeo.lss/vortex-room${channelSuffix}`;

/** Popover id for the corner logger frame opened via OBR.popover (per channel). */
export const LOGGER_POPOVER_ID = `rodeo.lss/vortex-logger${channelSuffix}`;

/** Height of the collapsed pill bar (px). */
export const PILL_HEIGHT = 44;

/**
 * Pins an OBR popover just above the bottom-right toolbar.
 *
 * `#grid-button` is the OBR grid toggle — a stable element always present in
 * the bottom-right corner of the OBR UI. Anchoring to its TOP-RIGHT corner
 * with the popover's BOTTOM-RIGHT corner makes the logger grow upward from
 * the toolbar, flush with the right edge.
 */
export function loggerPopoverAnchor() {
    return {
        anchorReference: 'ELEMENT' as const,
        anchorElementId: 'grid-button',
        anchorOrigin: { horizontal: 'RIGHT' as const, vertical: 'TOP' as const },
        transformOrigin: { horizontal: 'RIGHT' as const, vertical: 'BOTTOM' as const },
    };
}

/** BroadcastChannel name shared between the action frame and the logger popover (per channel). */
export const BRIDGE_CHANNEL = `lss-vortex-bridge${channelSuffix}`;

/** Messages sent over {@link BRIDGE_CHANNEL} from logger to action frame. */
export type BridgeMessage = { type: 'logger:resize'; height: number };

/** Minimal data needed to render a one-card preview of the latest roll. */
export interface RollSummary {
    author: string;
    color?: string;
    title: string;
    subtitle?: string;
    total?: string;
    isCritSuccess?: boolean;
    isCritFailure?: boolean;
}

/**
 * Optional color scheme to force in all embedded Vortex pages.
 * Set to 'dark' or 'light' to override Vortex's auto-detection.
 * Leave undefined to let Vortex use the system/user preference.
 */
export const VORTEX_COLOR_SCHEME: 'dark' | 'light' | undefined = 'dark';

/** Builds a full Vortex URL with the shared color scheme query param. */
export function buildVortexUrl(path: string): string {
    const url = new URL(path, VORTEX_ORIGIN);
    if (VORTEX_COLOR_SCHEME) url.searchParams.set('colorScheme', VORTEX_COLOR_SCHEME);
    // Cache-bust the embedded Vortex document: its HTML ships without Cache-Control,
    // so browsers heuristically cache it and keep stale builds (e.g. an old OAuth
    // `state=__iframe__`). A per-release param forces a fresh HTML fetch; hashed
    // /_next/static assets stay immutably cached. Stable within a release, so the
    // src-equality guard in renderContent() still suppresses redundant reloads.
    url.searchParams.set('b', __BRIDGE_BUILD__);
    return url.href;
}

/** Inbound messages emitted by the embedded Vortex app (agnostic, prefixed). */
export type VortexHostMessage =
    | { type: 'vortex:roomSelected'; roomId: string }
    | { type: 'vortex:newRoll'; summary?: RollSummary }
    | { type: 'vortex:roomNotFound' }
    | { type: 'vortex:windowResize'; height: number };

/** Type guard for messages coming from the embedded Vortex iframe. */
export function isVortexMessage(data: unknown): data is VortexHostMessage {
    if (!data || typeof data !== 'object') {
        return false;
    }

    const type = (data as { type?: unknown }).type;

    return (
        type === 'vortex:roomSelected' ||
        type === 'vortex:newRoll' ||
        type === 'vortex:roomNotFound' ||
        type === 'vortex:windowResize'
    );
}
