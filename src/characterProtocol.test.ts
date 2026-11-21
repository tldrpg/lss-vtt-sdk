import { describe, expect, it } from 'vitest';
import { packCharacterMessage, parseCharacterMessage } from './characterProtocol';
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
});
