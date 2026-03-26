import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
var __dirname = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist",
        rollupOptions: {
            input: {
                app: resolve(__dirname, "index.html"),
                content: resolve(__dirname, "src/content.tsx"),
                background: resolve(__dirname, "src/background.ts")
            },
            output: {
                entryFileNames: "assets/[name].js",
                chunkFileNames: "assets/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]"
            }
        }
    }
});
