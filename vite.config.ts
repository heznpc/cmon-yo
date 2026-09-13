import { defineConfig } from 'vitest/config';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
export default defineConfig({
  plugins: [
    vanillaExtractPlugin(),
    {
      name: 'quote-vanilla-imports',
      enforce: 'post',
      transform(code, id) {
        // vanilla-extract 5.2.6 emits unescaped single-quoted absolute imports.
        // Preserve the actual repository path (which contains an apostrophe).
        if (!id.endsWith('.css.ts')) return;
        return code.replace(
          /import '([^\n]+\.vanilla\.css)';/g,
          (_, path: string) => `import ${JSON.stringify(path)};`,
        );
      },
    },
  ],
  build: {
    outDir: 'dist/client',
    manifest: true,
    rollupOptions: { input: 'src/app/entry-client.tsx' },
  },
  // Better Auth introspects all visible PostgreSQL schemas. Do not drop one
  // suite's schema during another suite's catalog read. Concurrency within
  // each HTTP/DB test remains explicit (Promise.all and row-lock races).
  test: {
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
