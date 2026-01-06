import { transformSync } from "@babel/core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type {NormalizedOutputOptions, OutputBundle, OutputOptions} from "rollup";
import type { Plugin as VitePlugin } from "vite";

import fortiPrepTransform, {
    type FortiPrepTransformOptions,
} from "../babel/transform";

export type FortiPrepOptions = FortiPrepTransformOptions & {
    /**
     * Which emitted entry file extensions should be rewritten.
     * Default: [".js", ".mjs"]
     */
    entryExtensions?: string[];

    /**
     * Vite plugin name
     * Default: "fortiplugin-prep"
     */
    pluginName?: string;
};

const DEFAULT_INJECTED_IDS = ["react", "react/jsx-runtime"] as const;
const DEFAULT_INJECTED_PREFIXES = ["@inertiajs/", "@host/"] as const;

function resolveOutDir(outputOptions: OutputOptions): string | null {
    if (outputOptions.dir) return outputOptions.dir;
    if (outputOptions.file) return dirname(outputOptions.file);
    return null;
}

function shouldInject(id: string, opts: FortiPrepTransformOptions): boolean {
    const ids = opts.injectedIds ?? [];
    const prefixes = opts.injectedPrefixes ?? [];
    if (ids.includes(id)) return true;
    for (const p of prefixes) if (id.startsWith(p)) return true;
    return false;
}

/**
 * FortiPlugin bundle adapter:
 * - marks injected imports as Rollup externals (so they survive into output)
 * - rewrites built entry chunks to remove those imports and load them from runtime deps
 */
export default function prep(options: FortiPrepOptions = {}): VitePlugin {
    const injectedIds = options.injectedIds ?? [...DEFAULT_INJECTED_IDS];
    const injectedPrefixes = options.injectedPrefixes ?? [...DEFAULT_INJECTED_PREFIXES];

    const runtimeKey = options.runtimeKey ?? "imports";
    const depsParam = options.depsParam ?? "deps";

    const entryExtensions = options.entryExtensions ?? [".js", ".mjs"];
    const pluginName = options.pluginName ?? "fortiplugin-prep";

    const transformOptions: FortiPrepTransformOptions = {
        injectedIds,
        injectedPrefixes,
        runtimeKey,
        depsParam,
    };

    return {
        name: pluginName,
        apply: "build",

        config() {
            return {
                define: {
                    "process.env.NODE_ENV": '"production"',
                },
                build: {
                    rollupOptions: {
                        // Ensure virtual imports don't need to resolve.
                        external: (id: string) => shouldInject(id, transformOptions),
                    },
                },
            };
        },

        writeBundle(outputOptions: NormalizedOutputOptions, bundle: OutputBundle) {
            const outDir = resolveOutDir(outputOptions);
            if (!outDir) return;

            for (const [fileName, item] of Object.entries(bundle)) {
                if (item.type !== "chunk") continue;
                if (!item.isEntry) continue;

                if (!entryExtensions.some((ext) => fileName.endsWith(ext))) continue;

                const absPath = resolvePath(outDir, fileName);
                const input = readFileSync(absPath, "utf-8");

                const result = transformSync(input, {
                    filename: absPath,
                    sourceType: "module",
                    // Fresh plugin instance per file (Babel calls plugin factory per file when passed as [fn, opts])
                    plugins: [[fortiPrepTransform as any, transformOptions]],
                    generatorOpts: {
                        compact: false,
                        comments: true,
                        retainLines: false,
                    },
                });

                if (!result?.code) continue;
                writeFileSync(absPath, result.code, "utf-8");
            }
        },
    };
}