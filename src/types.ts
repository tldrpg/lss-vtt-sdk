/**
 * LSS Sheet SDK — public types.
 *
 * This file must not import from any project outside this SDK directory —
 * only from other SDK files and external dependencies.
 */

export type VTTUserRole = 'gm' | 'player';

export interface VTTUser {
    id: string;
    name: string;
    role: VTTUserRole;
}

export type NotifyVariant = 'info' | 'success' | 'warning' | 'error';

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
 * adjust: apply a signed delta to a numeric capability.
 * Sign convention: negative delta = subtract (damage), positive delta = add (heal/gain).
 * The sheet applies its own rules (temp HP absorption, resistances, clamping).
 */
export interface CapabilityOpAdjust {
    op: 'adjust';
    capabilityId: string;
    delta: number;
}

/** set: overwrite a capability value outright. */
export interface CapabilityOpSet {
    op: 'set';
    capabilityId: string;
    value: number | boolean | string;
}

/** toggle: flip a boolean capability. */
export interface CapabilityOpToggle {
    op: 'toggle';
    capabilityId: string;
}

/**
 * add-tag: append a label to a tag-track capability (e.g. a condition).
 * Idempotent — if the value is already present, the sheet must ignore the command.
 */
export interface CapabilityOpAddTag {
    op: 'add-tag';
    capabilityId: string;
    value: string;
}

/**
 * remove-tag: remove a label from a tag-track capability.
 * Removes the first occurrence. Assumes a well-behaved set (no duplicates in DnD5e conditions).
 */
export interface CapabilityOpRemoveTag {
    op: 'remove-tag';
    capabilityId: string;
    value: string;
}

/** request-roll: ask the sheet to roll a d20 check against an optional DC. */
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

/** One capability entry in the sheet manifest. */
export interface CapabilityDescriptor {
    id: string;
    operations: CapabilityOpName[];
}

/**
 * Capability manifest — the sheet's public declaration of what the host may do.
 * Sent outbound by the sheet at handshake time; the host reads it to know which
 * CAPABILITY_COMMAND operations are valid for this member.
 */
export interface CapabilityManifest {
    version: '1';
    /** Short identifier for the sheet system, e.g. 'dnd5e' or 'anima'. */
    sheetSystem: string;
    capabilities: CapabilityDescriptor[];
}

/** Outbound fact: HP values after the sheet has applied an adjust/set command. */
export interface HealthChangedPayload {
    characterId: string;
    current: number;
    max: number;
    temp: number;
}

/**
 * Everything that crosses the sheet↔VTT boundary.
 *
 * Outbound (sheet → host):  DICE_ROLL · MANIFEST · HEALTH_CHANGED
 * Inbound  (host → sheet):  CAPABILITY_COMMAND
 */
export type SheetEvent =
    | { type: 'DICE_ROLL'; payload: DiceRollPayload }
    | { type: 'MANIFEST'; payload: CapabilityManifest }
    | { type: 'HEALTH_CHANGED'; payload: HealthChangedPayload }
    | { type: 'CAPABILITY_COMMAND'; payload: CapabilityOperation };

/**
 * Implemented by the host (the character-sheet app) so the bridge stays
 * agnostic of any specific app. The host normalizes its own roll representation
 * into a {@link DiceRollPayload} and pushes it through `onRoll`.
 */
export interface SheetSource {
    /** Subscribe to rolls made on the sheet. Returns an unsubscribe fn. */
    onRoll(handler: (roll: DiceRollPayload) => void): () => void;
}

/** Human-facing strings surfaced by the bridge — override to localize. */
export interface SheetBridgeMessages {
    /** Toast shown once the sheet connects to the table. */
    connected: string;
    /** Toast shown to the roller when a token label could not be placed. */
    labelHint: string;
}

export interface SheetBridgeOptions {
    messages?: Partial<SheetBridgeMessages>;
}

/**
 * The seam every VTT implements. The sheet talks only to this interface; each
 * table (Owlbear, Foundry, …) ships a thin adapter that maps its own SDK onto
 * these methods.
 */
export interface VTTAdapter {
    /** True only when the page actually runs inside this VTT. */
    readonly isAvailable: boolean;
    /**
     * Loads and handshakes with the VTT SDK. Resolves `true` once ready, or
     * `false` if the page is not running inside this VTT. Safe to call multiple
     * times — the work happens once.
     */
    ready(): Promise<boolean>;
    getSessionId(): string | undefined;
    getCurrentUser(): VTTUser | undefined;
    /** Send an event to every other client in the room (sender excluded). */
    broadcast(event: SheetEvent): void;
    /** Subscribe to events broadcast by other clients. Returns an unsubscribe fn. */
    onEvent(handler: (event: SheetEvent) => void): () => void;
    /** Local toast on this client. */
    notify(message: string, variant?: NotifyVariant): void;
    /**
     * Float a transient text label over the player's currently selected token.
     * Scene items are shared, so the label is visible to everyone at the table.
     * Resolves `true` if a label was placed, `false` when there isn't exactly
     * one token selected or the scene write was rejected (e.g. no permission).
     */
    labelOverSelection(text: string, ttlMs?: number): Promise<boolean>;
    /** Tear down listeners / SDK handlers. */
    dispose(): void;
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
