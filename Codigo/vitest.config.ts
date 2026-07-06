import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Type-level tests (*.test-d.ts) run only under `pnpm test:types`
    // (vitest run --typecheck). The default runtime run stays fast.
    typecheck: {
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Type-only module — erased at compile time, no runtime surface.
        'src/ui/messages.ts',
        'src/models/**',
        // Thin activation wiring is exercised in tests/extension.test.ts, but
        // the constructed real services make line coverage misleading here.
        'src/**/*.d.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
