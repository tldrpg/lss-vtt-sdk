# SDK review roadmap — consolidation, protocol hygiene, integration guide

Follow-up to the code review of `@longstoryshort/vtt-sdk`. Captures the agreed
direction and breaks it into ordered, independently-shippable phases.

This roadmap does **not** cover the OBR init-timing fix — that has its own plan in
[`obr-bridge-init-retry.md`](./obr-bridge-init-retry.md). Land that whenever; it is
orthogonal to everything below.

## Goal recap

The repo has two jobs:

1. **The SDK** — let third-party VTT authors embed the LSS character sheet via
   iframe + postMessage and talk to it.
2. **The bridges** — functional OBR integrations that double as *reference
   examples* of how to use the SDK.

The review found job #1 is solid; job #2 is half-met because the **Vortex bridge
does not use the SDK at all** and re-implements transport / OBR bootstrap / origin
checks / sandbox under a parallel `vortex:*` protocol. The core is also carrying a
fully-typed but unexercised inbound contract (capability / manifest / health), and
the two halves of the repo apply very different rigor (typed core vs `any`-heavy
Vortex).

## Decisions taken (do not re-litigate)

- **Event naming:** migrate the wire `type` strings from SCREAMING_CAPS to a flat
  `dnd:*` namespace — `dnd:roll`, `dnd:manifest`, `dnd:health`, `dnd:command`.
  Direction (sheet→host vs host→sheet) is **not** encoded in the name — it lives in
  the README status table. Rationale: `roll` already travels two topologies
  (sheet→bridge via postMessage *and* bridge→peer via OBR broadcast), so a
  direction prefix would be factually wrong on the broadcast leg, and topology is
  the thing most likely to change as tables are added.
- **Unused events:** keep the full vocabulary as a forward contract; do **not**
  build the inbound wiring now (YAGNI — no real consumer yet). Mark the unexercised
  surface `@experimental` and tier it as `reserved` in the README. The sheet
  already has these capabilities; whether each is worth wiring is a per-table
  *policy* decision, not a protocol gap.

## Guiding principles

- **Protocol = vocabulary (superset); bridge = policy (chosen subset).** The SDK
  declares everything a sheet can express; each bridge decides what to wire.
- **`createSheetBridge` is the "default roll bridge", not the whole protocol.** Its
  fixed toast+broadcast+label pipeline is one opinionated policy, not law.
- **Do the cheap, non-breaking consolidation before the breaking rename**, so the
  rename touches already-deduplicated code.
- **Match the core's rigor everywhere** — no new `any`, types over casts.

---

## Phase 1 — Protocol naming migration (`dnd:*`)  ⚠️ breaking, lockstep

The only phase that crosses the wire boundary, so it needs a coordinated deploy of
the sheet app and the bridges. Cheap now (0.1.0, single first-party producer);
expensive once external bridges exist — so do it first.

**Changes**
- [src/types.ts](../../src/types.ts) — rename the four `SheetEvent` members:
  `DICE_ROLL→dnd:roll`, `MANIFEST→dnd:manifest`, `HEALTH_CHANGED→dnd:health`,
  `CAPABILITY_COMMAND→dnd:command`.
- [src/postMessageProtocol.ts](../../src/postMessageProtocol.ts) — bump
  `VERSION` 1→2 so a sheet/bridge version mismatch fails explicitly instead of
  silently dropping.
- Update literal references: [createSheetBridge.ts](../../src/createSheetBridge.ts)
  (broadcast + `onEvent` filter), [createBridgeSheetSource.ts](../../src/createBridgeSheetSource.ts)
  (`onRoll`/`onManifest` filters), and all three `*.test.ts` envelopes.
- **Cross-repo (storyview):** update the sheet-side emitter to the new strings +
  `VERSION` 2. This is the lockstep partner — nothing ships until both sides agree.
- Redeploy both bridges (CI on push to `master`).

**Risk / mitigation:** breaking on the wire. Mitigate with a single coordinated
deploy and the explicit `VERSION` bump (mismatch → dropped, not mis-parsed). No
backward-compat shim — there are no external consumers yet.

---

## Phase 2 — Maturity tiering of the protocol

Stop advertising the inbound contract as done; keep it as a typed reservation.

**Changes**
- [src/types.ts](../../src/types.ts) — add `@experimental` JSDoc to
  `CapabilityOperation` & friends, `CapabilityManifest`, `HealthChangedPayload`,
  and the `dnd:manifest`/`dnd:health`/`dnd:command` arms of `SheetEvent`.
- [README.md](../../README.md) — replace the flat protocol table with a status +
  direction table:

  | Type | Status | Direction |
  |------|--------|-----------|
  | `dnd:roll` | ✅ stable | sheet → host |
  | `dnd:manifest` | 🧪 reserved | sheet → host |
  | `dnd:health` | 🧪 reserved | sheet → host |
  | `dnd:command` | 🧪 reserved | host → sheet |

- [src/createSheetBridge.ts](../../src/createSheetBridge.ts) — clarify in the doc
  comment that it is the *default roll bridge* (a policy), not a full protocol
  handler; inbound capability wiring will be a separate opt-in helper when needed.

**Risk:** none (docs + annotations only).

---

## Phase 3 — Extract shared primitives into the SDK

Kill the duplication the review flagged, and expose the pieces Vortex will reuse in
Phase 4. Non-breaking additive exports.

**Targets**
- **Sandbox string** (3 copies: [README.md:82](../../README.md#L82),
  [bridges/vortex/src/shared.ts:58](../../bridges/vortex/src/shared.ts#L58),
  [bridges/dnd/src/main.ts:18](../../bridges/dnd/src/main.ts#L18)) → export a single
  `SHEET_IFRAME_SANDBOX` constant from the core entry; reference it everywhere.
- **`OBR.onReady` promisification** (3 copies:
  [main.ts:25](../../bridges/vortex/src/main.ts#L25),
  [logger.ts:32](../../bridges/vortex/src/logger.ts#L32),
  [OwlbearAdapter.ts:88](../../src/adapters/owlbear/OwlbearAdapter.ts#L88)) →
  expose `whenObrReady(obr)` from the `/owlbear` entry.
- **OBR bootstrap** — two strategies for "obtain OBR in this frame" today:
  `resolveOBR` ([shared.ts:73](../../bridges/vortex/src/shared.ts#L73), parent-first)
  vs `loadSdk` + `syncObrref`
  ([OwlbearAdapter.ts:110](../../src/adapters/owlbear/OwlbearAdapter.ts#L110),
  preload-global + dynamic import). Pick one canonical path and export it from
  `/owlbear` so both bridges share it. Decide whether the `window.__lssObrSdk`
  preload contract should be typed/asserted rather than living in a comment.

**Risk:** low; additive. Keep old call sites working until Phase 4 swaps them.

---

## Phase 4 — Realign the Vortex bridge onto the SDK

Make Vortex an SDK *consumer* (at least for transport/bootstrap/sandbox), so it
stops being a counter-example and the dead dependency becomes a real one.

**Changes**
- Remove the unused `@longstoryshort/vtt-sdk` dep from
  [bridges/vortex/package.json](../../bridges/vortex/package.json) **or** make it
  real by importing the Phase 3 primitives (`SHEET_IFRAME_SANDBOX`,
  `whenObrReady`, the shared OBR bootstrap).
- Replace Vortex's bespoke `resolveOBR` / `onReady` wrap / `IFRAME_SANDBOX` with the
  SDK exports.
- **Scope honestly:** Vortex's domain (room hub + roll logger) is not the
  sheet-embed model, so its `vortex:*` app-protocol stays. Only the *plumbing*
  (transport bootstrap, OBR resolution, sandbox, origin-check helper) is unified.
  Do not force the hub through `createSheetBridge`.

**Depends on:** Phase 3.
**Risk:** medium — touches a deployed extension; verify in OBR after.

---

## Phase 5 — Vortex `logger.ts` cleanup

Bring the loosest module up to the core's rigor.

**Changes**
- Split the 218-line `init()` closure
  ([logger.ts](../../bridges/vortex/src/logger.ts)) into separate concerns:
  panel state-machine, rendering/templating, OBR IO. Per the repo's
  one-file-per-unit convention, extract helpers into their own files.
- Type `window.OBR` instead of `declare global { interface Window { OBR: any } }`
  + `(window as any)` ([shared.ts:74-88](../../bridges/vortex/src/shared.ts#L74),
  [main.ts:17](../../bridges/vortex/src/main.ts#L17)).
- `escapeHtml` is HTML-context only; the `--char-color` value is injected into a
  **CSS** context ([logger.ts:111](../../bridges/vortex/src/logger.ts#L111)) — give
  it a CSS-safe path (validate/whitelist the color) rather than HTML-escaping.

**Depends on:** Phase 4 (touch the file once).
**Risk:** medium; verify logger UI in OBR after.

---

## Phase 6 — Integration guide + bridge template

Deliver the "build a minimal VTT+LSS bridge" guide — the explicit ask.

**Changes**
- `bridges/_template/` — a minimal skeleton: `VTTAdapter` stub →
  `createBridgeSheetSource` → `createSheetBridge` → iframe embed → static deploy.
  The DnD bridge is already ~30 lines and effectively this; the template is its
  generalized, table-agnostic form.
- `docs/integration-guide.md` — the DnD bridge explained line-by-line, plus "how to
  write a `VTTAdapter` for your table" (the seam, what each method must do, what
  `labelOverSelection` returning `false` means, best-effort vs guaranteed paths).
- Cross-link from [README.md](../../README.md) ("Adapt for your own VTT").

**Depends on:** Phases 1–2 (guide must use final `dnd:*` names and reflect which
events are stable vs reserved).
**Risk:** none.

---

## Phase 7 — Optional polish (defer until driven by need)

- **LSP — `labelOverSelection` return** conflates "no selection", "unsupported",
  and "permission denied" all as `false`
  ([OwlbearAdapter.ts:159-205](../../src/adapters/owlbear/OwlbearAdapter.ts#L159)).
  Consider a richer result (`placed | no-selection | unsupported | denied`) or a
  separate `supportsLabels` capability flag, so a no-op adapter is distinguishable
  from a real failure.
- **ISP — `VTTAdapter` is a fat 10-member interface.** A bridge needing only
  `broadcast`+`notify` still implements scene/session/user. Consider splitting into
  presence / messaging / scene sub-interfaces.
- **`onX` proliferation** on `BridgeSheetSource` (`onRoll`/`onManifest`/…): each new
  outbound type adds another convenience method over the general `onEvent`. Decide
  whether to keep growing them or standardize on `onEvent` + a typed filter helper.

---

## Suggested sequencing

```
Phase 1 (rename, lockstep w/ storyview)  ──┐
Phase 2 (tiering/docs)                     ├─► Phase 6 (guide uses final names)
Phase 3 (extract primitives) ─► Phase 4 ─► Phase 5 (Vortex realign + cleanup)
Phase 7 — opportunistic, no fixed slot
```

Phases 1–2 and 3→4→5 are two independent tracks; Phase 6 waits on 1–2. Land
[`obr-bridge-init-retry.md`](./obr-bridge-init-retry.md) whenever convenient.

## Explicitly out of scope

- Backward-compat shims for the old CAPS protocol (no external consumers).
- Building the inbound capability/manifest/health machinery (reserved until a real
  consumer exists).
- Forcing the Vortex hub through `createSheetBridge` (different domain).
</content>
</invoke>
