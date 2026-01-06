// tests/fixture-input.js

// should stay as a real module import (not injected)
import localThing from "./local-thing.js";
export default function (deps) {
  const __imports = deps !== null && typeof deps === "object" && "imports" in deps ? deps.imports : deps || {};
  const __default = m => m && typeof m === "object" && "default" in m ? m.default : m;
  const __m_react = __imports["react"];
  const React = __default(__m_react);
  const {
    useMemo
  } = __m_react || {};
  const __m_react_jsx_runtime = __imports["react/jsx-runtime"];
  const {
    jsx,
    jsxs,
    Fragment
  } = __m_react_jsx_runtime || {};
  const __m__inertiajs_core = __imports["@inertiajs/core"];
  const {
    router
  } = __m__inertiajs_core || {};
  const __m__host_ui = __imports["@host/ui"];
  const HostUI = __default(__m__host_ui);
  const {
    Button,
    Modal: HostModal
  } = __m__host_ui || {};
  const __m__host_icons = __imports["@host/icons"];
  const Icons = __m__host_icons;
  function Card({
    title
  }) {
    const memo = useMemo(() => title.toUpperCase(), [title]);
    return jsxs(Fragment, {
      children: [jsx("h3", {
        children: memo
      }), jsx(Button, {
        children: "OK"
      }), jsx(HostModal, {
        open: false
      }), jsx(HostUI.Badge, {
        children: "badge"
      }), jsx(Icons.Check, {}), jsx("div", {
        children: localThing
      })]
    });
  }

  // keep a normal named export too
  return Card;
}
export const meaning = 42;
export {};
export { Card };