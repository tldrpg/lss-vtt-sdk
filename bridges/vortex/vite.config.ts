import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
    // Served at bridge.longstoryshort.app/vortex/obr/ — set base so Vite
    // rewrites asset paths in both HTML entries accordingly.
    base: '/vortex/obr/',
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    preview: {
        // Allow all trycloudflare.com tunnels + localhost for development
        allowedHosts: ['.trycloudflare.com', 'localhost', '127.0.0.1'],
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
