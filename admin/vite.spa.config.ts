import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  // Media is imported and inlined; skip copying the Grok PWA extras into the single file.
  publicDir: false,
  resolve: {
    tsconfigPaths: true,
    alias: { "@": resolve(root, "src") },
  },
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: resolve(root, "dist-spa"),
    emptyOutDir: true,
    assetsInlineLimit: 2_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    target: ["es2019", "safari13"],
    cssCodeSplit: false,
    codeSplitting: false,
    rollupOptions: {
      input: resolve(root, "spa.html"),
    },
  },
});
