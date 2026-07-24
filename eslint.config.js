import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'defaults/', '**/*.test.ts'],
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'semi': 'off',
      '@stylistic/max-len': ['error', { code: 180 }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/semi': ['error', 'always'],

      // 1. Alphabetical imports without extra spacing
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // 2. Maximum 2 consecutive empty lines
      '@stylistic/no-multiple-empty-lines': ['error', { max: 2, maxEOF: 0, maxBOF: 0 }],

      // 3. Line padding between statements
      '@stylistic/padding-line-between-statements': [
        'error',
        // Empty line after all imports before other code
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },

        // Empty line before `return` for readability
        { blankLine: 'always', prev: '*', next: 'return' },

        // Empty line after block-like structures (if, for, while, switch)
        { blankLine: 'always', prev: 'block-like', next: '*' },

        // Empty line after variable declarations (separating let/const from logic)
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      ],
    },
  }
);
