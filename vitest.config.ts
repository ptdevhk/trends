import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        environmentMatchGlobs: [
            ["packages/convex/convex/__tests__/*-convex-test.test.ts", "edge-runtime"],
        ],
        include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
        exclude: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx", "scripts/test-notifications.test.ts", "**/node_modules/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "clover", "json", "lcov"],
            exclude: ["**/dist/**", "**/node_modules/**"],
        },
    },
});
