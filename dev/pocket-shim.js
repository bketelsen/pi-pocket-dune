// A stand-in for Pi Pocket's browser API, enough to run the page here. The server is absent: `world` answers an
// empty desert, so the page starts its demo. Not shipped.
import { h, render, Fragment } from "preact";
import * as hooks from "preact/hooks";
import htm from "htm";

const pages = new Map();
const pocket = {
    version: 2,
    pocketVersion: "preview",
    module: "dune",
    title: "Arrakis",
    h,
    html: htm.bind(h),
    Fragment,
    ...hooks,
    me: () => ({ id: "owner", name: "Brian", role: "owner" }),
    conversationId: () => null,
    openConversation: (id) => console.log("open", id),
    api: async (path) => {
        if (path === "world") {
            return {
                boot: "preview",
                batch: 0,
                now: Date.now(),
                convs: {},
                res: {},
                humans: {},
                events: [],
                unknown: [],
            };
        }

        throw Object.assign(new Error("no server"), { status: 404 });
    },
    on: () => () => {},
    notify: (level, message) => console.log(level, message),
    rail: () => ({ update() {}, remove() {} }),
    launcher: () => ({ update() {}, remove() {} }),
    page: (spec) => {
        pages.set(spec.id, spec);

        return { update() {}, remove() {} };
    },
    style: (path) => {
        const link = document.createElement("link");

        link.rel = "stylesheet";
        link.href = `../dune/${path}`;
        document.head.append(link);
    },
    onDispose: () => {},
};

// For scripted screenshots: the live world, on `window.__dune`.
const { World } = await import("../dune/world.js");
const start = World.prototype.start;

World.prototype.start = function () {
    window.__dune = this;

    return start.call(this);
};

const module = await import("../dune/index.js");

module.default(pocket);

const spec = pages.get("dune");

render(h(spec.component, { pocket, close() {} }), document.getElementById("page"));
