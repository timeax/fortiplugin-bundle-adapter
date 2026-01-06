// src/utils/generate-plugin-inputs.ts
import path from "node:path";
import * as fs from "node:fs";

const EXT_PATTERN = /\.(tsx?|jsx?)$/i;

export type PluginInputs = Record<string, string>;

export type GeneratePluginInputsOptions = {
    /**
     * If true, also generates `app.tsx` that imports every discovered entry
     * (handy for dev/HMR).
     *
     * Default: true
     */
    writeAppEntry?: boolean;

    /**
     * Name of the generated app entry file (inside srcRoot).
     *
     * Default: "app.tsx"
     */
    appEntryName?: string;

    /**
     * Adds the generated app entry to the returned Rollup inputs map.
     *
     * Default: true
     */
    includeAppEntryInInputs?: boolean;

    /**
     * Key name used for the generated app entry in Rollup inputs.
     *
     * Default: "__app_entry"
     */
    appEntryKey?: string;

    /**
     * Extra directory names to ignore (case-insensitive).
     */
    ignoreDirs?: string[];

    /**
     * Extra “component-like” directory names to ignore (case-insensitive, exact match).
     */
    componentLikeDirs?: string[];

    /**
     * Whether to print discovered inputs to console.
     *
     * Default: true
     */
    verbose?: boolean;
};

// folders you typically never want as rollup inputs
const DEFAULT_IGNORE_DIRS = new Set<string>([
    "node_modules",
    ".git",
    ".vite",
    ".internal",
    "dist",
    "build",
    "public",
]);

// “component-like” folders that should NOT produce entrypoints
// Strict: exact folder-name matches only (case-insensitive)
const DEFAULT_COMPONENT_LIKE_DIRS = new Set<string>([
    "component",
    "components",
    "ui",
    "uis",
    "widget",
    "widgets",
    "atom",
    "atoms",
    "molecule",
    "molecules",
    "organism",
    "organisms",
    "layout",
    "layouts",
    "partial",
    "partials",
]);

function normalizeName(x: unknown): string {
    return String(x ?? "").toLowerCase();
}

function makeIgnoreSets(opts?: GeneratePluginInputsOptions): {
    ignoreDirs: Set<string>;
    componentLikeDirs: Set<string>;
} {
    const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);
    const componentLikeDirs = new Set(DEFAULT_COMPONENT_LIKE_DIRS);

    for (const d of opts?.ignoreDirs ?? []) ignoreDirs.add(normalizeName(d));
    for (const d of opts?.componentLikeDirs ?? []) componentLikeDirs.add(normalizeName(d));

    return { ignoreDirs, componentLikeDirs };
}

function isIgnoredDir(
    dirName: string,
    sets: { ignoreDirs: Set<string>; componentLikeDirs: Set<string> }
): boolean {
    const name = normalizeName(dirName);
    return sets.ignoreDirs.has(name) || sets.componentLikeDirs.has(name);
}

/**
 * Creates an app.tsx file that simply imports every discovered entry.
 * Helpful for HMR / dev mode.
 */
function writeAppEntryFile(inputs: PluginInputs, srcRoot: string, appEntryName: string): void {
    const app = path.join(srcRoot, appEntryName);
    const lines: string[] = ["// Auto-generated – do not edit", ""];

    const entries = Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b));

    for (const [name, full] of entries) {
        const rel =
            "./" + path.relative(srcRoot, full).replace(/\\/g, "/").replace(EXT_PATTERN, "");

        const variable = name.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^(\d)/, "_$1");

        lines.push(`import * as ${variable} from '${rel}';`);
        lines.push(`console.log('${name} loaded:', ${variable});`, "");
    }

    fs.writeFileSync(app, lines.join("\n"), "utf8");
    // eslint-disable-next-line no-console
    console.log(`✅ Generated ${appEntryName} in ${srcRoot}`);
}

/**
 * Convert a relative path like "foo/bar/index.tsx" to a dot key.
 * If `collapseIndex` is true, "foo/bar/index" becomes "foo.bar".
 * Otherwise it becomes "foo.bar.index".
 */
function pathToKey(relNoExt: string, opts: { collapseIndex: boolean }): string {
    let normalized = relNoExt.replace(/\\/g, "/");

    if (opts.collapseIndex) {
        normalized = normalized.replace(/\/index$/i, "");
    }

    let key = normalized.split("/").filter(Boolean).join(".");
    if (!key) key = "index";
    return key;
}

/**
 * Recursively collect entry files under dirPath.
 *
 * Rule:
 * - Prefer collapsing ".../index.tsx" => "..." for nicer keys
 * - BUT if that key would collide with another entry, fallback to explicit "...index"
 *   (e.g. "foo.index") for the index file ONLY.
 */
function crawl(
    dirPath: string,
    baseDir: string,
    acc: PluginInputs,
    sets: { ignoreDirs: Set<string>; componentLikeDirs: Set<string> },
    appEntryAbsPath: string
): void {
    if (!fs.existsSync(dirPath)) return;

    for (const item of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, item);
        const stat = fs.statSync(full);

        if (stat.isDirectory()) {
            if (isIgnoredDir(item, sets)) continue;
            crawl(full, baseDir, acc, sets, appEntryAbsPath);
            continue;
        }

        if (!EXT_PATTERN.test(item)) continue;

        // Don't include the generated entry itself (prevents self-import)
        if (path.resolve(full) === path.resolve(appEntryAbsPath)) {
            continue;
        }

        const relNoExt = path.relative(baseDir, full).replace(EXT_PATTERN, "");
        const isIndexFile = /(^|[\\/])index$/i.test(relNoExt);

        // Preferred key: collapse ".../index" => "..."
        const preferred = pathToKey(relNoExt, { collapseIndex: true });

        // Explicit key: keep ".../index" => "...index"
        // Example: "foo/index" => "foo.index"
        const explicit = pathToKey(relNoExt, { collapseIndex: false });

        let name = preferred;

        // If preferred collides, ONLY the index file switches to explicit path key.
        const existing = acc[name];
        if (existing && path.resolve(existing) !== path.resolve(full)) {
            if (isIndexFile) {
                // Use foo.index (or deeper.path.index) instead of suffixing __2
                if (!acc[explicit]) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        `⚠️ Key collision for "${preferred}" — using "${explicit}" for index file`,
                        { existing: acc[preferred], incoming: full }
                    );
                    name = explicit;
                } else {
                    // Extremely rare: even explicit collides (e.g. duplicate paths via symlinks)
                    let i = 2;
                    let next = `${explicit}__${i}`;
                    while (acc[next]) {
                        i += 1;
                        next = `${explicit}__${i}`;
                    }
                    // eslint-disable-next-line no-console
                    console.warn(`⚠️ Key collision for "${explicit}" — using "${next}"`, {
                        existing: acc[explicit],
                        incoming: full,
                    });
                    name = next;
                }
            } else {
                // Non-index collision: suffix like original behavior
                let i = 2;
                let next = `${name}__${i}`;
                while (acc[next]) {
                    i += 1;
                    next = `${name}__${i}`;
                }
                // eslint-disable-next-line no-console
                console.warn(`⚠️ Input key collision "${name}" -> using "${next}"`, {
                    existing: acc[name],
                    incoming: full,
                });
                name = next;
            }
        }

        acc[name] = full;
    }
}

/**
 * Discover integration pages/components and return a Rollup input map.
 *
 * @param srcRoot absolute or relative path to the source folder (e.g. "resources/embed/ts")
 * @param options
 * @returns Rollup input map: { [key]: absolutePath }
 */
export function generatePluginInputs(
    srcRoot: string = path.resolve(process.cwd(), "ts"),
    options: GeneratePluginInputsOptions = {}
): PluginInputs {
    const {
        writeAppEntry = true,
        appEntryName = "app.tsx",
        includeAppEntryInInputs = true,
        appEntryKey = "__app_entry",
        verbose = true,
    } = options;

    const absRoot = path.resolve(srcRoot);
    const inputs: PluginInputs = {};

    const sets = makeIgnoreSets(options);
    const appEntryAbsPath = path.join(absRoot, appEntryName);

    // Crawl everything under absRoot (no folder assumptions)
    crawl(absRoot, absRoot, inputs, sets, appEntryAbsPath);

    if (verbose) {
        // eslint-disable-next-line no-console
        console.log("✅ Integrations discovered:", inputs);
    }

    if (writeAppEntry) {
        writeAppEntryFile(inputs, absRoot, appEntryName);
    }

    if (!includeAppEntryInInputs) return inputs;

    return { ...inputs, [appEntryKey]: appEntryAbsPath };
}