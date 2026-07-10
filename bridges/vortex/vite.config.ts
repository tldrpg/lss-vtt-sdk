import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vite';

// Deploy channel: 'prod' (live) or e.g. 'staging' (parallel isolated extension).
const channel = process.env.VITE_BRIDGE_CHANNEL ?? 'prod';

// Served at bridge.longstoryshort.app/vortex/obr/ (prod) or /vortex/obr-<channel>/.
const base = channel === 'prod' ? '/vortex/obr/' : `/vortex/obr-${channel}/`;

// Changes on every release so the embedded Vortex iframe URL changes with it,
// busting the browser's heuristic cache of Vortex's HTML (served without
// Cache-Control). Git SHA when available, build timestamp otherwise.
const bridgeBuild = (() => {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return String(Date.now());
    }
})();

const allowedHosts = ['.trycloudflare.com', 'localhost', '127.0.0.1'];

// OBR extension manifest, generated per channel so prod and staging get distinct
// names and self-consistent (base-prefixed) asset paths. Emitted into the build
// output and also served in dev so a tunnelled dev server is installable in OBR.
function obrManifest() {
    const suffix = channel === 'prod' ? '' : ` (${channel})`;
    return {
        name: `LSS Vortex${suffix}`,
        version: '0.1.1',
        manifest_version: 1,
        description: 'Vortex room hub and roll logger by Long Story Short',
        author: 'Long Story Short',
        icon: `${base}icon.svg`,
        action: {
            title: `Vortex${suffix}`,
            icon: `${base}icon-popover.svg`,
            popover: base,
            width: 400,
            height: 650,
        },
    };
}

function manifestPlugin(): Plugin {
    return {
        name: 'emit-obr-manifest',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'manifest.json',
                source: JSON.stringify(obrManifest(), null, 2),
            });
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url && req.url.replace(/\?.*$/, '').endsWith('/manifest.json')) {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(obrManifest(), null, 2));
                    return;
                }
                next();
            });
        },
    };
}

export default defineConfig({
    // Served at bridge.longstoryshort.app<base> — set base so Vite rewrites asset
    // paths in both HTML entries accordingly.
    base,
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        __BRIDGE_BUILD__: JSON.stringify(bridgeBuild),
    },
    plugins: [manifestPlugin()],
    server: {
        // Allow all trycloudflare.com tunnels + localhost for development
        allowedHosts,
    },
    preview: {
        allowedHosts,
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                logger: resolve(__dirname, 'logger.html'),
                // test.html and test-mock-obr.html are kept locally for development
                // but excluded from the production build.
            },
        },
    },
});
