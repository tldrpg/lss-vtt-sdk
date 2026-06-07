/** Room-wide pub/sub channel for sheet events. Namespaced to avoid collisions. */
export const BROADCAST_CHANNEL = 'rodeo.lss/sheet-events';

/** Marks scene items we create (transient roll labels) so we own/clean them. */
export const LABEL_METADATA_KEY = 'rodeo.lss/label';

/** How long a roll label floats over a token before it is removed. */
export const DEFAULT_LABEL_TTL_MS = 4000;
