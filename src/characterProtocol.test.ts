import { describe, expect, it } from 'vitest';
import { isCharacterCommand, packCharacterMessage, parseCharacterMessage } from './characterProtocol';
import type { CharacterMessage } from './characterProtocol';

const ready = {
    type: 'lss:character-ready',
    payload: {
        helloId: 'hello',
        status: 'ready',
        version: 1,
        connectionId: 'connection',
        snapshot: {
            characterId: 'character',
            executionId: 'execution',
            revision: 2,
            savedThrough: 1,
            hp: { current: 10, max: 20, temp: 4 },
            actions: ['health.damage', 'health.heal'],
        },
    },
} satisfies CharacterMessage;

describe('character API envelopes', () => {
    it('preserves the marker of the legacy envelope and decodes the new projection', () => {
        expect(packCharacterMessage(ready)).toEqual({ __lssSheetSdk: 2, event: ready });
        expect(parseCharacterMessage(packCharacterMessage(ready))).toEqual(ready);
        expect(parseCharacterMessage({ __lssSheetSdk: 1, event: ready })).toBeUndefined();
        expect(parseCharacterMessage({ __lssSheetSdk: 2, event: { type: 'dnd:health' } })).toBeUndefined();
    });

    it('rejects malformed ready evidence and projects only the known fields', () => {
        const { snapshot } = ready.payload;
        expect(parseCharacterMessage({
            __lssSheetSdk: 2,
            event: { ...ready, payload: { ...ready.payload, snapshot: { ...snapshot, savedThrough: 3 } } },
        })).toBeUndefined();
        expect(parseCharacterMessage({
            __lssSheetSdk: 2,
            event: { ...ready, payload: { ...ready.payload, snapshot: { ...snapshot, privateData: 'metadata' } } },
        })).toEqual(ready);
    });

    it('validates persisted evidence and leaves unsupported actions addressable for rejection', () => {
        const message: CharacterMessage = {
            type: 'lss:character-command',
            payload: {
                version: 1, connectionId: 'connection', command: {
                    characterId: 'character', executionId: 'execution', expectedRevision: 2,
                    requestId: 'request', action: { type: 'unimplemented', amount: -1 },
                },
            },
        };
        expect(parseCharacterMessage(packCharacterMessage(message))).toEqual(message);
        expect(parseCharacterMessage({
            __lssSheetSdk: 2,
            event: { type: 'lss:character-result', payload: { version: 1, connectionId: 'connection', result: {
                characterId: 'character', executionId: 'execution', requestId: 'request',
                phase: 'saved', revision: 3, savedThrough: 2, serverVersion: 'server-version',
            } } },
        })).toBeUndefined();
    });

    it('decodes attack and spell previews without passing private fields through', () => {
        const attacks = [{ id: 'attack', name: 'Spear', attackBonus: -1, damage: null, damageType: '' }];
        const spells = [{
            id: 'entry', catalogId: 'spell', name: 'Detect Magic', level: 1,
            saveDc: 13, charge: { current: 0, max: 2 },
        }];
        const withCatalog = {
            ...ready,
            payload: {
                ...ready.payload,
                snapshot: {
                    ...ready.payload.snapshot, catalog: {
                        attacks,
                        spells: [{ ...spells[0], notes: 'private', charge: { ...spells[0].charge, resourceId: 'internal' } }],
                    },
                },
            },
        };
        expect(parseCharacterMessage(packCharacterMessage(withCatalog))).toMatchObject({
            payload: { snapshot: { catalog: { attacks } } },
        });
        const parsed = parseCharacterMessage(packCharacterMessage(withCatalog));
        expect(parsed?.type === 'lss:character-ready' && parsed.payload.status === 'ready'
            && parsed.payload.snapshot.catalog?.spells).toEqual(spells);
        expect(parseCharacterMessage(packCharacterMessage({
            ...withCatalog,
            payload: {
                ...withCatalog.payload,
                snapshot: { ...withCatalog.payload.snapshot, catalog: { attacks, spells: null } },
            },
        }))).toMatchObject({ payload: { snapshot: { catalog: { attacks, spells: null } } } });
    });

    it('keeps the mutation list compatible and reads supported roll capabilities separately', () => {
        const message = {
            ...ready,
            payload: {
                ...ready.payload,
                snapshot: { ...ready.payload.snapshot, rollActions: ['weapon.roll-attack', 'future.roll', 'saving-throw.roll', 'initiative.roll'] },
            },
        };
        expect(parseCharacterMessage({ __lssSheetSdk: 2, event: message })).toEqual({
            ...message,
            payload: {
                ...message.payload,
                snapshot: { ...message.payload.snapshot, rollActions: ['weapon.roll-attack', 'saving-throw.roll', 'initiative.roll'] },
            },
        });
    });

    it('filters malformed optional skills and counters without dropping existing data', () => {
        const skill = { id: 'sleight of hand', name: 'Ловкость рук' };
        const counters = [
            { id: 'arrows', name: 'Стрелы', current: 3, max: 10, canAdjust: true },
            { id: 'points', name: 'Очки', current: 0, max: null, canAdjust: false },
        ];
        const snapshot = {
            ...ready.payload.snapshot,
            catalog: { attacks: [], spells: null, skills: [skill] },
            resources: counters,
        };
        const expected = { ...ready, payload: { ...ready.payload, snapshot } };
        expect(parseCharacterMessage({
            __lssSheetSdk: 2,
            event: {
                ...expected,
                payload: {
                    ...expected.payload,
                    snapshot: {
                        ...snapshot,
                        catalog: { ...snapshot.catalog, skills: [{ ...skill, private: true }, { id: '', name: 'Invalid' }] },
                        resources: [
                            { ...counters[0], location: 'private' }, counters[1],
                            { ...counters[0], current: -1 }, { ...counters[0], max: Infinity },
                        ],
                    },
                },
            },
        })).toEqual(expected);
    });

    it.each([
        { type: 'weapon.roll-attack', weaponId: 'rapier', intent: 'disadvantage' },
        { type: 'weapon.roll-damage', weaponId: 'rapier', critical: true },
        { type: 'saving-throw.roll', ability: 'dex', intent: 'advantage' },
        { type: 'ability-check.roll', ability: 'str', intent: 'advantage' },
        { type: 'skill-check.roll', skillId: 'sleight of hand', intent: 'disadvantage' },
        { type: 'initiative.roll' },
        { type: 'resource.adjust', resourceId: 'arrows', delta: -2 },
    ])('preserves the typed $type arguments on the wire', (action) => {
        const command = { characterId: 'character', executionId: 'execution', requestId: 'request', expectedRevision: 2, action };
        const envelope = {
            __lssSheetSdk: 2,
            event: { type: 'lss:character-command', payload: { version: 1, connectionId: 'connection', command } },
        };
        expect(isCharacterCommand(command)).toBe(true);
        expect(parseCharacterMessage(envelope)).toEqual(envelope.event);
    });

    it.each([
        { type: 'weapon.roll-attack', weaponId: 'rapier', intent: 'invalid' },
        { type: 'weapon.roll-damage', weaponId: 'rapier', critical: 1 },
        { type: 'saving-throw.roll', ability: 'perception' },
        { type: 'ability-check.roll', ability: 'luck' },
        { type: 'skill-check.roll', skillId: '' },
        { type: 'initiative.roll', intent: 'invalid' },
        { type: 'resource.adjust', resourceId: 'arrows', delta: 0 },
        { type: 'resource.adjust', resourceId: 'arrows', delta: 1.5 },
    ])('keeps an invalid $type addressable for rejection', (action) => {
        const command = { characterId: 'character', executionId: 'execution', requestId: 'request', expectedRevision: 2, action };
        const decoded = parseCharacterMessage({
            __lssSheetSdk: 2,
            event: { type: 'lss:character-command', payload: { version: 1, connectionId: 'connection', command } },
        });
        expect(decoded?.type).toBe('lss:character-command');
        if (decoded?.type !== 'lss:character-command') throw Error('command not decoded');
        expect(decoded.payload.command.requestId).toBe(command.requestId);
        expect(isCharacterCommand(command)).toBe(false);
        expect(isCharacterCommand(decoded.payload.command)).toBe(false);
    });

    it('decodes a rolled result with the kept d20 and rejects an impossible face', () => {
        const result = {
            characterId: 'character', executionId: 'execution', requestId: 'request', phase: 'rolled',
            roll: { total: 8, formula: '1d20+5', intent: 'disadvantage', natural: 3 },
        };
        const envelope = {
            __lssSheetSdk: 2,
            event: { type: 'lss:character-result', payload: { version: 1, connectionId: 'connection', result } },
        };
        expect(parseCharacterMessage(envelope)).toEqual(envelope.event);
        expect(parseCharacterMessage({
            ...envelope,
            event: {
                ...envelope.event,
                payload: { ...envelope.event.payload, result: { ...result, roll: { ...result.roll, natural: 21 } } },
            },
        })).toBeUndefined();
    });

    it('accepts addressable actions but validates the parameters of each known action', () => {
        const address = { characterId: 'character', executionId: 'execution', requestId: 'request', expectedRevision: 2 };
        const command = { ...address, action: { type: 'spell.spend-charge', spellId: 'entry' } };
        expect(isCharacterCommand(command)).toBe(true);
        expect(isCharacterCommand({ ...command, action: { type: 'spell.spend-charge', amount: 1 } })).toBe(false);
        expect(isCharacterCommand({ ...command, action: { type: 'health.damage', amount: -1 } })).toBe(false);
        for (const action of [command.action, { type: 'unimplemented' }]) {
            const message = {
                type: 'lss:character-command',
                payload: { version: 1, connectionId: 'connection', command: { ...address, action } },
            } satisfies CharacterMessage;
            expect(parseCharacterMessage(packCharacterMessage(message))).toEqual(message);
        }
    });
});
