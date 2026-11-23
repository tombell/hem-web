import cloudflare from "@cloudflare/oxlint-config/vite-plus";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [],
    sortImports: true,
  },
  lint: {
    extends: [cloudflare],
    env: cloudflare.env,
    // Regenerate this file with `pnpm api:types` instead of editing it.
    ignorePatterns: [...cloudflare.ignorePatterns, "packages/dashboard/src/api.generated.ts"],
    rules: {
      // Preact uses DOM attribute names such as `class` and `for`.
      "react/no-unknown-property": "off",

      // Payload parsing, log events, JSON response bodies, and test helpers
      // handle objects whose values are unknown until they are checked.
      "quality/no-unsafe-dictionary-type": "off",
    },
    overrides: [
      {
        // The server and its scripts log to the terminal.
        files: ["packages/server/scripts/**", "packages/server/src/server.ts"],
        rules: { "no-console": "off" },
      },
    ],
  },
});
