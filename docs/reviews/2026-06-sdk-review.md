# SDK review — baseline snapshot (June 2026)

Point-in-time assessment of `@longstoryshort/vtt-sdk` at commit `fc37df5`.

**This doc is a baseline, not a task list.** Actions derived from this review live
in [`../plans/sdk-review-roadmap.md`](../plans/sdk-review-roadmap.md) — that plan is
the source of truth for *what to change*. This file records two things the plan
deliberately does not carry: **what is already good and must survive refactors**,
and the **per-axis diagnosis** to measure future state against.

---

## Strengths to preserve (invariants — do not regress)

These are the things the core does right. A refactor that breaks one of them is a
regression even if it ships a feature.

- **Behavioral tests, not call-spies.** The suites assert behavior at the trust
  boundary — foreign origin rejected, foreign source window rejected, envelope
  survives an iframe reload ([createBridgeSheetSource.test.ts:99](../../src/createBridgeSheetSource.test.ts#L99)).
  Keep tests asserting *outcomes*, not "was called".
- **Comments explain *why*, not *what*.** The non-obvious bits (live `contentWindow`
  read, REMOTE-only broadcast needing a local echo, `obrref` restore) are explained
  at the decision, not narrated. New code should match this density.
- **Trust boundary is real and documented.** The sheet never exposes DOM / cookies /
  token across the frame; only the explicit envelope crosses, gated by source-window
  check + optional origin allowlist + marker ([postMessageProtocol.ts](../../src/postMessageProtocol.ts)).
  This is the SDK's reason to exist — do not let convenience erode it.
- **`VTTAdapter` is the OCP asset.** A new table = a new adapter, zero core changes
  ([types.ts:170](../../src/types.ts#L170)). This is the design's load-bearing wall.
- **DIP done right.** The core depends on abstractions (`SheetSource`, `VTTAdapter`);
  the concrete OBR SDK is isolated behind the interface and lazy-loaded, keeping the
  core zero-dependency and SSR-safe.
- **Localizable by contract.** All human-facing strings on the SDK side are
  overridable via `SheetBridgeMessages` ([types.ts:153](../../src/types.ts#L153)) —
  no hardcoded copy in the core. (The Vortex bridge violates this; see below.)

---

## Per-axis diagnosis (baseline)

### Readability
- **Core: excellent.** Precise names, helpful interface doc-comments, why-comments.
- **Vortex: lower rigor.** `declare global { interface Window { OBR: any } }` +
  scattered `(window as any)` throw away the type safety the core insists on
  ([shared.ts:74-88](../../bridges/vortex/src/shared.ts#L74), [main.ts:17](../../bridges/vortex/src/main.ts#L17)).
  `logger.ts` packs DOM + panel state-machine + OBR IO + `innerHTML` templating into
  one 218-line `init()` closure. Hardcoded Russian UI strings, no i18n seam — the
  opposite of the core's overridable-messages discipline.
  → addressed by roadmap Phases 4–5.

### Scalability
- **Strong:** `VTTAdapter` scales to new tables without core edits.
- **Friction:** `BridgeSheetSource` grows one `onX` method per outbound type
  ([createBridgeSheetSource.ts:70-91](../../src/createBridgeSheetSource.ts#L70)); a
  general `onEvent` already exists, so the conveniences will multiply.
- **Main risk:** the Vortex precedent. Each new "complex" table risks becoming
  another bespoke re-implementation past the SDK rather than an adapter — directly
  undermining the "bridges as examples" goal.
  → addressed by roadmap Phases 4, 6, 7.

### DRY
Concrete duplication at review time (full table in the roadmap, Phase 3):
- iframe sandbox string — 3 copies (README, vortex `shared.ts`, dnd `main.ts`).
- `OBR.onReady` promisification — 3 copies (vortex `main.ts`/`logger.ts`, `OwlbearAdapter`).
- OBR bootstrap — two divergent strategies (`resolveOBR` vs `loadSdk`+`syncObrref`).
- postMessage + origin-check + type-guard — two parallel protocols (SDK envelope vs `isVortexMessage`).
  → addressed by roadmap Phase 3.

### SOLID
- **SRP** — core clean (transport / orchestration / format / adapter separated);
  violated by `logger.ts` `init()`.
- **OCP** — `VTTAdapter` is the win, undermined by Vortex not consuming the SDK.
- **LSP** — `labelOverSelection` returns `false` for three distinct cases
  (no selection / unsupported / permission denied), making a no-op adapter
  indistinguishable from a real failure ([OwlbearAdapter.ts:159-205](../../src/adapters/owlbear/OwlbearAdapter.ts#L159)).
- **ISP** — `VTTAdapter` is a fat 10-member interface; a bridge needing only
  `broadcast`+`notify` still implements scene/session/user.
- **DIP** — exemplary (see Strengths).
  → LSP/ISP tracked in roadmap Phase 7.

### Protocol contract
The capability / manifest / health vocabulary is fully typed and carried by the
transport but unexercised: `createSheetBridge` handles only the roll event, and no
bridge consumes `onManifest`/`send`. Decision: keep the vocabulary as a forward
contract, mark it `@experimental` / `reserved` rather than delete or build it out.
  → addressed by roadmap Phase 2.
</content>
