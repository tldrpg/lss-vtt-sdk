import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
    {
        files: ['src/**/*.ts'],
        languageOptions: { parser: tsParser },
        plugins: { '@typescript-eslint': typescript },
        rules: {
            ...typescript.configs.recommended.rules,
            'no-console': 'warn',
        },
    },
    {
        ignores: ['dist/**', 'bridges/**'],
    },
];
