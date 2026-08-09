# Level 2 — groups (protocol)

Level 1 (embed a sheet, read rolls/manifest/health) needs nothing from us beyond the
existing protocol. Level 2 adds LSS **groups** (see the `storyview` repo's
`docs/plans/access-groups.md`, § "Стол VTT") — shared rights between the players seated
at a third-party table, without pulling in the Vortex room hub. Owlbear Rodeo is
deliberately out of scope here: it already gets this via the Vortex bridge
(`bridges/vortex`), so the mechanism below targets any *other* integration that wants
shared rights without adopting Vortex.

**Status of this doc:** the protocol (event types below, `dnd:group-status` replay) is
implemented in this repo, and the LSS-hosted pages it depends on (`iframe/group/`,
`iframe/groups/`) plus the sheet-side join popup are implemented in `storyview` against
exactly this contract. Not yet published to npm — an integrator gets the new event types
only after the version bump.

## Why not OBR-style shared room metadata

The two existing Owlbear bridges (`bridges/dnd`, `bridges/vortex`) both use OBR's
`room.setMetadata`/`onMetadataChange` as a shared-state channel. That primitive is
Owlbear-specific — a generic "any VTT" mechanism can't assume it exists. Level 2 instead
reuses the one channel every Level 1 integrator already has: `postMessage` between an
iframe and its host, via `createBridgeSheetSource`/`createSheetClient`. No new SDK
primitive, just three new event types.

## The three events

| Type | Direction | Payload |
|------|-----------|---------|
| `lss:group-selected` | group-manager page → host | `{ groupId, code, name }` |
| `dnd:group-code` | host → player's sheet | `{ code: string \| null }` |
| `dnd:group-status` | sheet → host | `{ connected: boolean }` |

`dnd:group-status` is a *state* event (like `dnd:manifest`/`dnd:health`) — replayed to a
handler that subscribes late, via the same mechanism already built for those. The other
two are one-off facts of a single setup flow, not persisted sheet state, so they are not
replayed.

## Integration flow

0. **Register your table.** Two things happen at once: your origin is added to the CSP
   `frame-ancestors` allowlist (without it a browser will not let you embed our pages at
   all), and you are issued a **client slug**. Every LSS group page must be embedded with
   `?client=<your slug>`. The slug — not your domain — is what keeps your GMs' groups
   separate from the ones they made at other tables, so it survives you moving to another
   domain. You cannot pick it yourself: an unregistered slug is refused.
1. **First setup.** Embed `iframe/group/?client=<slug>` (LSS-hosted) somewhere in your
   own GM-only UI — it gates on LSS login the same way any embedded sheet does. The GM
   creates a group; the page posts `lss:group-selected` up. **You must persist
   `groupId`/`code` in your own room/session data.** Without it, every new session at the
   table creates a fresh group and stranded previously-connected players.
2. **Reconnect.** On later sessions, embed
   `iframe/group/?client=<slug>&code=<your saved code>` instead of a bare create screen —
   this is a status check, not a picker; it will never show you a list of other groups you
   own (see "Why no picker" below).
3. **Reconnect after a long gap.** Same as above — a group with no activity for a while
   is soft-archived server-side, and the owner-gated reconnect endpoint clears that
   automatically the moment its real owner reconnects with the saved code. No special
   handling needed on the integrator's side.
4. **Connecting a player.** Whenever you decide to (player joins your table, GM clicks
   "invite", etc.), call `source.send({ type: 'dnd:group-code', payload: { code } })` on
   that player's existing Level 1 `createBridgeSheetSource` instance — the same one used
   for rolls/manifest/health. The sheet asks the player and creates the actual
   membership itself, through its own logged-in session — never silently.
5. **Drawing your own "who's connected" list.** Subscribe to `dnd:group-status` on each
   player's source the same way you already subscribe to rolls. No party-list UI is
   provided by us — you already have one embed per seat, so you already have everything
   needed to build your own roster with a connected/not-connected indicator.

## Why no picker on the create/reconnect page

`iframe/group/` intentionally does not offer "pick one of your existing groups" inline.
A GM opening it without a saved code (because a session lost track of one) could easily
attach a brand-new table to an unrelated, older group by mistake. A separate,
opt-in `iframe/groups/?client=<slug>` route exists for integrators who deliberately want to
show the GM's group list for some purpose of their own — it is not part of the default
setup flow, and you should not embed it as a substitute for persisting `groupId`/`code`.
It lists only the groups made at *your* table (that is what the slug is for), never the
GM's groups from someone else's integration.

## What this repo does not do for you

- It does not create, join, or manage groups on your behalf — that's the two LSS-hosted
  pages plus your own persistence of `groupId`/`code`.
- It does not render a member list or connection roster — build it from `dnd:group-status`.
- It does not gate who *may* see a connected sheet — that's LSS's own access model
  (group owner always sees everything; other members follow the per-character visibility
  the GM set), unaffected by which VTT is embedding the sheet.
