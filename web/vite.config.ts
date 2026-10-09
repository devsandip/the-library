import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/thelibrary/",
  plugins: [preact()],
  build: { outDir: "dist", assetsDir: "assets", target: "es2022" },
  server: { port: 5173, strictPort: true },
});
