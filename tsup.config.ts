import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'adapters/owlbear/index': 'src/adapters/owlbear/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['@owlbear-rodeo/sdk'],
    treeshake: true,
});
