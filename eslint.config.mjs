import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './packages/backend/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
      rules: {
          '@typescript-eslint/no-explicit-any': 'warn',
          '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
          '@typescript-eslint/no-extraneous-class': 'off',
      }
  },
  {
    ignores: [
        'eslint.config.mjs',
        '**/dist/', 
        '**/node_modules/', 
        '**/.yarn/', 
        '**/build/', 
        '**/.pnp.*', 
        'packages/contracts/contracts/',
        'packages/contracts/generated/',
        'packages/blockchain/generated/'
    ],
  },
);
