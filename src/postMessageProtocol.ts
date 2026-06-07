import type { SheetEvent } from './types';

/** Marker key + version that tag our envelopes so foreign postMessage traffic is ignored. */
export const MARKER = '__lssSheetSdk';
export const VERSION = 1;

export interface SheetEnvelope {
    __lssSheetSdk: number;
    event: SheetEvent;
}

export function wrapEnvelope(event: SheetEvent): SheetEnvelope {
    return { __lssSheetSdk: VERSION, event };
}

/** Returns the carried event if `data` is one of our envelopes, else `null`. */
export function readEnvelope(data: unknown): SheetEvent | null {
    if (typeof data === 'object' && data !== null) {
        const record = data as Record<string, unknown>;
        if (record[MARKER] === VERSION && 'event' in record) {
            return record.event as SheetEvent;
        }
    }
    return null;
}
