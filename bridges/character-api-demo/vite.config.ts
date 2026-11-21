import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
    if (command === 'build') return { base: '/dnd/character-api-demo/' };

    const env = loadEnv(mode, process.cwd(), 'DEMO_TLS_');
    if (!env.DEMO_TLS_CERT || !env.DEMO_TLS_KEY) {
        throw new Error('Укажите файлы локального HTTPS-сертификата в DEMO_TLS_CERT и DEMO_TLS_KEY.');
    }

    return {
        base: '/',
        server: {
            host: 'localhost',
            port: 5173,
            strictPort: true,
            https: {
                cert: readFileSync(env.DEMO_TLS_CERT),
                key: readFileSync(env.DEMO_TLS_KEY),
            },
        },
    };
});
