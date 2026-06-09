/** Base URL of the deployed Vortex app whose pages we embed. */
export const VORTEX_ORIGIN =
    process.env.NODE_ENV === 'development'
        ? 'http://localhost:4004'
        : 'https://vortex.longstoryshort.app';

/** Shared OBR room metadata key holding the bound Vortex room id. */
export const ROOM_METADATA_KEY = 'rodeo.lss/vortex-room';

/** Popover id for the corner logger frame opened via OBR.popover. */
export const LOGGER_POPOVER_ID = 'rodeo.lss/vortex-logger';

/** Height of the collapsed pill bar (px). */
export const PILL_HEIGHT = 44;

/** BroadcastChannel name shared between the action frame and the logger popover. */
export const BRIDGE_CHANNEL = 'lss-vortex-bridge';

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

/** Iframe sandbox/permission attributes shared by both frames. */
export const IFRAME_SANDBOX =
    'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals';

/** Inbound messages emitted by the embedded Vortex app (agnostic, prefixed). */
export type VortexHostMessage =
    | { type: 'vortex:roomSelected'; roomId: string }
    | { type: 'vortex:newRoll'; summary?: RollSummary }
    | { type: 'vortex:roomNotFound' };

/** Type guard for messages coming from the embedded Vortex iframe. */
export function isVortexMessage(data: unknown): data is VortexHostMessage {
    if (!data || typeof data !== 'object') {
        return false;
    }

    const type = (data as { type?: unknown }).type;

    return (
        type === 'vortex:roomSelected' ||
        type === 'vortex:newRoll' ||
        type === 'vortex:roomNotFound'
    );
}
