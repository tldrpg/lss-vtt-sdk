import { defineConfig } from 'vite';

export default defineConfig({
    // GitHub Pages serves the bridge at /lss-vtt-sdk/ (project repo, not org root).
    // Set base so Vite rewrites asset paths in index.html accordingly.
    base: '/dnd/obr/',
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
});
