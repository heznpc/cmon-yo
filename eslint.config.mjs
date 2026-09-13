import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'ios/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['src/app/**', 'src/features/**', 'src/contracts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/server/**', 'node:*'], paths: ['fastify', '@fastify/static', 'vite'] },
      ],
    },
  },
);
