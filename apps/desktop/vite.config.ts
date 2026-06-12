import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["@spdl/widevine", "protobufjs", "protobufjs/minimal", "protobufjs/minimal.js"]
            }
          }
        }
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: "[name].cjs",
                chunkFileNames: "[name].cjs",
                assetFileNames: "[name].[ext]"
              }
            }
          }
        }
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true
  }
});
