import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm", "cjs"],
    target: "node18",
    platform: "node",

    dts: true,
    sourcemap: true,
    clean: true,
    minify: false, // keep readable

    // Keep deps external (recommended for Vite plugins / babel tooling)
    external: [
        "vite",
        "rollup",
        "@babel/core",
        "@babel/types",
    ],

    // Ensure correct extensions when package.json has "type": "module"
    outExtension({ format }) {
        return format === "cjs" ? { js: ".cjs" } : { js: ".mjs" };
    },
});