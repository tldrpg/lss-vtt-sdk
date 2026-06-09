import { defineConfig } from 'vite';

export default defineConfig({
    // Served at bridge.longstoryshort.app/dnd/obr/ — set base so Vite
    // rewrites asset paths in index.html accordingly.
    base: '/dnd/obr/',
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
});
