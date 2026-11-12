import { defineConfig } from "vite";
import { resolve } from "node:path";

// Production build: two prerendered pages, English at "/" and Spanish at "/es/".
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        en: resolve(__dirname, "index.html"),
        es: resolve(__dirname, "es/index.html"),
      },
    },
  },
});
