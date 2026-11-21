// Universal core entry — VTT- and app-agnostic, zero runtime dependencies.
// The Owlbear adapter is a separate entry point (./owlbear) so the core
// never pulls @owlbear-rodeo/sdk. This mirrors the published exports map.
export * from './types';
export { SHEET_IFRAME_SANDBOX } from './constants';
export { createSheetClient } from './createSheetClient';
export { wrapEnvelope as packSheetEvent } from './postMessageProtocol';
export { createBridgeSheetSource } from './createBridgeSheetSource';
export type {
    BridgeSheetSource, BridgeSheetSourceOptions, CharacterBridgeSheetSourceOptions, RoomCharacterBridgeSheetSourceOptions, SheetFrameRef,
} from './createBridgeSheetSource';
export { formatRollMessage, rollVariant } from './formatRoll';
export type { NotifyVariant } from './formatRoll';
export type {
    CharacterAction, CharacterActionPayload, CharacterAttack, CharacterSpell, CharacterCatalog, CharacterSkill, CharacterResource,
    CharacterAddress, CharacterSnapshot, CharacterCommand,
    CharacterWireCommand, CharacterResult, CharacterMessage,
    CharacterRollAction, CharacterRollActionPayload, CharacterRollIntent, CharacterRollResult, CharacterSaveAbility,
} from './characterProtocol';
export {
    CHARACTER_API_VERSION, isCharacterCommand, isCharacterRollActionType, packCharacterMessage, parseCharacterMessage,
} from './characterProtocol';
export type {
    CharacterConnectionStatus, CharacterSheetConnection, CharacterSheetFrame, CharacterSheetOptions,
} from './connectCharacterSheet';
export { connectCharacterSheet } from './connectCharacterSheet';
export type { RoomCharacterCommand, RoomCharacterMessage, RoomCharacterResult } from './roomCharacterProtocol';
export { packRoomCharacterMessage, parseRoomCharacterMessage } from './roomCharacterProtocol';
export type { RoomCharacterConnection } from './roomCharacterConnection';
