/**
 * LSS Sheet SDK — public types.
 *
 * This file must not import from any project outside this SDK directory —
 * only from other SDK files and external dependencies.
 */

/** A single dice roll made on a character sheet, normalized for any VTT. */
export interface DiceRollPayload {
    characterId: string;
    characterName: string;
    /** Human label, e.g. "Атака Длинный меч" or "Спасбросок Ловкость". */
    title: string;
    /** Dice notation as shown, e.g. "(1к20) + 5". */
    formula: string;
    /** Rolled breakdown, e.g. "(15) + 5". */
    breakdown: string;
    /** Final total as a string — supports advantage pairs like "18 | 7". */
    total: string;
    isCrit: boolean;
    critKind?: 'success' | 'failure';
    timestamp: number;
}

// --- Capability model ---

export type CapabilityOpName =
    | 'adjust'
    | 'set'
    | 'toggle'
    | 'add-tag'
    | 'remove-tag'
    | 'request-roll';

/**
 * @experimental
 * adjust: apply a signed delta to a numeric capability.
 * Sign convention: negative delta = subtract (damage), positive delta = add (heal/gain).
 * The sheet applies its own rules (temp HP absorption, resistances, clamping).
 */
export interface CapabilityOpAdjust {
    op: 'adjust';
    capabilityId: string;
    delta: number;
}

/** @experimental set: overwrite a capability value outright. */
export interface CapabilityOpSet {
    op: 'set';
    capabilityId: string;
    value: number | boolean | string;
}

/** @experimental toggle: flip a boolean capability. */
export interface CapabilityOpToggle {
    op: 'toggle';
    capabilityId: string;
}

/**
 * @experimental
 * add-tag: append a label to a tag-track capability (e.g. a condition).
 * Idempotent — if the value is already present, the sheet must ignore the command.
 */
export interface CapabilityOpAddTag {
    op: 'add-tag';
    capabilityId: string;
    value: string;
}

/**
 * @experimental
 * remove-tag: remove a label from a tag-track capability.
 * Removes the first occurrence. Assumes a well-behaved set (no duplicates in DnD5e conditions).
 */
export interface CapabilityOpRemoveTag {
    op: 'remove-tag';
    capabilityId: string;
    value: string;
}

/** @experimental request-roll: ask the sheet to roll a d20 check against an optional DC. */
export interface CapabilityOpRequestRoll {
    op: 'request-roll';
    capabilityId: string;
    rollType: string;
    dc?: number;
}

export type CapabilityOperation =
    | CapabilityOpAdjust
    | CapabilityOpSet
    | CapabilityOpToggle
    | CapabilityOpAddTag
    | CapabilityOpRemoveTag
    | CapabilityOpRequestRoll;

/** @experimental One capability entry in the sheet manifest. */
export interface CapabilityDescriptor {
    id: string;
    operations: CapabilityOpName[];
}

/**
 * @experimental
 * Capability manifest — the sheet's public declaration of what the host may do.
 * Sent outbound by the sheet at handshake time; the host reads it to know which
 * dnd:command operations are valid for this member.
 */
export interface CapabilityManifest {
    version: '1';
    /** Short identifier for the sheet system, e.g. 'dnd5e' or 'anima'. */
    sheetSystem: string;
    capabilities: CapabilityDescriptor[];
}

/** @experimental Outbound fact: HP values after the sheet has applied an adjust/set command. */
export interface HealthChangedPayload {
    characterId: string;
    current: number;
    max: number;
    temp: number;
}

/**
 * Everything that crosses the sheet↔VTT boundary.
 *
 * | Type | Status | Direction |
 * |------|--------|-----------|
 * | `dnd:roll`     | stable       | sheet → host |
 * | `dnd:manifest` | experimental | sheet → host |
 * | `dnd:health`   | experimental | sheet → host |
 * | `dnd:command`  | experimental | host → sheet |
 */
export type SheetEvent =
    | { type: 'dnd:roll'; payload: DiceRollPayload }
    /** @experimental */
    | { type: 'dnd:manifest'; payload: CapabilityManifest }
    /** @experimental */
    | { type: 'dnd:health'; payload: HealthChangedPayload }
    /** @experimental */
    | { type: 'dnd:command'; payload: CapabilityOperation };

/**
 * Implemented by the host (the character-sheet app) so the bridge stays
 * agnostic of any specific app. The host normalizes its own roll representation
 * into a {@link DiceRollPayload} and pushes it through `onRoll`.
 */
export interface SheetSource {
    /** Subscribe to rolls made on the sheet. Returns an unsubscribe fn. */
    onRoll(handler: (roll: DiceRollPayload) => void): () => void;
}

// --- postMessage transport (sheet ↔ bridge across the trust boundary) ---

/** Minimal "listen for messages" surface — the real `window` satisfies it. */
export interface MessageHost {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Minimal "post a message" surface — a real `Window` (e.g. `window.parent`) satisfies it. */
export interface MessageTarget {
    postMessage(message: unknown, targetOrigin: string): void;
}

export interface SheetClientOptions {
    /** Window to post outbound events to (the embedding bridge). Default: `window.parent`. */
    target?: MessageTarget;
    /** Window to listen on for inbound events. Default: `window`. */
    host?: MessageHost;
    /** If set, inbound events are honored only from these origins. */
    allowedOrigins?: string[];
    /**
     * Origin to post outbound events to. Default `'*'`. Override with the bridge's
     * origin once known — outbound carries only non-sensitive data, never the token.
     */
    targetOrigin?: string;
}

/**
 * Sheet-side half of the postMessage transport. The sheet (its own origin,
 * embedded by a VTT bridge) emits outbound events and receives inbound ones
 * without exposing DOM/cookies/token across the frame boundary.
 */
export interface SheetClient {
    /** Send an outbound event (e.g. a dice roll or manifest) to the embedding bridge. */
    send(event: SheetEvent): void;
    /** Subscribe to inbound events/commands from the bridge. Returns an unsubscribe fn. */
    onEvent(handler: (event: SheetEvent) => void): () => void;
    /** Remove the inbound listener. */
    dispose(): void;
}
