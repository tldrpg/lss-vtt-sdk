// Universal core entry — VTT- and app-agnostic, zero runtime dependencies.
// The Owlbear adapter is a separate entry point (./owlbear) so the core
// never pulls @owlbear-rodeo/sdk. This mirrors the published exports map.
export * from './types';
export { createSheetBridge } from './createSheetBridge';
export { createSheetClient } from './createSheetClient';
export { createBridgeSheetSource } from './createBridgeSheetSource';
export type { BridgeSheetSource, BridgeSheetSourceOptions, SheetFrameRef } from './createBridgeSheetSource';
export { formatRollMessage, rollVariant } from './formatRoll';
