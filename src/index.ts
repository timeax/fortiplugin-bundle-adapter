// src/index.ts
export { default } from "./vite/prep";
export type { FortiPrepOptions } from "./vite/prep";
export type { FortiPrepTransformOptions } from "./babel/transform";

// ✅ add this:
export { default as fortiPrepTransform } from "./babel/transform";