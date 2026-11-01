import { preact } from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  plugins: [preact(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: { "/apple-health": "http://127.0.0.1:3000" },
  },
});
