// A stand-in for Pi Pocket's browser API, enough to run the page here. The server is absent: `world` answers an
// empty desert, so the page starts its demo. Not shipped.
import { h, render, Fragment } from "preact";
import * as hooks from "preact/hooks";
import htm from "htm";

const pages = new Map();

// ——— a generated night, for the preview ———

/** The tools of the night's work, with the place each one ran. */
const NIGHT_TOOLS = [
    { n: "read", s: "files", item: (n) => `dune/module${n}.js` },
    { n: "edit", s: "files", item: (n) => `dune/module${n}.js`, w: 1 },
    { n: "write", s: "files", item: (n) => `test/module${n}.test.ts`, w: 1 },
    {
        n: "bash",
        s: "shell",
        item: (n) => ["npm test", "npm run check", "git status", "just build"][n % 4],
    },
    { n: "git", s: "github", item: (n) => `gh pr view ${100 + n}` },
    { n: "web_fetch", s: "web", item: (n) => `https://example.org/page${n}` },
    { n: "memory", s: "memory", item: (n) => `lesson ${n}` },
];
const NIGHT_NAMES = [
    "Odrade",
    "Miles Teg",
    "Duncan Idaho",
    "Sheeana",
    "Bellonda",
    "Murbella",
    "Lucilla",
    "Siona",
    "Taraza",
    "Waff",
    "Hayt",
    "Alia",
];
const NIGHT_WORD = { shell: "ran", github: "checked", web: "fetched", memory: "recalled" };

/**
 * A night of history, in the server's shape: 30 sessions (a few linked, a few subagents) with about 3000 tool and
 * done pairs, 60 messages, 20 links and an idle after every round of work, spread between `from` and `to`.
 */
function nightHistory(from, to) {
    let seed = 20261031;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;

        return seed / 4294967296;
    };
    const pick = (list) => list[Math.floor(random() * list.length)];
    const stamp = (at) => Math.round(Math.min(to - 1000, Math.max(from + 1000, at)));
    const convs = Object.create(null);
    const sessions = [];
    const helpers = [];
    const lines = [];

    for (let index = 1; index <= 24; index++) {
        const id = String(index);
        const linked = index === 2 || index === 5 || index === 9;

        convs[id] = {
            id,
            kind: linked ? "linked" : "session",
            parent: linked ? "1" : undefined,
            // 12 names from the books, then plain titles: the cast names each stranger by its id.
            title:
                index <= NIGHT_NAMES.length
                    ? `${NIGHT_NAMES[index - 1]}: the night's work`
                    : `Work ${index}: the night's work`,
            provider: index % 3 === 0 ? "anthropic" : "github-copilot",
            model: index % 3 === 0 ? "claude-opus-5.5" : "claude-sonnet-5.5",
            cwd: `~/projects/work${index}`,
            first: from,
            last: to,
            tin: 0,
            tout: 0,
            cost: 0,
            calls: 0,
            turns: 0,
            errors: 0,
            tools: Object.create(null),
            files: Object.create(null),
        };
        sessions.push(id);
    }

    for (let index = 0; index < 6; index++) {
        const id = String(25 + index);
        const name = ["scout", "reader", "tester", "mapper", "clerk", "runner"][index];

        convs[id] = {
            id,
            kind: "subagent",
            parent: sessions[index * 3],
            name,
            provider: "github-copilot",
            model: "claude-sonnet-5.5",
            cwd: `~/projects/work${index + 1}`,
            first: from,
            last: to,
            tin: 0,
            tout: 0,
            cost: 0,
            calls: 0,
            turns: 0,
            errors: 0,
            tools: Object.create(null),
            files: Object.create(null),
        };
        helpers.push(id);
    }

    // 20 links at the start of the night.
    for (let index = 0; index < 20; index++) {
        const helper = helpers[index];
        const conv = helper ? convs[helper] : null;
        const at = stamp(from + 30_000 + index * 60_000);

        lines.push(
            conv
                ? { at, k: "link", c: conv.id, p: conv.parent, kind: "subagent", name: conv.name }
                : { at, k: "link", c: sessions[1 + index], p: "1", kind: "linked" },
        );
    }

    // 60 messages, each opening a round of work.
    for (let index = 0; index < 60; index++) {
        const id = sessions[index % sessions.length];
        const at = stamp(from + 120_000 + (index / 60) * (to - from - 240_000));

        lines.push({
            at,
            k: "msg",
            from: index % 3 === 0 ? "human:Brian" : "station:night",
            to: id,
            via: index % 3 === 0 ? "human" : "system",
            text:
                index % 3 === 0
                    ? `Round ${1 + Math.floor(random() * 4)}: keep the checks green`
                    : `[night-shift] Round ${1 + Math.floor(random() * 4)}: tidy the notes`,
        });
    }

    // About 3000 tool and done pairs (or `?pairs=N` in the preview's address), in rounds, each closed by an idle.
    const total = Number(new URLSearchParams(location.search).get("pairs")) || 3000;
    let pairs = 0;
    let call = 0;
    let round = 0;

    while (pairs < total) {
        const id = pick(random() < 0.25 ? helpers : sessions);
        const calls = 3 + Math.floor(random() * 7);
        const at0 = from + 60_000 + random() * Math.max(60_000, to - from - 120_000);
        let at = at0;

        at += 1000 + random() * 5000;

        for (let step = 0; step < calls && pairs < total; step++, pairs++) {
            const tool = pick(NIGHT_TOOLS);
            const item = tool.item(pairs);
            const label = `${tool.w ? "edited" : (NIGHT_WORD[tool.s] ?? "read")} ${item}`;
            const number = ++call;
            const ok = random() > 0.06;

            lines.push({
                at: stamp(at),
                k: "tool",
                c: id,
                call: number,
                n: tool.n,
                s: tool.s,
                i: item,
                l: label,
                ...(tool.w ? { w: 1 } : {}),
            });
            at += 400 + random() * 6000;
            lines.push({
                at: stamp(at),
                k: "done",
                c: id,
                call: number,
                n: tool.n,
                ok: ok ? 1 : 0,
                ...(ok ? {} : { e: "exit status 1" }),
            });
            at += 200 + random() * 3000;

            convs[id].calls++;
            convs[id].tools[tool.n] = (convs[id].tools[tool.n] ?? 0) + 1;
            convs[id].tin += 2000 + Math.floor(random() * 20_000);
            convs[id].tout += 200 + Math.floor(random() * 1500);
            convs[id].cost += 0.02;
            ok || convs[id].errors++;
        }

        lines.push({ at: stamp(at), k: "idle", c: id });
        round++;
    }

    // In time order, numbered as the server numbers them.
    const events = lines
        .sort((a, b) => a.at - b.at)
        .map((line, index) => ({ id: index + 1, ...line }));

    return { from, to, now: Date.now(), convs, events };
}

// ——— the stand-in page ———
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

        if (path.startsWith("history?")) {
            const query = new URLSearchParams(path.slice("history?".length));

            return nightHistory(Number(query.get("from")), Number(query.get("to")));
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
