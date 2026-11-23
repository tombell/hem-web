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

      // Temporarily off while migrating to @cloudflare/oxlint-config.
      // Enable each rule with its fixes in a separate commit.
      "react/button-has-type": "off",
      "react/immutability": "off",
      "react/purity": "off",
      "react-hooks/exhaustive-deps": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-explicit-any": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-misused-promises": "off",
      "typescript/no-non-null-assertion": "off",
      "typescript/no-unsafe-argument": "off",
      "typescript/no-unsafe-assignment": "off",
      "typescript/no-unsafe-call": "off",
      "typescript/no-unsafe-member-access": "off",
      "typescript/no-unsafe-return": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/return-await": "off",
      "unicorn/prefer-import-meta-properties": "off",
      "unicorn/prefer-structured-clone": "off",
      "quality/no-array-filter-map": "off",
      "quality/no-conditional-empty-object-spread": "off",
      "quality/no-known-value-widening": "off",
      "quality/no-unsafe-dictionary-type": "off",
    },
    overrides: [
      {
        // The server and its scripts log to the terminal.
        files: ["packages/server/scripts/**", "packages/server/src/server.ts"],
        rules: { "no-console": "off" },
      },
      {
        // Temporarily off; the preset re-enables it for TypeScript files.
        files: ["**/*.{ts,tsx,mts,cts}"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
});
