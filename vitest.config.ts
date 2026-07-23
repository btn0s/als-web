import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // e2e/ holds the Playwright smoke; vitest must not pick up *.spec.ts there (known trap).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
})
