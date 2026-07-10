# Vortex OBR bridge

Owlbear Rodeo extension that embeds the Vortex app and the roll logger.

## Channels

The bridge builds in a **channel** so a test copy can live in OBR next to prod
without touching it. OBR identifies an extension by its **manifest URL**, so a
different URL = a separate extension.

| Channel | Built by | Served at | OBR keys |
|---------|----------|-----------|----------|
| `prod` (default) | `npm run build` | `/vortex/obr/` | `rodeo.lss/vortex-room`, … |
| `staging` | `npm run build:staging` | `/vortex/obr-staging/` | `rodeo.lss/vortex-room.staging`, … |

The channel (`VITE_BRIDGE_CHANNEL`) drives the base path, the generated
`manifest.json` (name + paths), and the OBR metadata/popover/broadcast keys
(`shared.ts`), so staging never collides with prod in the same room.
`VITE_VORTEX_ORIGIN` overrides which Vortex app is embedded (defaults to prod).

## Local test stand (real OBR, doesn't touch prod)

```bash
npm run build:staging   # or: npm run build
npm run preview:staging # serves on http://localhost:4173
npm run tunnel          # cloudflared → https://<random>.trycloudflare.com
```

In OBR → Settings → Extensions → **Add Custom Extension**, paste:
`https://<random>.trycloudflare.com/vortex/obr-staging/manifest.json`

The tunnel hostname changes each run; use a named cloudflared tunnel for a
stable URL. `npm run dev` also serves the manifest (live reload) if you tunnel
port 5173 instead.

`test-mock-obr.html` mocks OBR for pure-UI work with no account/tunnel.

## Hosted staging (GitHub Pages)

Deploy is `.github/workflows/deploy-bridges.yml`. Every run rebuilds the whole
Pages site as **prod = `master` + staging = latest `stage-*` tag**, so a `master`
push never wipes staging and vice-versa.

- **Prod:** push to `master`.
- **Staging:** create and push a `stage-*` tag from any branch/commit, e.g.
  `git tag stage-0 && git push origin stage-0`. The tagged commit must already
  contain channel support (this change).

Staging extension URL: `https://bridge.longstoryshort.app/vortex/obr-staging/manifest.json`
