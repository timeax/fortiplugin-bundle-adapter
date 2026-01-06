// tests/fixture-input.js

import React, { useMemo } from "react";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";

import { router } from "@inertiajs/core";

import HostUI, { Button, Modal as HostModal } from "@host/ui";
import * as Icons from "@host/icons";

// should stay as a real module import (not injected)
import localThing from "./local-thing.js";

function Card({ title }) {
    const memo = useMemo(() => title.toUpperCase(), [title]);

    return jsxs(Fragment, {
        children: [
            jsx("h3", { children: memo }),
            jsx(Button, { children: "OK" }),
            jsx(HostModal, { open: false }),
            jsx(HostUI.Badge, { children: "badge" }),
            jsx(Icons.Check, {}),
            jsx("div", { children: localThing }),
        ],
    });
}

export const meaning = 42;

export { Card as default };

// keep a normal named export too
export { Card };