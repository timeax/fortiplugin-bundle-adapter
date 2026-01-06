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
};

const DEFAULTS: Required<Pick<FortiPrepTransformOptions, "runtimeKey" | "depsParam">> = {
    runtimeKey: "imports",
    depsParam: "deps",
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

type CapturedImport =
    | { kind: "default"; local: string }
    | { kind: "namespace"; local: string }
    | { kind: "named"; imported: string; local: string };

function getImportedName(spec: t.ImportSpecifier): string {
    return t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
}

function makeImportMapExpr(
    depsIdent: t.Identifier,
    runtimeKey: string
): t.Expression {
    // Support both:
    //   factory({ imports: { ... } })
    // and:
    //   factory({ ... }) // direct import map
    //
    // const __imports =
    //   deps && typeof deps === "object" && "imports" in deps
    //     ? deps.imports
    //     : (deps ?? {});
    const hasKey = t.binaryExpression(
        "in",
        t.stringLiteral(runtimeKey),
        depsIdent
    );

    const isObj = t.logicalExpression(
        "&&",
        t.binaryExpression("!==", depsIdent, t.nullLiteral()),
        t.binaryExpression("===", t.unaryExpression("typeof", depsIdent), t.stringLiteral("object"))
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
    };

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
            ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
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

                // side-effect only imports (import "@host/ui") become no-ops at runtime
                path.remove();
            },

            ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
                const decl = path.node.declaration;

                // export default Foo;
                if (t.isIdentifier(decl)) {
                    defaultExportLocalName = decl.name;
                    path.remove();
                    return;
                }

                // export default (expr/anon fn/class)
                // Hoist into a const (inside wrapper) so we can `return <id>`
                const id = path.scope.generateUidIdentifier("defaultExport");
                path.replaceWith(
                    t.variableDeclaration("const", [t.variableDeclarator(id, decl as any)])
                );
                defaultExportLocalName = id.name;
            },

            ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
                const node = path.node;
                keptNamedExports.push(node);

                // Detect Rollup-style: export { Foo as default }
                if (node.specifiers?.length) {
                    let foundExplicitDefault = false;

                    node.specifiers = node.specifiers.filter((spec) => {
                        const exported =
                            t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value;

                        if (exported === "default") {
                            const local = (spec as any)?.local?.name as string | undefined;
                            if (local) defaultExportLocalName = local;
                            foundExplicitDefault = true;
                            return false; // remove
                        }

                        return true;
                    });

                    // Minified fallback behavior:
                    // If no default specifier found and exactly one spec exists,
                    // treat it as the container and return `<local>.default`.
                    if (!foundExplicitDefault && !defaultExportLocalName && node.specifiers.length === 1) {
                        const only = node.specifiers[0] as any;
                        if (only?.local?.name) {
                            defaultExportLocalName = only.local.name;
                            returnDefaultProperty = true;
                            node.specifiers = [];
                        }
                    }
                }

                path.remove();
            },

            Program: {
                exit(path: NodePath<t.Program>) {
                    const program = path.node;

                    if (!defaultExportLocalName) {
                        throw path.buildCodeFrameError(DEFAULT_EXPORT_ERROR);
                    }

                    const depsIdent = t.identifier(opts.depsParam ?? DEFAULTS.depsParam);
                    const runtimeKey = opts.runtimeKey ?? DEFAULTS.runtimeKey;

                    // const __imports = (deps has runtimeKey) ? deps[runtimeKey] : (deps || {});
                    const importsIdent = t.identifier("__imports");
                    const importsInit = makeImportMapExpr(depsIdent, runtimeKey);
                    const importsDecl = t.variableDeclaration("const", [
                        t.variableDeclarator(importsIdent, importsInit),
                    ]);

                    // helper:
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
                            // const { A, B: C } = (__m_xxx ?? {});
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

                    const returnExpr = returnDefaultProperty
                        ? t.memberExpression(
                            t.identifier(defaultExportLocalName),
                            t.identifier("default")
                        )
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
                        t.functionDeclaration(
                            null,
                            [depsIdent],
                            t.blockStatement(wrapperBody)
                        )
                    );

                    // Final program:
                    //   kept imports at module scope
                    //   export default function(deps) { ... }
                    //   kept named exports (same as your old behavior)
                    program.body = [...keptImports, wrapper, ...keptNamedExports] as any;
                },
            },
        },
    };
}