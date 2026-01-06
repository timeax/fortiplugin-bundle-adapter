// src/runtime/create-factory.ts
// noinspection GrazieInspection

import type * as ReactNS from "react";
import type * as JsxRuntimeNS from "react/jsx-runtime";

export type ReactLike = typeof ReactNS;
export type JsxRuntimeLike = typeof JsxRuntimeNS;

export type ImportMap = Record<string, any>;

export type CreateFactoryEnv = {
    react: ReactLike;
    jsxRuntime: JsxRuntimeLike;

    /**
     * Optional injected modules (merged into the import map).
     * Example: { "@inertiajs/core": InertiaCore, "@host/ui": HostUI }
     */
    imports?: ImportMap;

    /**
     * Optional mapping of virtual IDs to CORS-safe ESM URLs for local dev.
     * These URLs will be dynamically imported and added into the import map.
     */
    hostUrls?: Record<string, string>;

    /**
     * Optional base props coming from the host runtime / plugin caller.
     * These props are **PRIORITY** and override any props passed to `render()`.
     */
    hostProps?: Record<string, any>;

    /**
     * Extra arbitrary values the host wants to pass into the factory deps object.
     */
    depsExtra?: Record<string, any>;
};

export type CreateFactoryOptions = {
    exportName?: string; // default: "default"
    mode?: "auto" | "factory" | "component"; // default: "auto"
    unwrapReturnedDefault?: boolean; // default: true
    runtimeKey?: string; // default: "imports"
    tagKey?: string; // default: "__forti_prep_factory__"
    hostUrlsOverride?: boolean; // default: false
};

function isObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === "object";
}

function isCallable(v: unknown): v is (...args: any[]) => any {
    return typeof v === "function";
}

const REACT_ELEMENT_SYMBOLS = new Set<symbol>([
    Symbol.for("react.element"),
    Symbol.for("react.transitional.element"),
]);

function isReactElement(v: unknown): boolean {
    if (!isObject(v)) return false;
    const x = (v as any).$$typeof;
    return typeof x === "symbol" && REACT_ELEMENT_SYMBOLS.has(x);
}

function unwrapNamespaceDefault(mod: any): any {
    if (!mod) return mod;
    if (isObject(mod) && "default" in mod) return mod.default;
    return mod;
}

function pickExport(mod: any, exportName: string): any {
    if (!mod) return undefined;

    if (isObject(mod) && exportName in mod) return mod[exportName];

    if (exportName === "default") return unwrapNamespaceDefault(mod);

    return undefined;
}

function looksTaggedFactory(fn: Function, tagKey: string): boolean {
    return (fn as any)?.[tagKey] === true;
}

async function maybeImportUrl(url: string): Promise<any> {
    // IMPORTANT: url is runtime-dynamic → Vite must not pre-bundle it
    return import(/* @vite-ignore */ url);
}

export type PreparedRenderFactory<P = any> = ((props?: Partial<P>) => any) & {
    component: any;
    module: any;
    exportName: string;
    wasFactory: boolean;
    file: string;

    /**
     * The final import map passed into the factory deps.
     */
    imports: ImportMap;

    /**
     * Host/base props attached to the renderer (priority).
     */
    hostProps: Record<string, any>;
};

/**
 * Import `file` NOW, resolve the component export (default or named),
 * then return a render factory you can call later with component props.
 */
export async function createFactory<P = any>(
    file: string,
    env: CreateFactoryEnv,
    opts: CreateFactoryOptions = {},
    hostPropsOverride?: Partial<P>
): Promise<PreparedRenderFactory<P>> {
    const exportName = opts.exportName ?? "default";
    const mode = opts.mode ?? "auto";
    const unwrapReturnedDefault = opts.unwrapReturnedDefault ?? true;
    const runtimeKey = opts.runtimeKey ?? "imports";
    const tagKey = opts.tagKey ?? "__forti_prep_factory__";
    const hostUrlsOverride = opts.hostUrlsOverride ?? false;

    // 1) Import the plugin module/bundle
    const mod = (await import(/* @vite-ignore */ file)) as any;

    const picked = pickExport(mod, exportName);
    if (picked == null) {
        const keys = isObject(mod) ? Object.keys(mod) : [];
        throw new Error(
            `[fortiplugin-bundle-adapter] Export "${exportName}" not found in "${file}". ` +
            `Available keys: ${keys.length ? keys.join(", ") : "(none)"}`
        );
    }

    // 2) Build import map for the adapted wrapper
    const imports: ImportMap = {
        react: env.react,
        "react/jsx-runtime": env.jsxRuntime,
        ...(env.imports ?? {}),
    };

    // 3) Dev-mode host bundles by URL (CORS-safe ESM)
    if (env.hostUrls) {
        for (const [id, url] of Object.entries(env.hostUrls)) {
            const already = Object.prototype.hasOwnProperty.call(imports, id);
            if (already && !hostUrlsOverride) continue;

            try {
                imports[id] = await maybeImportUrl(url);
            } catch (err: any) {
                const msg = err?.message ? String(err.message) : String(err);
                throw new Error(
                    `[fortiplugin-bundle-adapter] Failed to import host URL for "${id}".\n` +
                    `URL: ${url}\n` +
                    `Error: ${msg}`
                );
            }
        }
    }

    // 4) deps object for adapted wrapper (we always pass explicit object)
    const deps = {
        [runtimeKey]: imports,
        ...(env.depsExtra ?? {}),
    };

    let component: any = picked;
    let wasFactory = false;

    // 5) Resolve factory → component (only if needed)
    if (mode !== "component" && isCallable(picked)) {
        const fn = picked as (deps: any) => any;

        const shouldTryCall =
            mode === "factory" || looksTaggedFactory(fn, tagKey) || mode === "auto";

        if (shouldTryCall) {
            let resolved: any;

            try {
                resolved = fn(deps);
                if (resolved && typeof (resolved as any).then === "function") {
                    resolved = await resolved;
                }
            } catch (err) {
                if (mode === "factory") throw err;
                resolved = undefined; // rollback in auto
            }

            if (unwrapReturnedDefault && isObject(resolved) && "default" in resolved) {
                resolved = (resolved as any).default;
            }

            const looksLikeWeCalledAComponent =
                isReactElement(resolved) || resolved == null;

            if (!looksLikeWeCalledAComponent) {
                component = resolved;
                wasFactory = true;
            } else if (mode === "factory") {
                throw new Error(
                    `[fortiplugin-bundle-adapter] Factory call did not return a component export for "${file}". ` +
                    `Got: ${resolved == null ? String(resolved) : "ReactElement"}`
                );
            }
            // auto mode rollback => treat picked as component
        }
    }

    // 6) Host props are PRIORITY (override render() props)
    const hostProps: Record<string, any> = {
        ...(env.hostProps ?? {}),
        ...(hostPropsOverride ?? {}),
    };

    // 7) Render function merges:
    //    renderProps (defaults) + hostProps (priority)
    const render = ((renderProps?: Partial<P>) => {
        const mergedProps = {...(renderProps ?? {}), ...hostProps} as any;

        if (isReactElement(component)) {
            // If component is already an element, attach merged props via cloneElement
            const clone = (env.react as any).cloneElement;
            return typeof clone === "function" ? clone(component, mergedProps) : component;
        }

        return (env.react as any).createElement(component, mergedProps);
    }) as PreparedRenderFactory<P>;

    render.component = component;
    render.module = mod;
    render.exportName = exportName;
    render.wasFactory = wasFactory;
    render.file = file;
    render.imports = imports;
    render.hostProps = hostProps;

    return render;
}