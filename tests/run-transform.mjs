// tests/run-transform.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "@babel/core";

// ✅ tsup outputs dist/index.mjs (ESM)
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

if (!result?.code) {
    console.error("No output code returned by Babel.");
    process.exit(1);
}

writeFileSync(outFile, result.code, "utf-8");
console.log("✅ Transform complete:", outFile);