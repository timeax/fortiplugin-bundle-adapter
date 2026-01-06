# FortiPlugin Bundle Adapter

A **build-time bundle adapter** for the FortiPlugin system.

It transforms your plugin’s compiled entry chunk(s) into a **runtime factory** that receives host-provided dependencies (React, JSX runtime, Inertia, and host UI bundles like `@host/ui`).

This lets the host:

* enforce **one React/Inertia instance** across all plugins
* inject host components (`@host/ui`, `@host/icons`, etc.)
* avoid bundling/duplicating framework libs inside plugins
* keep plugin bundles **portable** and **sandbox-friendly**

---

## What it outputs

Your plugin entry ends up like this (conceptually):

```ts
export default function factory(deps) {
    // deps.imports["react"], deps.imports["@host/ui"], ...
    // plugin module code (rewritten)
    return DefaultExport;
}
```

The host loads the bundle and calls the factory with the dependency map.

---

## Installation

```bash
npm i -D fortiplugin-bundle-adapter
# or
pnpm add -D fortiplugin-bundle-adapter
# or
yarn add -D fortiplugin-bundle-adapter
```

---

## Usage (Vite)

In your plugin project:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import fortiPrep from "fortiplugin-bundle-adapter";

export default defineConfig({
  plugins: [
    fortiPrep({
      injectedIds: ["react", "react/jsx-runtime"],
      injectedPrefixes: ["@inertiajs/", "@host/"],
      runtimeKey: "imports",
      depsParam: "deps",
    }),
  ],
});
```

### Why Rollup external matters

This adapter marks injected imports as **external** so that:

* your build doesn’t try to resolve `@host/ui` locally
* those imports survive long enough for the transform to detect/remove them

---

## Runtime contract (host side)

### 1) Plugins import from “virtual host modules”

Plugin code can import from host-defined IDs (examples):

```ts
import React, { useMemo } from "react";
import { jsx, Fragment } from "react/jsx-runtime";

import { router } from "@inertiajs/core";

import HostUI, { Button } from "@host/ui";
import * as Icons from "@host/icons";
```

### 2) Host injects the exports map

The host must provide the module exports for every injected import ID.

```ts
import React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as InertiaCore from "@inertiajs/core";

import * as HostUI from "./host-ui";
import * as HostIcons from "./host-icons";

const imports = {
  "react": React,
  "react/jsx-runtime": JsxRuntime,
  "@inertiajs/core": InertiaCore,
  "@host/ui": HostUI,
  "@host/icons": HostIcons,
};

// pluginModule is the loaded plugin bundle (ESM/CJS)
const factory = pluginModule.default;
const pluginDefaultExport = factory({ imports });
```

### Default export interop

The adapter normalizes default imports so both of these work:

* ESM namespace objects (`{ default, named... }`)
* CommonJS-like values (no `.default`)

Meaning: if a plugin writes `import HostUI from "@host/ui"`, the host may inject either:

* `{ default: { ... } }` or
* `{ ... }` directly

and the plugin still gets the “default” value.

---

## Runtime helpers (createFactory + resolver)

Calling `factory({ imports })` directly works, but FortiPlugin hosts usually want a reusable runtime utility that:

* imports the plugin entry by URL/path
* resolves the correct export (`default` or named)
* detects whether the export is a **prep factory** or a **component**
* injects host dependencies (`react`, `react/jsx-runtime`, optional `@host/*`, optional `@inertiajs/*`)
* merges props correctly (**host props win**)

This package provides two runtime helpers for that.

### `createFactory(file, env, opts?, hostProps?)`

`createFactory()` dynamically imports the `file` and returns a callable renderer:

* `render(props)` → returns a React element
* `props` passed to `render()` are **defaults**
* `hostProps` are **priority** (override collisions)

```ts
import React from "react";
import * as JsxRuntime from "react/jsx-runtime";

import { createFactory } from "fortiplugin-bundle-adapter/runtime/create-factory";

const render = await createFactory(
  "/build/plugins/foo.entry.mjs",
  {
    react: React,
    jsxRuntime: JsxRuntime,

    // optional: already-available host modules
    imports: {
      // "@host/ui": HostUI,
      // "@inertiajs/core": InertiaCore,
    },

    // optional: dev-mode host bundles by CORS-safe URL
    hostUrls: {
      // "@host/ui": "https://host.example.com/forti/dev/exports/ui.mjs",
    },
  },
  {
    exportName: "default",
    mode: "auto",
  },
  {
    accountId: 123, // PRIORITY host props
  }
);

// render() props are defaults; host props override collisions
const element = render({ title: "Dashboard" });
```

### `createPluginResolver({ env, options, hostProps })`

In real hosts, you don’t want to pass `env` everywhere. Instead, create a resolver once and reuse it.

A resolver bundles your defaults (React/JSX runtime, import map, dev URLs, base host props) and exposes:

* `resolver.resolve(file, overrides?)` → returns a prepared renderer (same shape as `createFactory`)
* `resolver.with(overrides)` → creates a new resolver layered on top (great for “with inertia”, “with ui”, etc.)
* `resolver.Embed` → a React component bound to the resolver (you only pass `file` + props)

```ts
import React from "react";
import * as JsxRuntime from "react/jsx-runtime";

import { createPluginResolver } from "fortiplugin-bundle-adapter/runtime/create-resolver";

export const resolvePlugin = createPluginResolver({
  env: {
    react: React,
    jsxRuntime: JsxRuntime,
  },

  // base PRIORITY props applied to every plugin render
  hostProps: {
    // accountId, permissions, pluginMeta, etc.
  },
});
```

#### Add optional deps once (Inertia / Host UI)

```ts
import * as InertiaCore from "@inertiajs/core";
import * as HostUI from "./host-ui";

export const resolvePluginWithInertia = resolvePlugin.with({
  env: {
    imports: {
      "@inertiajs/core": InertiaCore,
    },
  },
});

export const resolvePluginWithUI = resolvePluginWithInertia.with({
  env: {
    imports: {
      "@host/ui": HostUI,
    },
  },
});
```

#### Dev-mode: load host bundles by URL

```ts
export const resolvePluginDev = resolvePlugin.with({
  env: {
    hostUrls: {
      "@host/ui": "https://host.example.com/forti/dev/exports/ui.mjs",
    },
  },
});
```

#### Use the resolver everywhere

```ts
const render = await resolvePluginWithUI.resolve("/build/plugins/foo.entry.mjs", {
  hostProps: { accountId: 123 }, // per-call PRIORITY props
});

// defaults + host override
const element = render({ title: "Dashboard" });
```

#### Use the bound React component

```tsx
const Embed = resolvePluginWithUI.Embed;

<Embed
  file="/build/plugins/foo.entry.mjs"
  props={{ title: "Dashboard" }}
  hostProps={{ accountId: 123 }}
  fallback={<div>Loading…</div>}
/>;
```

---

## Configuration

### `injectedIds?: string[]`

Exact import IDs to inject.

Example:

```ts
injectedIds: ["react", "react/jsx-runtime", "@host/ui"]
```

### `injectedPrefixes?: string[]`

Prefixes to inject.

Example:

```ts
injectedPrefixes: ["@inertiajs/", "@host/"]
```

### `runtimeKey?: string` (default: `"imports"`)

Where the import map is stored.

The wrapper accepts either:

* `factory({ imports: map })` (recommended)
* `factory(map)` (shortcut)

If you set `runtimeKey: "bundle"`, then the recommended call becomes:

```ts
factory({ bundle: imports })
```

### `depsParam?: string` (default: `"deps"`)

The wrapper function param name.

---

## Host UI bundles (`@host/*`)

This adapter enables a clean pattern:

1. Host defines a virtual module like `@host/ui`
2. Host exports UI components from a real file
3. Host injects it into `imports["@host/ui"]`

### Example host UI module

```ts
// host-ui.ts
export { Button } from "./ui/Button";
export { Modal } from "./ui/Modal";
export { Badge } from "./ui/Badge";
```

Then inject:

```ts
import * as HostUI from "./host-ui";

factory({
  imports: {
    "@host/ui": HostUI,
    "react": React,
    "react/jsx-runtime": JsxRuntime,
  },
});
```

---

## Local development with host bundles (CORS-safe URLs)

When you import from virtual host modules like `@host/ui`, your plugin can compile fine (because the adapter treats them as external), but **during development** you still need a way to *actually render/test* those host components.

The recommended approach is:

* The **host** publishes read-only **ESM bundle URLs** for the modules it wants plugins to use (UI, icons, theme, inertia helpers, etc.).
* The host config/manifest provides a mapping from virtual IDs to URLs.
* The plugin developer’s local dev harness dynamically imports those URLs and passes them into the plugin factory as `imports`.

### 1) Host provides a “dev exports map”

Example (shape only — you can store this wherever FortiPlugin keeps policy/handshake data):

```json
{
  "@host/ui": "https://host.example.com/forti/dev/exports/ui.mjs",
  "@host/icons": "https://host.example.com/forti/dev/exports/icons.mjs",
  "@host/inertia": "https://host.example.com/forti/dev/exports/inertia.mjs"
}
```

### 2) Host serves those bundles with permissive CORS

At minimum, the host should allow cross-origin **GET** requests for these assets.

Recommended response headers for the dev export endpoints:

* `Content-Type: text/javascript; charset=utf-8`
* `Access-Control-Allow-Origin: *`
* `Access-Control-Allow-Methods: GET`

Notes:

* Keep these endpoints **read-only**.
* Export only the public plugin-facing surface (avoid internal auth/config).
* Ideally enable this in **dev/staging** environments only.

### 3) Plugin dev harness loads host bundles by URL

The cleanest dev experience is to keep plugin source code unchanged:

```ts
import { Button } from "@host/ui";
```

…and load the real host module at runtime in your dev harness:

```ts
// dev-harness.ts (runs in the browser or a dev page)
import React from "react";
import * as JsxRuntime from "react/jsx-runtime";

// pluginModule is your built/served plugin entry bundle
import pluginModule from "/path/to/plugin-entry.mjs";

const hostExports = {
  "@host/ui": "https://host.example.com/forti/dev/exports/ui.mjs",
  "@host/icons": "https://host.example.com/forti/dev/exports/icons.mjs",
};

async function loadImportMap() {
  const imports = {
    "react": React,
    "react/jsx-runtime": JsxRuntime,
  };

  for (const [id, url] of Object.entries(hostExports)) {
    // Vite note: @vite-ignore prevents Vite from trying to pre-bundle the URL
    const mod = await import(/* @vite-ignore */ url);
    imports[id] = mod;
  }

  return imports;
}

const factory = pluginModule.default;
const pluginDefaultExport = factory({ imports: await loadImportMap() });
```

This gives plugin developers real host components during testing without needing those modules locally.

### 4) Optional: make local imports resolve to URLs (advanced)

If you want `@host/ui` to resolve in the browser *as a URL module* during dev, you can add a small Vite dev-only resolver plugin that rewrites `@host/*` imports to the host URLs. This is optional; the harness approach above is simpler and avoids bundler edge cases.

---

## Testing (transform-only)

If you want to test the Babel transform without Vite:

```txt
tests/
  fixture-input.js
  run-transform.mjs
```

### Export the transform (recommended)

Expose the transform from your package entry so tests can import it from `dist/index.mjs`:

```ts
// src/index.ts
export { default } from "./vite/prep";
export { default as fortiPrepTransform } from "./babel/transform";
```

### `tests/run-transform.mjs`

```js
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "@babel/core";

import { fortiPrepTransform } from "../dist/index.mjs";

const inputFile = resolve(process.cwd(), process.argv[2] ?? "tests/fixture-input.js");
const outFile = resolve(process.cwd(), process.argv[3] ?? "tests/fixture-output.js");

const input = readFileSync(inputFile, "utf-8");

const result = transformSync(input, {
    filename: inputFile,
    sourceType: "module",
    plugins: [
        [
            fortiPrepTransform,
            {
                injectedIds: ["react", "react/jsx-runtime"],
                injectedPrefixes: ["@inertiajs/", "@host/"],
                runtimeKey: "imports",
                depsParam: "deps",
            },
        ],
    ],
    generatorOpts: {
        compact: false,
        comments: true,
        retainLines: false,
    },
});

if (!result?.code) throw new Error("No output produced");
writeFileSync(outFile, result.code, "utf-8");
console.log("✅ wrote", outFile);
```

Run:

```bash
node tests/run-transform.mjs
```

---

## Limitations / gotchas

### 1) Named exports are preserved as-is

The current behavior keeps `export const x = ...` / `export { x }` statements and appends them after the wrapper.

If those exports reference symbols that were moved into the wrapper scope, they can break.

**Recommended convention:** plugin entry files should primarily export **default**.

If you want stricter enforcement (“default export only”), you can add it.

### 2) Dynamic imports are not rewritten

`import("@host/ui")` is not handled.

If you need this, add a pass for `Import()` expressions.

### 3) Side-effect-only injected imports

`import "@host/ui";` becomes a no-op. Model side effects as explicit exports instead.

---

## FAQ

### Why not bundle React inside each plugin?

Because the host needs a single, controlled instance for consistency, security policy, and to avoid multiple React copies.

### Do I need to install `@host/ui` in plugin projects?

No. It’s treated as external and injected at runtime.

### Can I inject other libraries too?

Yes. Add them to `injectedIds` or `injectedPrefixes`, and inject them in the host `imports` map.

---

## License

MIT (or your chosen license)
