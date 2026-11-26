import { defineConfig } from "vitest/config";

export default defineConfig({
    // The build-time global that packages/app/src/types/lane.d.ts declares.
    define: {
        __ATELIER_LANE__: JSON.stringify("typescript"),
    },
    test: {
        include: ["packages/*/tests/**/*.test.ts"],
        environment: "node",
    },
});
