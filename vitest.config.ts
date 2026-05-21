import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
        exclude: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx", "scripts/test-notifications.test.ts", "**/node_modules/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "clover", "json", "lcov"],
        },
    },
});
