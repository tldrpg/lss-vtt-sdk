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
 * `lss:command` operations are valid for this member.
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
 * @experimental
 * A group (docs: access-groups.md) that was just created or picked in an LSS-hosted
 * group-manager page (e.g. `iframe/group/`, `iframe/groups/`) embedded by the host's own
 * integration — not a character sheet. The host must persist `groupId`/`code` on its own
 * side and pass `code` back via that page's `?code=` param on later loads; without it,
 * every new session creates a fresh group and strands previously-connected players.
 */
export interface GroupSelectedPayload {
    groupId: string;
    code: string;
    name: string;
}

/**
 * @experimental
 * Pushed into a specific player's embedded sheet to offer joining a group — the sheet
 * itself creates the actual membership (via its own logged-in session), this only
 * delivers the code the host learned from a `lss:group-selected` event elsewhere. `null`
 * clears a previously delivered code (e.g. the host lost track of its group).
 */
export interface GroupCodePayload {
    code: string | null;
}

/**
 * @experimental
 * Outbound fact: whether this embedded character is currently a member of the group
 * whose code it was sent via `lss:group-code`. Lets the host draw its own connected/
 * not-connected roster without us providing a party-list UI of our own.
 */
export interface GroupStatusPayload {
    connected: boolean;
}

/**
 * @experimental
 * The table removing a player from its group — the counterpart of `lss:group-code`, and
 * the reason it carries a code rather than being a bare "leave": the sheet honors it only
 * for a group *this* host offered, so a table can undo its own invitation and nothing
 * else. Leaving is not `{ code: null }`, which merely withdraws a standing offer and
 * never touches membership.
 *
 * Executed by the player's own session, so it only reaches a sheet that is currently
 * embedded. Removing a member who has closed the sheet stays the group owner's job.
 */
export interface GroupLeavePayload {
    code: string;
}

/**
 * Everything that crosses the sheet↔VTT boundary.
 *
 * The prefix says **whose vocabulary the payload speaks**, not which frame carries it:
 *
 * - `lss:` — the platform's own protocol, independent of any game system. A group is a
 *   group whether it holds D&D sheets, Anima sheets or monsters; a roll is a formula, a
 *   breakdown and a total in every system we have. These names are shared by every sheet
 *   product we ship.
 * - `dnd:` — vocabulary that only makes sense for the D&D 5e sheet, because the payload
 *   describes that system's own concepts. Another sheet product would need a different
 *   payload here, not the same one under a different prefix.
 *
 * | Type | Status | Direction |
 * |------|--------|-----------|
 * | `lss:roll`          | stable       | sheet → host |
 * | `lss:manifest`      | experimental | sheet → host |
 * | `lss:command`       | experimental | host → sheet |
 * | `dnd:health`        | experimental | sheet → host |
 * | `lss:group-selected`| experimental | group-manager page → host |
 * | `lss:group-code`    | experimental | host → sheet |
 * | `lss:group-leave`   | experimental | host → sheet |
 * | `lss:group-status`  | experimental | sheet → host |
 */
export type SheetEvent =
    | { type: 'lss:roll'; payload: DiceRollPayload }
    /** @experimental */
    | { type: 'lss:manifest'; payload: CapabilityManifest }
    /** @experimental */
    | { type: 'lss:command'; payload: CapabilityOperation }
    /**
     * @experimental
     * D&D-specific: the payload is 5e's own health model (temp HP on top of a
     * current/max pool). The system-agnostic path to the same numbers is the
     * capability model — `lss:manifest` declares them, `lss:command` operates them.
     */
    | { type: 'dnd:health'; payload: HealthChangedPayload }
    /** @experimental */
    | { type: 'lss:group-selected'; payload: GroupSelectedPayload }
    /** @experimental */
    | { type: 'lss:group-code'; payload: GroupCodePayload }
    /** @experimental */
    | { type: 'lss:group-leave'; payload: GroupLeavePayload }
    /** @experimental */
    | { type: 'lss:group-status'; payload: GroupStatusPayload };

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
