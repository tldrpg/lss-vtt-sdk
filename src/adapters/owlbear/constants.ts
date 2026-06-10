/** Room-wide pub/sub channel for sheet events. Namespaced to avoid collisions. */
export const BROADCAST_CHANNEL = 'rodeo.lss/sheet-events';

/** OBR room metadata key — false when Vortex is connected (logger active), true otherwise. */
export const NOTIFY_ROLLS_KEY = 'rodeo.lss/notify-rolls';
