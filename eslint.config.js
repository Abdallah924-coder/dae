'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**', 'coverage/**'],
  },
  {
    files: ['client/src/**/*.{js,jsx}', 'server/**/*.js', 'vite.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^[A-Z][A-Za-z0-9]*$',
          vars: 'all',
          args: 'all',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
