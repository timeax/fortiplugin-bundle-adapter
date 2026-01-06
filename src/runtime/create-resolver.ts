// src/runtime/create-resolver.ts

import type {
    CreateFactoryEnv,
    CreateFactoryOptions,
    PreparedRenderFactory,
} from "./create-factory";
import {createFactory} from "./create-factory";

export type CreateResolverConfig = {
    env: CreateFactoryEnv;
    options?: CreateFactoryOptions;

    /**
     * Base host props (priority) that should always be applied.
     * These override any props passed to render().
     */
    hostProps?: Record<string, any>;
};

export type ResolveOverrides = {
    env?: Partial<CreateFactoryEnv>;
    options?: Partial<CreateFactoryOptions>;
    hostProps?: Record<string, any>;
};

function mergeRecord(a?: Record<string, any>, b?: Record<string, any>) {
    return {...(a ?? {}), ...(b ?? {})};
}

function mergeEnv(base: CreateFactoryEnv, patch?: Partial<CreateFactoryEnv>): CreateFactoryEnv {
    if (!patch) return base;

    return {
        ...base,
        ...patch,
        // deep-merge the maps
        imports: mergeRecord(base.imports, patch.imports),
        hostUrls: mergeRecord(base.hostUrls, patch.hostUrls),
        depsExtra: mergeRecord(base.depsExtra, patch.depsExtra),
        // hostProps handled separately by resolver (priority props contract)
        hostProps: base.hostProps,
    };
}

function mergeOptions(
    base?: CreateFactoryOptions,
    patch?: Partial<CreateFactoryOptions>
): CreateFactoryOptions {
    return {...(base ?? {}), ...(patch ?? {})};
}

export type PluginResolver = {
    /**
     * Resolve a plugin entry (file URL/path) into a callable renderer.
     * You can pass per-call overrides (e.g. inertia imports).
     */
    resolve<P = any>(file: string, overrides?: ResolveOverrides): Promise<PreparedRenderFactory<P>>;

    /**
     * Create a new resolver inheriting this resolver, with extra defaults.
     * Great for adding inertia / host UI / dev URLs once, then reusing everywhere.
     */
    with(overrides: ResolveOverrides): PluginResolver;

    /**
     * A React component already bound to this resolver.
     * Only needs `file` and props.
     */
    Embed: <P extends Record<string, any> = Record<string, any>>(
        props: EmbedProps<P>
    ) => any;

    /**
     * Expose effective defaults (handy for debugging).
     */
    defaults: Required<CreateResolverConfig>;
};

export type EmbedProps<P extends Record<string, any> = Record<string, any>> = {
    file: string;

    /**
     * Default props (non-priority).
     * Host props override these.
     */
    props?: Partial<P>;

    /**
     * Per-embed host props (priority).
     * These override `props`.
     */
    hostProps?: Partial<P>;

    /**
     * Per-embed resolver overrides (env/options/hostProps).
     * Useful when a specific plugin needs inertia, etc.
     */
    overrides?: ResolveOverrides;

    fallback?: any;
    onErrorRender?: (error: unknown) => any;

    onResolved?: (info: {
        file: string;
        exportName: string;
        wasFactory: boolean;
        component: any;
        module: any;
    }) => void;
};

export function createPluginResolver(config: CreateResolverConfig): PluginResolver {
    const defaults: Required<CreateResolverConfig> = {
        env: config.env,
        options: config.options ?? {},
        hostProps: config.hostProps ?? {},
    };

    const R = defaults.env.react as any;

    async function resolve<P = any>(file: string, overrides?: ResolveOverrides) {
        const env = mergeEnv(defaults.env, overrides?.env);
        const options = mergeOptions(defaults.options, overrides?.options);

        // Priority host props contract:
        // - base resolver hostProps always apply
        // - per-call overrides hostProps can add/override base hostProps
        const hostProps = mergeRecord(defaults.hostProps, overrides?.hostProps);

        // @ts-ignore
        return createFactory<P>(file, env, options, hostProps);
    }

    function withOverrides(overrides: ResolveOverrides): PluginResolver {
        return createPluginResolver({
            env: mergeEnv(defaults.env, overrides.env),
            options: mergeOptions(defaults.options, overrides.options),
            hostProps: mergeRecord(defaults.hostProps, overrides.hostProps),
        });
    }

    function Embed<P extends Record<string, any> = Record<string, any>>(p: EmbedProps<P>) {
        const {file, props, hostProps, overrides, fallback = null, onErrorRender, onResolved} = p;

        const [renderFn, setRenderFn] = R.useState(null as null | ((pp?: Partial<P>) => any));
        const [error, setError] = R.useState(null as unknown);

        // keep latest values without constantly re-resolving
        const latest = R.useRef({props, hostProps, overrides, onResolved});
        latest.current = {props, hostProps, overrides, onResolved};

        R.useEffect(() => {
            let cancelled = false;
            setRenderFn(null);
            setError(null);

            (async () => {
                try {
                    // merge per-embed priority hostProps into per-call overrides
                    const mergedOverrides: ResolveOverrides = {
                        ...(latest.current.overrides ?? {}),
                        hostProps: mergeRecord(
                            (latest.current.overrides?.hostProps ?? {}),
                            (latest.current.hostProps as any) ?? {}
                        ),
                    };

                    const prepared = await resolve<P>(file, mergedOverrides);

                    if (cancelled) return;

                    setRenderFn(() => prepared);

                    latest.current.onResolved?.({
                        file: prepared.file,
                        exportName: prepared.exportName,
                        wasFactory: prepared.wasFactory,
                        component: prepared.component,
                        module: prepared.module,
                    });
                } catch (e) {
                    if (cancelled) return;
                    setError(e);
                }
            })();

            return () => {
                cancelled = true;
            };
        }, [file]);

        if (error) {
            if (onErrorRender) return onErrorRender(error);
            const msg = String((error as any)?.stack ?? (error as any)?.message ?? error);
            return R.createElement("pre", {style: {whiteSpace: "pre-wrap"}}, msg);
        }

        if (!renderFn) return fallback;

        // NOTE: createFactory() already merges render props + host props (host wins)
        return renderFn(latest.current.props);
    }

    return {
        resolve,
        with: withOverrides,
        Embed,
        defaults,
    };
}