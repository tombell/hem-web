import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [],
    sortImports: true,
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "warn",
    },
    env: {
      builtin: true,
      es2020: true,
    },
  },
});
