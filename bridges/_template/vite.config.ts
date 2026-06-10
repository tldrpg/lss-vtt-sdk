import { defineConfig } from 'vite';

export default defineConfig({
    // Set `base` to your deployment path, e.g. '/my-vtt/'
    // base: '/my-vtt/',
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
});
