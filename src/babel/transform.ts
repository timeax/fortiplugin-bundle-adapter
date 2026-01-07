// noinspection JSUnusedGlobalSymbols,GrazieInspection

import type {PluginObj} from "@babel/core";
import * as t from "@babel/types";
import type {NodePath} from "@babel/traverse";

export type FortiPrepTransformOptions = {
    /**
     * Exact import ids to inject (removed from bundle and loaded from runtime deps).
     * Example: ["react", "react/jsx-runtime", "@host/ui"]
     */
    injectedIds?: string[];

    /**
     * Prefix import ids to inject.
     * Example: ["@host/", "@inertiajs/"]
     */
    injectedPrefixes?: string[];

    /**
     * The key on the deps object used as the import map.
     * Wrapper supports passing deps.imports OR passing the import map directly.
     *
     * Default: "imports"
     */
    runtimeKey?: string;

    /**
     * Wrapper function parameter name.
     * Default: "deps"
     */
    depsParam?: string;

    /**
     * What to do if we can't determine a default export to return.
     *
     * - "skip": do nothing (leave file untouched)  ✅ default
     * - "return-null": still wrap, but return null
     * - "throw": fail the build (old behavior)
     */
    onMissingDefault?: "skip" | "return-null" | "throw";
};

const DEFAULTS: Required<
    Pick<FortiPrepTransformOptions, "runtimeKey" | "depsParam" | "onMissingDefault">
> = {
    runtimeKey: "imports",
    depsParam: "deps",
    onMissingDefault: "skip",
};

const DEFAULT_EXPORT_ERROR =
    "PROBLEM!!, No known default function was found, your code either possesses NO named default export or this export format is currently not supported.";

function shouldInject(id: string, opts: FortiPrepTransformOptions): boolean {
    const ids = opts.injectedIds ?? [];
    const prefixes = opts.injectedPrefixes ?? [];
    if (ids.includes(id)) return true;
    for (const p of prefixes) if (id.startsWith(p)) return true;
    return false;
}

function programHasDefaultExport(p: t.Program): boolean {
    for (const stmt of p.body) {
        if (t.isExportDefaultDeclaration(stmt)) return true;

        // Rollup-style: export { Foo as default }
        if (t.isExportNamedDeclaration(stmt) && stmt.specifiers?.length) {
            for (const spec of stmt.specifiers) {
                const exported = t.isIdentifier(spec.exported)
                    ? spec.exported.name
                    : spec.exported.value;
                if (exported === "default") return true;
            }
        }
    }
    return false;
}

type CapturedImport =
    | { kind: "default"; local: string }
    | { kind: "namespace"; local: string }
    | { kind: "named"; imported: string; local: string };

function getImportedName(spec: t.ImportSpecifier): string {
    return t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
}

function makeImportMapExpr(depsIdent: t.Identifier, runtimeKey: string): t.Expression {
    // Support both:
    //   factory({ imports: { ... } })
    // and:
    //   factory({ ... }) // direct import map
    //
    // const __imports =
    //   deps && typeof deps === "object" && "imports" in deps
    //     ? deps.imports
    //     : (deps || {});
    const hasKey = t.binaryExpression("in", t.stringLiteral(runtimeKey), depsIdent);

    const isObj = t.logicalExpression(
        "&&",
        t.binaryExpression("!==", depsIdent, t.nullLiteral()),
        t.binaryExpression(
            "===",
            t.unaryExpression("typeof", depsIdent),
            t.stringLiteral("object")
        )
    );

    const test = t.logicalExpression("&&", isObj, hasKey);

    const depsKey = t.memberExpression(depsIdent, t.identifier(runtimeKey));
    const fallback = t.logicalExpression("||", depsIdent, t.objectExpression([]));

    return t.conditionalExpression(test, depsKey, fallback);
}

/**
 * Babel plugin factory (Babel calls this per-file when used as `[plugin, options]`).
 */
export default function fortiPrepTransform(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _api: unknown,
    rawOpts: FortiPrepTransformOptions = {}
): PluginObj {
    const opts: FortiPrepTransformOptions = {
        ...rawOpts,
        runtimeKey: rawOpts.runtimeKey ?? DEFAULTS.runtimeKey,
        depsParam: rawOpts.depsParam ?? DEFAULTS.depsParam,
        onMissingDefault: rawOpts.onMissingDefault ?? DEFAULTS.onMissingDefault,
    };

    // If false, we do NOTHING to this file (silent ignore).
    let enabled = true;

    // per-file state (because Babel calls the plugin per file)
    const keptImports: t.ImportDeclaration[] = [];
    const keptNamedExports: t.ExportNamedDeclaration[] = [];

    const injectedImportsById = new Map<string, CapturedImport[]>();

    let defaultExportLocalName: string | null = null;
    let returnDefaultProperty = false;

    function captureImport(importId: string, entry: CapturedImport) {
        const list = injectedImportsById.get(importId) ?? [];
        list.push(entry);
        injectedImportsById.set(importId, list);
    }

    return {
        name: "fortiplugin-prep/transform",
        visitor: {
            Program: {
                enter(path: NodePath<t.Program>) {
                    // If there's no default export and behavior is "skip", silently do nothing.
                    const hasDefault = programHasDefaultExport(path.node);
                    if (!hasDefault && (opts.onMissingDefault ?? DEFAULTS.onMissingDefault) === "skip") {
                        enabled = false;
                    }
                },

                exit(path: NodePath<t.Program>) {
                    if (!enabled) return;

                    const program = path.node;

                    // If we still couldn't resolve the default export name, decide behavior.
                    if (!defaultExportLocalName) {
                        const behavior = opts.onMissingDefault ?? DEFAULTS.onMissingDefault;

                        if (behavior === "throw") {
                            throw path.buildCodeFrameError(DEFAULT_EXPORT_ERROR);
                        }

                        // "return-null": wrap but return null.
                        // (Note: "skip" mode should have disabled earlier, but this is a safe fallback.)
                        defaultExportLocalName = null;
                    }

                    const depsIdent = t.identifier(opts.depsParam ?? DEFAULTS.depsParam);
                    const runtimeKey = opts.runtimeKey ?? DEFAULTS.runtimeKey;

                    // const __imports = (deps has runtimeKey) ? deps[runtimeKey] : (deps || {});
                    const importsIdent = t.identifier("__imports");
                    const importsInit = makeImportMapExpr(depsIdent, runtimeKey);
                    const importsDecl = t.variableDeclaration("const", [
                        t.variableDeclarator(importsIdent, importsInit),
                    ]);

                    // const __default = (m) => (m && typeof m === "object" && "default" in m ? m.default : m);
                    const defaultHelperIdent = t.identifier("__default");
                    const defaultHelperDecl = t.variableDeclaration("const", [
                        t.variableDeclarator(
                            defaultHelperIdent,
                            t.arrowFunctionExpression(
                                [t.identifier("m")],
                                t.conditionalExpression(
                                    t.logicalExpression(
                                        "&&",
                                        t.logicalExpression(
                                            "&&",
                                            t.identifier("m"),
                                            t.binaryExpression(
                                                "===",
                                                t.unaryExpression("typeof", t.identifier("m")),
                                                t.stringLiteral("object")
                                            )
                                        ),
                                        t.binaryExpression("in", t.stringLiteral("default"), t.identifier("m"))
                                    ),
                                    t.memberExpression(t.identifier("m"), t.identifier("default")),
                                    t.identifier("m")
                                )
                            )
                        ),
                    ]);

                    // Build injected module locals inside wrapper
                    const injectedStmts: t.Statement[] = [importsDecl, defaultHelperDecl];

                    for (const [importId, specs] of injectedImportsById.entries()) {
                        const modIdent = t.identifier(
                            `__m_${importId.replace(/[^a-zA-Z0-9_$]/g, "_")}`
                        );

                        // const __m_xxx = __imports["<importId>"];
                        injectedStmts.push(
                            t.variableDeclaration("const", [
                                t.variableDeclarator(
                                    modIdent,
                                    t.memberExpression(importsIdent, t.stringLiteral(importId), true)
                                ),
                            ])
                        );

                        const named: Array<{ imported: string; local: string }> = [];

                        for (const s of specs) {
                            if (s.kind === "default") {
                                // const Local = __default(__m_xxx);
                                injectedStmts.push(
                                    t.variableDeclaration("const", [
                                        t.variableDeclarator(
                                            t.identifier(s.local),
                                            t.callExpression(defaultHelperIdent, [modIdent])
                                        ),
                                    ])
                                );
                            } else if (s.kind === "namespace") {
                                // const Local = __m_xxx;
                                injectedStmts.push(
                                    t.variableDeclaration("const", [
                                        t.variableDeclarator(t.identifier(s.local), modIdent),
                                    ])
                                );
                            } else {
                                named.push({imported: s.imported, local: s.local});
                            }
                        }

                        if (named.length) {
                            // const { A, B: C } = (__m_xxx || {});
                            injectedStmts.push(
                                t.variableDeclaration("const", [
                                    t.variableDeclarator(
                                        t.objectPattern(
                                            named.map(({imported, local}) =>
                                                t.objectProperty(
                                                    t.identifier(imported),
                                                    t.identifier(local),
                                                    false,
                                                    imported === local
                                                )
                                            )
                                        ),
                                        t.logicalExpression("||", modIdent, t.objectExpression([]))
                                    ),
                                ])
                            );
                        }
                    }

                    const returnExpr =
                        defaultExportLocalName == null
                            ? t.nullLiteral()
                            : returnDefaultProperty
                                ? t.memberExpression(t.identifier(defaultExportLocalName), t.identifier("default"))
                                : t.identifier(defaultExportLocalName);

                    // Wrapper body:
                    //   injectedStmts...
                    //   <original body>
                    //   return <defaultExport>
                    const wrapperBody: t.Statement[] = [];
                    wrapperBody.push(...injectedStmts);
                    wrapperBody.push(...program.body);
                    wrapperBody.push(t.returnStatement(returnExpr));

                    const wrapper = t.exportDefaultDeclaration(
                        t.functionDeclaration(null, [depsIdent], t.blockStatement(wrapperBody))
                    );

                    // Final program:
                    //   kept imports at module scope
                    //   export default function(deps) { ... }
                    //   kept named exports (same as your old behavior)
                    program.body = [...keptImports, wrapper, ...keptNamedExports] as any;
                },
            },

            ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
                if (!enabled) return;

                const node = path.node;
                const importId = node.source.value;

                if (!shouldInject(importId, opts)) {
                    keptImports.push(node);
                    path.remove();
                    return;
                }

                // Remove injected import and capture its specifiers to recreate inside wrapper.
                for (const s of node.specifiers) {
                    if (t.isImportDefaultSpecifier(s)) {
                        captureImport(importId, {kind: "default", local: s.local.name});
                    } else if (t.isImportNamespaceSpecifier(s)) {
                        captureImport(importId, {kind: "namespace", local: s.local.name});
                    } else if (t.isImportSpecifier(s)) {
                        captureImport(importId, {
                            kind: "named",
                            imported: getImportedName(s),
                            local: s.local.name,
                        });
                    }
                }

                // side-effect-only injected imports (import "@host/ui") become no-ops at runtime
                path.remove();
            },

            ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
                if (!enabled) return;

                const decl = path.node.declaration;

                // export default Foo;
                if (t.isIdentifier(decl)) {
                    defaultExportLocalName = decl.name;
                    path.remove();
                    return;
                }

                // export default function (...) {}
                // export default class {...}
                // Keep as declaration (valid) and remember its id.
                if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) {
                    if (!decl.id) {
                        decl.id = path.scope.generateUidIdentifier("defaultExport");
                    }
                    defaultExportLocalName = decl.id.name;
                    path.replaceWith(decl);
                    return;
                }

                // export default (expr/arrow/etc)
                const id = path.scope.generateUidIdentifier("defaultExport");
                path.replaceWith(
                    t.variableDeclaration("const", [
                        t.variableDeclarator(id, decl as t.Expression),
                    ])
                );
                defaultExportLocalName = id.name;
            },

            ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
                if (!enabled) return;

                const node = path.node;

                // Detect Rollup-style: export { Foo as default }
                if (node.specifiers?.length) {
                    let foundExplicitDefault = false;

                    node.specifiers = node.specifiers.filter((spec) => {
                        const exported = t.isIdentifier(spec.exported)
                            ? spec.exported.name
                            : spec.exported.value;

                        if (exported === "default") {
                            const local = (spec as any)?.local?.name as string | undefined;
                            if (local) defaultExportLocalName = local;
                            foundExplicitDefault = true;
                            return false; // remove the default specifier
                        }

                        return true;
                    });

                    // Minified fallback behavior:
                    // If no default specifier found and exactly one spec exists,
                    // treat it as the container and return `<local>.default`.
                    if (
                        !foundExplicitDefault &&
                        !defaultExportLocalName &&
                        node.specifiers.length === 1
                    ) {
                        const only = node.specifiers[0] as any;
                        if (only?.local?.name) {
                            defaultExportLocalName = only.local.name;
                            returnDefaultProperty = true;
                            node.specifiers = [];
                        }
                    }
                }

                // Keep named exports after wrapper (same as prior behavior),
                // BUT do not keep empty export declarations.
                if (node.declaration || (node.specifiers && node.specifiers.length > 0)) {
                    keptNamedExports.push(node);
                }

                path.remove();
            },
        },
    };
}