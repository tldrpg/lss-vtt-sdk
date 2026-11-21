import { MARKER, VERSION } from './postMessageProtocol';

export const CHARACTER_API_VERSION = 1;

const actions = ['health.damage', 'health.heal', 'spell.spend-charge'] as const;
const rollActions = [
    'weapon.roll-attack', 'weapon.roll-damage', 'saving-throw.roll',
    'ability-check.roll', 'skill-check.roll', 'initiative.roll',
] as const;
const rollIntents = ['normal', 'advantage', 'disadvantage'] as const;
const saveAbilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const criticalOutcomes = ['success', 'failure'] as const;
const rejectionCodes = [
    'not_ready', 'forbidden', 'stale_session', 'revision_conflict', 'unsupported_action',
    'invalid_parameters', 'request_id_reused', 'session_limit', 'unavailable', 'insufficient_resource',
] as const;
const saveFailureCodes = ['forbidden', 'conflict', 'storage'] as const;
const unknownCodes = ['timeout', 'disconnected', 'save_unconfirmed', 'roll_unconfirmed'] as const;

export type CharacterAction = typeof actions[number];
export type CharacterRollAction = typeof rollActions[number];
export type CharacterRollIntent = typeof rollIntents[number];
export type CharacterSaveAbility = typeof saveAbilities[number];
export type CharacterRollActionPayload =
    | { type: 'weapon.roll-attack'; weaponId: string; intent?: CharacterRollIntent }
    | { type: 'weapon.roll-damage'; weaponId: string; critical?: boolean }
    | { type: 'saving-throw.roll'; ability: CharacterSaveAbility; intent?: CharacterRollIntent }
    | { type: 'ability-check.roll'; ability: CharacterSaveAbility; intent?: CharacterRollIntent }
    | { type: 'skill-check.roll'; skillId: string; intent?: CharacterRollIntent }
    | { type: 'initiative.roll'; intent?: CharacterRollIntent };
export type CharacterActionPayload =
    | { type: 'health.damage' | 'health.heal'; amount: number }
    | { type: 'spell.spend-charge'; spellId: string }
    | { type: 'resource.adjust'; resourceId: string; delta: number }
    | CharacterRollActionPayload;
export type CharacterAddress = { characterId: string; executionId: string };

export type CharacterAttack = Readonly<{
    id: string;
    name: string;
    attackBonus: number;
    damage: string | null;
    damageType: string;
}>;
export type CharacterSpell = Readonly<{
    id: string;
    name: string;
    catalogId?: string;
    level: number;
    attackBonus?: number;
    saveDc?: number;
    charge?: Readonly<{ current: number; max: number }>;
}>;
export type CharacterSkill = Readonly<{
    id: string;
    name: string;
}>;
export type CharacterResource = Readonly<{
    id: string;
    name: string;
    current: number;
    /** Null means the sheet has no finite maximum for this counter. */
    max: number | null;
    canAdjust: boolean;
}>;
export type CharacterCatalog = Readonly<{
    attacks: readonly CharacterAttack[];
    /** Null while spells are loading or unavailable. */
    spells: readonly CharacterSpell[] | null;
    skills?: readonly CharacterSkill[];
}>;

export type CharacterSnapshot = Readonly<CharacterAddress & {
    revision: number;
    savedThrough: number;
    hp: Readonly<{ current: number; max: number; temp: number }>;
    actions: readonly CharacterAction[];
    /** Rolls are advertised separately so v1 clients can still read the current sheet. */
    rollActions?: readonly CharacterRollAction[];
    catalog?: CharacterCatalog;
    resources?: readonly CharacterResource[];
}>;

type CharacterCommandAddress = CharacterAddress & {
    requestId: string;
    expectedRevision: number;
};

/** Addressable wire command. The executor validates the action and its parameters. */
export type CharacterWireCommand = CharacterCommandAddress & {
    action: {
        type: string;
        amount?: number;
        spellId?: string;
        weaponId?: string;
        skillId?: string;
        resourceId?: string;
        delta?: number;
        ability?: CharacterSaveAbility;
        intent?: CharacterRollIntent | null;
        critical?: boolean | null;
    };
};

export type CharacterCommand = CharacterCommandAddress & {
    action: CharacterActionPayload;
};

export type CharacterRollResult = Readonly<{
    total: number;
    formula: string;
    intent: CharacterRollIntent;
    /** The kept natural d20 when the roll has one. */
    natural?: number;
    critical?: typeof criticalOutcomes[number];
}>;

export type CharacterResult = CharacterAddress & { requestId: string } & (
    | { phase: 'applied' | 'unchanged'; revision: number }
    | { phase: 'saved'; revision: number; savedThrough: number; serverVersion: string }
    | { phase: 'save_failed'; revision: number; code: typeof saveFailureCodes[number] }
    | { phase: 'rolled'; roll: CharacterRollResult }
    | { phase: 'rejected'; code: typeof rejectionCodes[number] }
    | { phase: 'unknown'; code: typeof unknownCodes[number] }
);

type CharacterConnectionPayload = { version: typeof CHARACTER_API_VERSION; connectionId: string };
type CharacterReadyPayload = { helloId: string } & (
    | ({ status: 'ready'; snapshot: CharacterSnapshot } & CharacterConnectionPayload)
    | { status: 'waiting' | 'denied' | 'unsupported'; version?: typeof CHARACTER_API_VERSION }
);

export type CharacterMessage =
    | { type: 'lss:character-hello'; payload: { helloId: string; versions: number[] } }
    | { type: 'lss:character-ready'; payload: CharacterReadyPayload }
    | { type: 'lss:character-state'; payload: CharacterConnectionPayload & { snapshot: CharacterSnapshot } }
    | { type: 'lss:character-command'; payload: CharacterConnectionPayload & { command: CharacterWireCommand } }
    | { type: 'lss:character-result'; payload: CharacterConnectionPayload & { result: CharacterResult } }
    | { type: 'lss:character-closed'; payload: CharacterConnectionPayload };

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;

const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 128 && value.trim().length > 0;

const isRevision = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isNonNegativeNumber = (value: unknown): value is number =>
    isFiniteNumber(value) && value >= 0;

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
    return options.some(option => option === value);
}

export function isCharacterRollActionType(value: unknown): value is CharacterRollAction {
    return isOneOf(value, rollActions);
}

function readAddress(value: JsonObject): CharacterAddress | undefined {
    const { characterId, executionId } = value;
    if (isId(characterId) && isId(executionId)) {
        return { characterId, executionId };
    }
}

function readConnection(value: JsonObject): CharacterConnectionPayload | undefined {
    if (value.version === CHARACTER_API_VERSION && isId(value.connectionId)) {
        return { version: value.version, connectionId: value.connectionId };
    }
}

function readAttack(value: unknown): CharacterAttack | undefined {
    const attack = object(value);
    if (!attack) return;
    const { id, name, attackBonus, damage, damageType } = attack;
    if (isId(id) && typeof name === 'string' && isFiniteNumber(attackBonus)
        && (damage === null || typeof damage === 'string') && typeof damageType === 'string') {
        return { id, name, attackBonus, damage, damageType };
    }
}

function readSpell(value: unknown): CharacterSpell | undefined {
    const spell = object(value);
    if (!spell) return;
    const { id, name, catalogId, level, attackBonus, saveDc } = spell;
    if (!isId(id) || typeof name !== 'string' || !isRevision(level)
        || (catalogId !== undefined && !isId(catalogId))
        || (attackBonus !== undefined && !isFiniteNumber(attackBonus))
        || (saveDc !== undefined && !isFiniteNumber(saveDc))) return;
    const parsed = {
        id, name, level,
        ...(catalogId !== undefined ? { catalogId } : {}),
        ...(attackBonus !== undefined ? { attackBonus } : {}),
        ...(saveDc !== undefined ? { saveDc } : {}),
    };
    if (spell.charge === undefined) return parsed;
    const charge = object(spell.charge);
    if (charge && isNonNegativeNumber(charge.current) && isNonNegativeNumber(charge.max)) {
        return { ...parsed, charge: { current: charge.current, max: charge.max } };
    }
}

function readSkill(value: unknown): CharacterSkill | undefined {
    const skill = object(value);
    if (skill && isId(skill.id) && typeof skill.name === 'string') {
        return { id: skill.id, name: skill.name };
    }
}

function readResource(value: unknown): CharacterResource | undefined {
    const resource = object(value);
    if (!resource) return;
    const { id, name, current, max, canAdjust } = resource;
    if (isId(id) && typeof name === 'string' && isNonNegativeNumber(current)
        && (max === null || isNonNegativeNumber(max)) && typeof canAdjust === 'boolean') {
        return { id, name, current, max, canAdjust };
    }
}

function readList<T>(value: unknown, read: (item: unknown) => T | undefined, skipMalformed = false): T[] | undefined {
    if (!Array.isArray(value)) return;
    const result: T[] = [];
    for (const item of value) {
        const parsed = read(item);
        if (parsed !== undefined) result.push(parsed);
        else if (!skipMalformed) return;
    }
    return result;
}

function readCatalog(value: unknown): CharacterCatalog | undefined {
    const catalog = object(value);
    if (!catalog) return;
    const attacks = readList(catalog.attacks, readAttack);
    const spells = catalog.spells === null ? null : readList(catalog.spells, readSpell);
    if (attacks && spells !== undefined) {
        const skills = readList(catalog.skills, readSkill, true);
        return { attacks, spells, ...(skills && { skills }) };
    }
}

function readSnapshot(value: unknown): CharacterSnapshot | undefined {
    const snapshot = object(value);
    if (!snapshot) return;
    const address = readAddress(snapshot);
    const hp = object(snapshot.hp);
    const { revision, savedThrough, actions: offered } = snapshot;
    if (!address || !hp || !isRevision(revision) || !isRevision(savedThrough) || savedThrough > revision
        || !Array.isArray(offered) || offered.length > actions.length
        || !offered.every(action => isOneOf(action, actions))) return;
    const { current, max, temp } = hp;
    if (!isNonNegativeNumber(current) || !isNonNegativeNumber(max) || !isNonNegativeNumber(temp)) return;
    const catalog = readCatalog(snapshot.catalog);
    if (snapshot.catalog !== undefined && !catalog) return;
    const offeredRolls = snapshot.rollActions;
    const resources = readList(snapshot.resources, readResource, true);
    return {
        ...address, revision, savedThrough, hp: { current, max, temp }, actions: [...offered],
        ...(catalog ? { catalog } : {}),
        ...(resources && { resources }),
        ...(Array.isArray(offeredRolls) ? {
            rollActions: offeredRolls.filter(isCharacterRollActionType),
        } : {}),
    };
}

function readCommand(value: unknown): CharacterWireCommand | undefined {
    const command = object(value);
    if (!command) return;
    const address = readAddress(command);
    const { requestId, expectedRevision } = command;
    const action = object(command.action);
    if (!address || !isId(requestId) || !isRevision(expectedRevision) || !action || !isId(action.type)) return;
    return {
        ...address, requestId, expectedRevision,
        action: {
            type: action.type,
            ...(typeof action.amount === 'number' ? { amount: action.amount } : {}),
            ...(isId(action.spellId) ? { spellId: action.spellId } : {}),
            ...(isId(action.weaponId) ? { weaponId: action.weaponId } : {}),
            ...(isId(action.skillId) ? { skillId: action.skillId } : {}),
            ...(isId(action.resourceId) ? { resourceId: action.resourceId } : {}),
            ...(typeof action.delta === 'number' ? { delta: action.delta } : {}),
            ...(isOneOf(action.ability, saveAbilities) ? { ability: action.ability } : {}),
            // Keep invalid optional parameters distinguishable from omitted ones.
            ...(action.intent !== undefined ? { intent: isOneOf(action.intent, rollIntents) ? action.intent : null } : {}),
            ...(action.critical !== undefined ? { critical: typeof action.critical === 'boolean' ? action.critical : null } : {}),
        },
    };
}

export function readCharacterCommand(value: unknown): CharacterCommand | undefined {
    const command = readCommand(value);
    if (!command) return;
    const { action, ...address } = command;
    const { type, amount, spellId, weaponId, ability, intent, critical, skillId, resourceId, delta } = action;
    switch (type) {
        case 'health.damage':
        case 'health.heal':
            if (isRevision(amount) && amount > 0) return { ...address, action: { type, amount } };
            break;
        case 'spell.spend-charge':
            if (spellId !== undefined) return { ...address, action: { type, spellId } };
            break;
        case 'resource.adjust':
            if (resourceId !== undefined && delta !== undefined && Number.isSafeInteger(delta) && delta !== 0) {
                return { ...address, action: { type, resourceId, delta } };
            }
            break;
        case 'weapon.roll-attack':
            if (weaponId !== undefined && intent !== null) {
                return { ...address, action: { type, weaponId, ...(intent !== undefined ? { intent } : {}) } };
            }
            break;
        case 'weapon.roll-damage':
            if (weaponId !== undefined && critical !== null) {
                return { ...address, action: { type, weaponId, ...(critical !== undefined ? { critical } : {}) } };
            }
            break;
        case 'saving-throw.roll':
        case 'ability-check.roll':
            if (ability !== undefined && intent !== null) {
                return { ...address, action: { type, ability, ...(intent !== undefined ? { intent } : {}) } };
            }
            break;
        case 'skill-check.roll':
            if (skillId !== undefined && intent !== null) {
                return { ...address, action: { type, skillId, ...(intent !== undefined ? { intent } : {}) } };
            }
            break;
        case 'initiative.roll':
            if (intent !== null) return { ...address, action: { type, ...(intent !== undefined ? { intent } : {}) } };
            break;
    }
}

export function isCharacterCommand(value: unknown): value is CharacterCommand {
    return readCharacterCommand(value) !== undefined;
}

function readRoll(value: unknown): CharacterRollResult | undefined {
    const roll = object(value);
    if (!roll) return;
    const { total, formula, intent, natural, critical } = roll;
    if (!isFiniteNumber(total) || typeof formula !== 'string' || !formula.trim() || !isOneOf(intent, rollIntents)
        || (natural !== undefined && (!isRevision(natural) || natural < 1 || natural > 20))
        || (critical !== undefined && !isOneOf(critical, criticalOutcomes))) return;
    return {
        total, formula, intent,
        ...(natural !== undefined ? { natural } : {}),
        ...(critical !== undefined ? { critical } : {}),
    };
}

function readResult(value: unknown): CharacterResult | undefined {
    const result = object(value);
    if (!result) return;
    const address = readAddress(result);
    const { requestId, phase, code, revision, savedThrough, serverVersion } = result;
    if (!address || !isId(requestId)) return;
    const initial = { ...address, requestId };
    switch (phase) {
        case 'applied':
        case 'unchanged':
            return isRevision(revision) ? { ...initial, phase, revision } : undefined;
        case 'saved':
            return isRevision(revision) && isRevision(savedThrough) && savedThrough >= revision && isId(serverVersion)
                ? { ...initial, phase, revision, savedThrough, serverVersion } : undefined;
        case 'save_failed':
            return isRevision(revision) && isOneOf(code, saveFailureCodes)
                ? { ...initial, phase, revision, code } : undefined;
        case 'rolled': {
            const roll = readRoll(result.roll);
            return roll ? { ...initial, phase, roll } : undefined;
        }
        case 'rejected':
            return isOneOf(code, rejectionCodes) ? { ...initial, phase, code } : undefined;
        case 'unknown':
            return isOneOf(code, unknownCodes) ? { ...initial, phase, code } : undefined;
    }
}

export function packCharacterMessage(message: CharacterMessage) {
    return { [MARKER]: VERSION, event: message };
}

export function parseCharacterMessage(data: unknown): CharacterMessage | undefined {
    const envelope = object(data);
    const event = object(envelope?.event);
    const payload = object(event?.payload);
    if (envelope?.[MARKER] !== VERSION || !event || !payload) return;

    const { type } = event;
    const { helloId, versions } = payload;
    if (type === 'lss:character-hello') {
        if (isId(helloId) && Array.isArray(versions) && versions.length > 0 && versions.length <= 16
            && versions.every(version => isRevision(version) && version > 0)) {
            return { type, payload: { helloId, versions: [...versions] } };
        }
        return;
    }

    const connection = readConnection(payload);
    if (type === 'lss:character-ready') {
        if (!isId(helloId)) return;
        if (payload.status === 'ready') {
            const snapshot = readSnapshot(payload.snapshot);
            return connection && snapshot ? {
                type, payload: { ...connection, helloId, status: 'ready', snapshot },
            } : undefined;
        }
        const { status, version } = payload;
        if (isOneOf(status, ['waiting', 'denied', 'unsupported'] as const)
            && (version === undefined || version === CHARACTER_API_VERSION)) {
            return { type, payload: version === undefined ? { helloId, status } : { helloId, status, version } };
        }
        return;
    }
    if (!connection) return;

    switch (type) {
        case 'lss:character-state': {
            const snapshot = readSnapshot(payload.snapshot);
            return snapshot ? { type, payload: { ...connection, snapshot } } : undefined;
        }
        case 'lss:character-command': {
            const command = readCommand(payload.command);
            return command ? { type, payload: { ...connection, command } } : undefined;
        }
        case 'lss:character-result': {
            const result = readResult(payload.result);
            return result ? { type, payload: { ...connection, result } } : undefined;
        }
        case 'lss:character-closed':
            return { type, payload: connection };
    }
}
