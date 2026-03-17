import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
        exclude: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "clover", "json", "lcov"],
        },
    },
});
