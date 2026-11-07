// Arrakis: the page. A desert of agents on a canvas (world.js), with the Imperium's instruments over it: a status
// bar, the Chronicle, a dossier for anyone you tap, and the glossary of the desert.

import { FACTIONS, SAYINGS, helperWord } from "./cast.js";
import { Demo } from "./demo.js";
import { atWork, fmt, nightWindow, solaris } from "./model.js";
import { PLACES } from "./places.js";
import { Sound } from "./sound.js";
import { World, portraitURL } from "./world.js";

export const pocketApi = 2;

// A sandworm's maw: a ring with teeth, rising from a dune.
const RAIL_ICON =
    "M2 20c3-2 6-2 9 0s6 2 9 0 M7 16a5 5 0 0 1 10 0 M9 13l1 2 M12 12v2 M15 13l-1 2 M12 4v3 M8 6l1.5 2 M16 6l-1.5 2";
const KEY = "x.dune.";
const MAX_EVENTS = 3000;
const KIND = { session: "Naib", subagent: "Fedaykin", linked: "Ally" };
const GLYPH = {
    thopter: "⟡",
    skull: "☠",
    worm: "∿",
    fold: "◎",
    tower: "▲",
    scroll: "✎",
    storm: "≋",
};
const STATUS = [
    ["homes", "Sietches", "Sessions: a sietch each"],
    ["helpers", "Fedaykin", "Subagents: a stilltent each"],
    ["active", "Active", "Agents working or thinking now"],
    ["perMinute", "Calls/min", "Tool calls in the last minute"],
    ["tokens", "Melange", "Tokens in and out"],
    ["cost", "Solaris", "Money spent on models"],
];

const read = (name, fallback) => {
    try {
        return localStorage.getItem(KEY + name) ?? fallback;
    } catch {
        return fallback;
    }
};

const write = (name, value) => {
    try {
        localStorage.setItem(KEY + name, value);
    } catch {
        // Private mode: the choice lasts for this page only.
    }
};

const time = (at) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The hour and minute of a time, on the Imperium's clock: 21:05. */
const clock = (at) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A record of what the server sent, keyed by its names: with no prototype, no name can reach one. */
const table = (from) => Object.assign(Object.create(null), from ?? {});

const span = (ms) => {
    const seconds = Math.max(0, Math.round(ms / 1000));

    if (seconds < 60) {
        return `${seconds} s`;
    }

    const minutes = Math.round(seconds / 60);

    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export function mergeInto(store, batch) {
    for (const field of ["convs", "res", "humans"]) {
        for (const [key, value] of Object.entries(batch[field] ?? {})) {
            if (value === null) {
                delete store[field][key];
            } else {
                store[field][key] = value;
                store.unknown.delete(key);
            }
        }
    }

    for (const id of batch.unknown ?? []) {
        if (!store.convs[id] && !store.unknown.has(id)) {
            store.unknown.set(id, Date.now());
        }
    }

    // New events and late ones (from a session shown just now) in one pass: each once, all in id order.
    const incoming = [...(batch.late ?? []), ...(batch.events ?? [])];

    if (incoming.length === 0) {
        return [];
    }

    const known = new Set(store.events.map((event) => event.id));
    const fresh = [];

    for (const event of incoming) {
        if (!known.has(event.id)) {
            known.add(event.id);
            fresh.push(event);
        }
    }

    fresh.sort((a, b) => a.id - b.id);

    if (fresh.length > 0) {
        const inOrder = fresh[0].id > store.maxId;

        store.events.push(...fresh);

        if (!inOrder) {
            store.events.sort((a, b) => a.id - b.id);
        }

        store.maxId = Math.max(store.maxId, fresh.at(-1).id);

        if (store.events.length > MAX_EVENTS) {
            store.events.splice(0, store.events.length - MAX_EVENTS);
        }
    }

    return fresh;
}

/** Events shown late (a session the owner was just shown they may see), put in their place. */
function insertEvents(store, events) {
    const known = new Set(store.events.map((event) => event.id));
    const fresh = events.filter((event) => !known.has(event.id));

    if (fresh.length > 0) {
        store.events.push(...fresh);
        store.events.sort((a, b) => a.id - b.id);
        store.maxId = Math.max(store.maxId, store.events.at(-1).id);
    }

    return fresh;
}

/**
 * The session to ask Pi Pocket about next, or null when there is nothing to ask. The focus session comes first
 * while the world does not hold it: the server leaves out a session quiet for more than 12 hours, and the desert
 * must still show the one the owner looks at. Then a session the server holds back, then one whose title may have
 * changed since it was asked. Pure, so a test can call it.
 */
export function nextAsk({
    convs,
    unknown,
    visible,
    focus,
    asked,
    askedAt,
    askedTries,
    retryAt,
    now,
}) {
    const numeric = (id) => typeof id === "string" && /^\d+$/.test(id);
    const waiting = (id) => (retryAt.get(id) ?? 0) > now;

    if (numeric(focus) && !convs[focus] && !asked.has(focus) && !waiting(focus)) {
        return focus;
    }

    // A session the server holds back until the owner's own request shows they may see it.
    for (const [id, since] of unknown) {
        if (numeric(id) && !asked.has(id) && !waiting(id) && now - since > 1200) {
            return id;
        }
    }

    for (const id of visible) {
        const conv = convs[id];
        // Titles change (Pi names a new session after its first answer): ask again now and then.
        const untitled = !conv?.title || /^new session$/i.test(conv.title);
        const tries = askedTries.get(id) ?? 0;
        const stale =
            asked.has(id) &&
            (!untitled || tries < 5) &&
            now - (askedAt.get(id) ?? 0) >
                (untitled ? Math.min(300_000, 20_000 * 2 ** tries) : 300_000);

        if (
            numeric(id) &&
            (!asked.has(id) || stale) &&
            !waiting(id) &&
            conv?.kind !== "subagent" &&
            // Once each, per page: Pi Pocket's word on who each session is (its persona, from the
            // team extension) can be newer than what the desert holds.
            (stale || !asked.has(id) || !conv || !conv.title)
        ) {
            return id;
        }
    }

    return null;
}

const portraits = new Map();

function portrait(cast) {
    const key = `${cast.name}|${cast.robe}|${cast.trim}|${cast.factionKey}`;

    if (!portraits.has(key)) {
        portraits.set(key, portraitURL(cast));
    }

    return portraits.get(key);
}

export default function setup(pocket) {
    const { html, useEffect, useRef, useState } = pocket;

    pocket.style("style.css");

    // One store for the tab, kept live by the server's batches while the page is closed too.
    const store = {
        convs: table(),
        res: table(),
        humans: table(),
        batch: 0,
        events: [],
        maxId: 0,
        loaded: false,
        boot: null,
        unknown: new Map(),
    };
    const listeners = new Set();
    const activity = new Map();
    let loading = null;
    let buffered = null;
    let badge = 0;

    const rail = pocket.rail({ id: "dune", title: "Arrakis", iconPath: RAIL_ICON, page: "dune" });

    pocket.launcher({
        id: "dune",
        label: "Open Arrakis",
        detail: "Your agents as a living desert: sietches, spice, and sandworms",
        iconPath: RAIL_ICON,
        keywords: [
            "dune",
            "arrakis",
            "agents",
            "subagents",
            "team",
            "sietch",
            "spice",
            "worm",
            "visualize",
        ],
        page: "dune",
    });

    function countActive() {
        const now = Date.now();
        let count = 0;

        for (const event of activity.values()) {
            if (atWork(event, now)) {
                count++;
            }
        }

        if (count !== badge) {
            badge = count;
            rail.update({ badge: count || null });
        }
    }

    function track(events) {
        for (const event of events) {
            if (event.c && ["tool", "done", "think", "reply", "idle"].includes(event.k)) {
                activity.set(event.c, event);
            }
        }

        countActive();
    }

    const sweep = setInterval(countActive, 30_000);
    let retry;
    let disposed = false;

    pocket.onDispose(() => {
        disposed = true;
        clearInterval(sweep);
        clearTimeout(retry);
    });

    function load() {
        if (store.loaded) {
            return Promise.resolve();
        }

        if (loading) {
            return loading;
        }

        buffered = [];
        loading = pocket
            .api("world")
            .then((world) => {
                store.convs = table(world.convs);
                store.res = table(world.res);
                store.humans = table(world.humans);
                store.batch = world.batch ?? 0;
                store.events = world.events ?? [];
                store.maxId = store.events.at(-1)?.id ?? 0;
                store.boot = world.boot ?? null;
                // How long a session may stay quiet and still stand on the map: the server's 12 hours, unless it says.
                store.recent = world.active ?? 12 * 60 * 60_000;
                store.unknown = new Map((world.unknown ?? []).map((id) => [id, 0]));

                // Batches that came while it loaded, newer than what it holds, in order. One missing: load again.
                let gap = false;

                for (const batch of buffered ?? []) {
                    if ((!batch.boot || batch.boot === store.boot) && !(batch.n <= store.batch)) {
                        if (typeof batch.n === "number" && batch.n !== store.batch + 1) {
                            gap = true;
                            break;
                        }

                        mergeInto(store, batch);
                        store.batch = batch.n ?? store.batch;
                    }
                }

                if (gap) {
                    store.loaded = false;
                    buffered = null;
                    loading = null;

                    return load();
                }

                store.loaded = true;
                track(store.events);
            })
            .finally(() => {
                buffered = null;
                loading = null;
            });

        return loading;
    }

    /** The server started over (a restart or a reset): take its world again. */
    function reload(wait = 2000) {
        if (disposed) {
            return;
        }

        store.loaded = false;
        load()
            .then(() => listeners.forEach((listener) => listener(null)))
            .catch(() => {
                clearTimeout(retry);
                retry = setTimeout(() => {
                    if (!disposed && !store.loaded && !loading) {
                        reload(Math.min(30_000, wait * 2));
                    }
                }, wait);
            });
    }

    pocket.on("batch", (batch) => {
        if (batch.boot && store.boot && batch.boot !== store.boot && (store.loaded || !loading)) {
            reload();

            return;
        }

        if (buffered) {
            buffered.push(batch);

            return;
        }

        // A batch went missing (too big, or sent while this tab slept): take the whole world again.
        if (
            store.loaded &&
            typeof batch.n === "number" &&
            typeof store.batch === "number" &&
            batch.n !== store.batch + 1
        ) {
            if (batch.n > store.batch) {
                reload();
            }

            return;
        }

        store.batch = batch.n ?? store.batch;

        const fresh = mergeInto(store, batch);

        track(fresh);
        listeners.forEach((listener) => listener(fresh));
    });

    pocket.on("reset", () => {
        Object.assign(store, {
            convs: table(),
            res: table(),
            humans: table(),
            events: [],
            unknown: new Map(),
        });
        activity.clear();
        countActive();
        listeners.forEach((listener) => listener(null));
    });

    // ——— pieces ———

    function Window({ title, kicker, onClose, className = "", children }) {
        return html`<section class=${`dune-win ${className}`} role="dialog" aria-label=${title}>
            <header class="dune-win-head">
                <div>
                    ${kicker && html`<div class="dune-kicker">${kicker}</div>`}
                    <h3>${title}</h3>
                </div>
                ${onClose && html`<button class="dune-x" aria-label="Close" onClick=${onClose}>✕</button>`}
            </header>
            <div class="dune-win-body">${children}</div>
        </section>`;
    }

    function Facts({ rows }) {
        return html`<dl class="dune-facts">
            ${rows
                .filter(([, value]) => value !== undefined && value !== null && value !== "")
                .map(
                    ([label, value]) =>
                        html`<dt>${label}</dt>
                            <dd>${value}</dd>`,
                )}
        </dl>`;
    }

    function Bar({ value, max, color }) {
        const fill = Math.max(0, Math.min(1, max > 0 ? value / max : 0));

        return html`<div class="dune-bar">
            <i style=${`width:${Math.round(fill * 100)}%;background:${color}`}></i>
        </div>`;
    }

    function AgentSheet({ info, onClose, onPick, onOpen, demo }) {
        const { conv, cast } = info;
        const tools = Object.entries(conv.tools ?? {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
        const top = tools[0]?.[1] ?? 1;
        const files = Object.entries(conv.files ?? {})
            .sort((a, b) => b[1].last - a[1].last)
            .slice(0, 8);

        return html`<${Window}
            title=${cast.name}
            kicker=${`${cast.title} · ${cast.faction?.label ?? "Fremen"}`}
            onClose=${onClose}
            className="dune-sheet"
        >
            <div class="dune-hero" style=${`--accent:${cast.accent}`}>
                <img class="dune-portrait" src=${portrait(cast)} alt="" width="72" height="120" />
                <div>
                    <p class="dune-line">${cast.line}</p>
                    <p class="dune-doing">
                        ${info.busy ? html`<b class="dune-live">●</b> ${info.doing ?? "at work"}` : html`<span class="dune-muted">Resting in the ${info.home.toLowerCase()}</span>`}
                    </p>
                </div>
            </div>
            <${Facts}
                rows=${[
                    ["Session", conv.title],
                    ["Role", KIND[conv.kind] ?? conv.kind],
                    [
                        "Serves",
                        info.parent &&
                            html`<a onClick=${() => onPick({ type: "agent", id: info.parent.id })}
                                >${info.parent.name}</a
                            >`,
                    ],
                    ["Spice field", conv.model ? `${conv.provider ?? ""} / ${conv.model}` : null],
                    ["Thinking", conv.thinking],
                    ["Tool calls", conv.calls],
                    ["Melange", `${fmt(conv.tin)} in · ${fmt(conv.tout)} out`],
                    ["Solaris", solaris(conv.cost)],
                    ["Stumbles", conv.errors || null],
                    ["Folder", conv.cwd],
                ]}
            />
            ${
                tools.length > 0 &&
                html`<h4>Tools of the trade</h4>
                    <div class="dune-tools">
                        ${tools.map(
                            ([name, n]) =>
                                html`<div class="dune-tool">
                                    <span>${name}</span
                                    ><${Bar} value=${n} max=${top} color=${cast.accent} /><b
                                        >${n}</b
                                    >
                                </div>`,
                        )}
                    </div>`
            }
            ${
                info.tasks.length > 0 &&
                html`<h4>Works raised</h4>
                    <ul class="dune-list">
                        ${info.tasks
                            .slice()
                            .reverse()
                            .map(
                                (task) =>
                                    html`<li>
                                        <a
                                            onClick=${() => onPick({ type: "task", owner: info.id, id: task.id })}
                                            >${task.title}</a
                                        >
                                        <span class="dune-muted"
                                            >${task.state === "building" ? "rising…" : (task.style?.name ?? "")}
                                            · ${task.calls} calls</span
                                        >
                                    </li>`,
                            )}
                    </ul>`
            }
            ${
                info.helpers.length > 0 &&
                html`<h4>${helperWord(cast)}s and allies</h4>
                    <ul class="dune-list">
                        ${info.helpers.map(
                            (helper) =>
                                html`<li>
                                    <a onClick=${() => onPick({ type: "agent", id: helper.id })}
                                        >${helper.name}</a
                                    >
                                    <span class="dune-muted">${helper.title}</span>
                                </li>`,
                        )}
                    </ul>`
            }
            ${
                files.length > 0 &&
                html`<h4>Scrolls touched</h4>
                    <ul class="dune-list dune-mono">
                        ${files.map(([path, f]) => html`<li>${path} <span class="dune-muted">${f.r ? `${f.r}r` : ""} ${f.w ? `${f.w}w` : ""}</span></li>`)}
                    </ul>`
            }
            ${!demo && /^\d+$/.test(info.id) && conv.kind !== "subagent" && html`<button class="dune-btn dune-wide" onClick=${() => onOpen(info.id)}>Open this session</button>`}
        <//>`;
    }

    function PlaceSheet({ info, onClose, onPick }) {
        const def = info.def;

        return html`<${Window}
            title=${def.label}
            kicker="A place of Arrakis"
            onClose=${onClose}
            className="dune-sheet"
        >
            <p class="dune-line">${def.what[0].toUpperCase() + def.what.slice(1)}.</p>
            <${Facts}
                rows=${[
                    ["Visits", info.count],
                    ["Last", info.last ? time(info.last) : "never"],
                ]}
            />
            ${
                info.humans.length > 0 &&
                html`<h4>Who writes from the Citadel</h4>
                    <ul class="dune-list">
                        ${info.humans.map((person) => html`<li>${person.name} <span class="dune-muted">${person.count} messages</span></li>`)}
                    </ul>`
            }
            ${
                info.visitors.length > 0 &&
                html`<h4>Who comes here</h4>
                    <ul class="dune-list">
                        ${info.visitors.map((each) => html`<li><a onClick=${() => onPick({ type: "agent", id: each.id })}>${each.name}</a> <span class="dune-muted">${each.n}</span></li>`)}
                    </ul>`
            }
            ${
                info.items.length > 0 &&
                html`<h4>What was sought</h4>
                    <ul class="dune-list dune-mono">
                        ${info.items.map((item) => html`<li>${item.name} <span class="dune-muted">×${item.n}${item.w ? ` · ${item.w} written` : ""}</span></li>`)}
                    </ul>`
            }
        <//>`;
    }

    function TaskSheet({ info, onClose, onPick }) {
        const long = info.end ? info.end - info.start : Date.now() - info.start;

        return html`<${Window}
            title=${info.title}
            kicker=${info.state === "building" ? "Rising now" : (info.style?.name ?? "A work")}
            onClose=${onClose}
            className="dune-sheet"
        >
            ${info.style && html`<p class="dune-line">${info.style.blurb[0].toUpperCase() + info.style.blurb.slice(1)}.</p>`}
            <${Facts}
                rows=${[
                    [
                        "Raised by",
                        html`<a onClick=${() => onPick({ type: "agent", id: info.owner })}
                            >${info.ownerName}</a
                        >`,
                    ],
                    ["Asked by", info.from],
                    ["Took", span(long)],
                    ["Calls", `${info.calls}${info.fails ? ` · ${info.fails} failed` : ""}`],
                    ["Melange", fmt(info.tokens)],
                    ["Solaris", solaris(info.cost)],
                    ["Helpers", info.helpers.join(", ")],
                ]}
            />
            ${
                info.parts.length > 0 &&
                html`<h4>Its parts</h4>
                    <div class="dune-parts">
                        ${info.parts.map((part) => html`<span class="dune-part" style=${`--c:${part.color}`}>${part.label} ×${part.n}</span>`)}
                    </div>`
            }
            ${
                info.files.length > 0 &&
                html`<h4>Scrolls</h4>
                    <ul class="dune-list dune-mono">
                        ${info.files.slice(-10).map((file) => html`<li>${file}</li>`)}
                    </ul>`
            }
            ${
                info.log.length > 0 &&
                html`<h4>How it was built</h4>
                    <ul class="dune-list dune-mono">
                        ${info.log.map(
                            (entry) =>
                                html`<li class=${entry.ok ? "" : "dune-bad"}>
                                    <span class="dune-muted">${time(entry.at)}</span>
                                    ${entry.who && entry.who !== info.ownerName ? `${entry.who}: ` : ""}${entry.l}
                                </li>`,
                        )}
                    </ul>`
            }
        <//>`;
    }

    function Glossary({ onClose, onForget, demo }) {
        const rows = [
            [
                "A sietch in the rocks",
                "A session; the banner over it is its faction, the words under it its task",
            ],
            [
                "An allied sietch on a trail",
                "A linked session, out on the road from the one that started it",
            ],
            ["A stilltent", "A subagent: a fedaykin, or an acolyte, beside its master's sietch"],
            ["The Arrakeen Citadel", "The people who write to the agents"],
            ...Object.values(PLACES).map((place) => [place.label, place.what]),
            ["Embassy of a Great House", "An MCP server: each its own house and banner"],
            [
                "Spice fields",
                "A model provider: a halo of melange while an agent thinks, spice flowing back as tokens",
            ],
            ["An ornithopter", "A message, a delegated task, or a report"],
            ["A drop of water / a broken blade", "A tool call that worked / failed"],
            [
                "A Coriolis storm",
                "3 or more failed calls in the last 45 seconds, and most calls failing",
            ],
            ["A heighliner", "A git push: it rises from the Guild Port and folds space"],
            ["Shai-Hulud", "Passes now and then; rises to honour a great work (8 calls or more)"],
        ];

        return html`<${Window}
            title="Glossary of the Desert"
            kicker="Terminology of the Imperium"
            onClose=${onClose}
            className="dune-manual"
        >
            <p class="dune-line">
                Every agent at work, as Arrakis. Name your agents after the people of the books (a
                session titled “Duncan Idaho: CI fixes”), and they come with their faction, robes,
                and gifts.
            </p>
            <table class="dune-table">
                ${rows.map(
                    ([thing, meaning]) =>
                        html`<tr>
                            <th>${thing}</th>
                            <td>${meaning}</td>
                        </tr>`,
                )}
            </table>
            <h4>Every task is a work</h4>
            <p>
                A message to an agent opens a site by its sietch. Each tool call that finishes adds
                a part, and a brick flies to it from the place where the call ran. When the agent
                answers, the scaffolding comes down, and the work takes the style of what weighed
                most: a Library Spire (reading), a Windtrap (edits), an Ixian Engine (commands), a
                Watchtower (the web), a Guild Beacon (git), a Council Tent (helpers), a Caravanserai
                (MCP), a Mural Arch (artifacts), a Memory Shrine (memory), or a Palace (a bit of
                everything). Most calls failed: a Buried Ruin.
            </p>
            <h4>The factions</h4>
            <div class="dune-factions">
                ${Object.values(FACTIONS).map(
                    (faction) =>
                        html`<span
                            class="dune-faction"
                            style=${`--robe:${faction.robe};--trim:${faction.trim}`}
                            >${faction.label}</span
                        >`,
                )}
            </div>
            <h4>Seeing it again</h4>
            <p>
                Replay plays the day again as a time-lapse. Night plays the last night again, from
                20:00 to 07:00, in a few minutes, under the two moons.
            </p>
            <p class="dune-muted">
                The desert shows only the sessions active in the last 12 hours, and the sessions
                they came from.
            </p>
            <p class="dune-muted">
                A day on Arrakis lasts 8 minutes. Drag to pan; scroll or pinch to zoom; tap anyone.
            </p>
            ${!demo && html`<button class="dune-btn dune-danger" onClick=${onForget}>Forget all history</button>`}
        <//>`;
    }

    // ——— the page ———

    function Page() {
        const wrapRef = useRef(null);
        const hudRef = useRef(null);
        const chronicleRef = useRef(false);
        const canvasRef = useRef(null);
        const worldRef = useRef(null);
        const demoRef = useRef(null);
        const soundRef = useRef(null);
        const focusRef = useRef(null);
        const [ready, setReady] = useState(store.loaded);
        const [error, setError] = useState(null);
        const [stats, setStats] = useState(null);
        const [log, setLog] = useState([]);
        const [selection, setSelection] = useState(null);
        const [scope, setScope] = useState("all");
        const [demo, setDemo] = useState(false);
        const [night, setNight] = useState(null);
        const [notice, setNotice] = useState(null);
        const noticeTimer = useRef(0);
        const [sound, setSound] = useState(false);
        const [sky, setSky] = useState(() => read("sky", "cycle"));
        const [chronicle, setChronicle] = useState(
            () => matchMedia("(min-width: 900px)").matches && read("chronicle", "1") === "1",
        );
        const [manual, setManual] = useState(false);

        chronicleRef.current = chronicle;
        const [splash, setSplash] = useState(true);
        const [saying] = useState(() => SAYINGS[Math.floor(Math.random() * SAYINGS.length)]);

        if (focusRef.current === null) {
            const id = pocket.conversationId();

            focusRef.current = { id: id === null ? null : String(id) };
        }

        const focus = focusRef.current.id;

        /** A short word over the desert, gone in 4 seconds: what could not be done, and why. */
        const say = (text) => {
            setNotice(text);
            clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(null), 4000);
        };

        useEffect(() => {
            const world = new World(canvasRef.current, store);
            const sounder = new Sound();
            const asked = new Set();
            const askedAt = new Map();
            const askedTries = new Map();
            const retryAt = new Map();
            const failures = new Map();
            let asking = false;
            let stopped = false;
            // The demo started by itself, on an empty desert: it gives way when a real agent appears.
            let autoDemo = false;
            const firstScope = focus ? read("scope", "family") : "all";

            worldRef.current = world;
            soundRef.current = sounder;
            world.sound = sounder;
            world.sky = read("sky", "cycle");
            world.setScope(firstScope, focus);
            setScope(firstScope);

            const size = () => {
                if (!stopped && wrapRef.current) {
                    const box = wrapRef.current.getBoundingClientRect();
                    const hud = hudRef.current?.getBoundingClientRect();
                    const wide = box.width >= 900;

                    // See all frames what the panels leave open.
                    world.insets = {
                        top: hud ? hud.bottom - box.top + 6 : 10,
                        right: chronicleRef.current && wide ? 346 : 10,
                        bottom: chronicleRef.current && !wide ? box.height * 0.42 : 10,
                        left: 10,
                    };
                    world.resize(box.width, box.height);
                }
            };

            world.relayoutPanels = size;

            const observer = new ResizeObserver(size);

            observer.observe(wrapRef.current);
            hudRef.current && observer.observe(hudRef.current);
            size();
            world.start();

            world.onSelect = (ref) => {
                ref && world.focusOn(ref);
                setSelection(world.selection());
            };

            world.onReplayEnd = () => {
                if (world.replay?.night) {
                    endNight();
                } else {
                    world.stopReplay(world.data.events);
                }
            };

            /** Back to the live desert, as `stopDemo` does: the night's data goes, the store's comes back. */
            function endNight() {
                world.replay = null;
                world.reset(store);
                world.setScope(focus ? read("scope", "family") : "all", focus);
                world.derive(store.events);
                setScope(world.scope);
                setNight(null);
            }

            const splashTimer = setTimeout(() => setSplash(false), 2600);

            // Titles, and the sessions the server holds back until the owner's own request shows they may see them.
            const askMeta = () => {
                // A night replay shows the past: its sessions are not the live ones to ask about.
                if (asking || !store.loaded || world.replay?.night) {
                    return;
                }

                // The demo shows work of its own. Only the focus session is still asked about there: a quiet one
                // is not in the world, and the desert must show the session the owner looks at.
                if (demoRef.current && !autoDemo) {
                    return;
                }

                const showing = Boolean(demoRef.current);
                const now = Date.now();
                const want = nextAsk({
                    convs: store.convs,
                    // The demo's sessions are not the server's: never ask about them.
                    unknown: showing ? new Map() : store.unknown,
                    visible: showing ? [] : world.visible,
                    focus,
                    asked,
                    askedAt,
                    askedTries,
                    retryAt,
                    now,
                });

                if (want === null) {
                    return;
                }

                if (asked.has(want)) {
                    askedTries.set(want, (askedTries.get(want) ?? 0) + 1);
                }

                asked.add(want);
                askedAt.set(want, now);
                asking = true;
                pocket
                    .api(`meta/${want}`)
                    .then((answer) => {
                        if (stopped || !answer?.conv) {
                            return;
                        }

                        store.unknown.delete(want);
                        retryAt.delete(want);
                        failures.delete(want);
                        store.convs[want] = answer.conv;
                        Object.assign(store.convs, table(answer.convs));
                        store.res = answer.res ? table(answer.res) : store.res;
                        store.humans = answer.humans ? table(answer.humans) : store.humans;

                        const added = insertEvents(store, answer.events ?? []).length;

                        // The answer of a quiet focus session gives the automatic demo a real desert to go to.
                        if (autoDemo && demoRef.current && Object.keys(store.convs).length > 0) {
                            autoDemo = false;
                            worldRef.current.stopDemo();

                            return;
                        }

                        // The demo has data of its own, and a replay shows the past: both take this when they end.
                        if (world.data !== store || world.replay) {
                            return;
                        }

                        added > 0 ? world.derive(store.events) : world.layout(true);
                    })
                    .catch((failure) => {
                        // Not the owner's to see: never ask again. A network failure: ask again later.
                        if (failure?.status === 403 || failure?.status === 404) {
                            store.unknown.delete(want);

                            return;
                        }

                        const count = (failures.get(want) ?? 0) + 1;

                        failures.set(want, count);
                        retryAt.set(want, Date.now() + Math.min(120_000, 2000 * 2 ** count));
                        asked.delete(want);
                    })
                    .finally(() => {
                        asking = false;
                    });
            };

            const onFresh = (fresh) => {
                if (fresh === null) {
                    asked.clear();
                    retryAt.clear();
                    failures.clear();
                    setSelection(null);

                    // A night replay shows the past, and the store is empty until it ends.
                    if (!demoRef.current && !world.replay?.night) {
                        world.reset(store);
                        world.setScope(world.scope, focus);
                        world.derive(store.events);
                    }

                    return;
                }

                for (const event of fresh) {
                    if (event.k === "done" && /^team/.test(event.n ?? "")) {
                        asked.delete(event.c);
                    }
                }

                if (autoDemo && demoRef.current && Object.keys(store.convs).length > 0) {
                    autoDemo = false;
                    world.stopDemo();

                    return;
                }

                if (!demoRef.current && !world.replay && store.loaded) {
                    world.ingest(fresh, true);
                }
            };

            listeners.add(onFresh);
            load()
                .then(() => {
                    if (!stopped) {
                        world.derive(store.events);
                        setReady(true);

                        // Nothing to see yet: show the demo, so the desert is never empty on a first visit.
                        if (Object.keys(store.convs).length === 0 && store.unknown.size === 0) {
                            startDemo();
                            autoDemo = true;
                        }
                    }
                })
                .catch((failure) => setError(failure?.message ?? String(failure)));

            let lastStats = "";
            let lastSheet = "";
            let lastLog = -1;
            const tick = setInterval(() => {
                const now = world.stats();
                const statsKey = JSON.stringify(now);

                if (statsKey !== lastStats) {
                    lastStats = statsKey;
                    setStats(now);
                }

                const sheet = world.selected ? world.selection() : null;
                const sheetKey = JSON.stringify(sheet, (key, value) =>
                    key === "conv" ? value?.last : value,
                );

                if (sheetKey !== lastSheet) {
                    lastSheet = sheetKey;
                    setSelection(sheet);
                }

                if (world.chronicleVersion !== lastLog) {
                    lastLog = world.chronicleVersion;
                    setLog(world.chronicle.slice(0, 80));
                }

                askMeta();
            }, 500);

            function startDemo() {
                // One show at a time: the demo takes the desert back from the night.
                if (world.replay?.night) {
                    endNight();
                }

                const fake = new Demo();

                demoRef.current = fake;
                world.reset(fake.store);
                world.setScope("all", null);
                world.derive(fake.store.events);
                fake.start((fresh) => {
                    if (!world.replay) {
                        world.ingest(fresh, true);
                    }
                });
                setDemo(true);
                setScope("all");
            }

            worldRef.current.startDemo = startDemo;
            worldRef.current.stopDemo = () => {
                autoDemo = false;
                demoRef.current?.stop();
                demoRef.current = null;
                world.reset(store);
                world.setScope(focus ? read("scope", "family") : "all", focus);
                world.derive(store.events);
                setScope(world.scope);
                setDemo(false);
            };

            // ——— the night ———

            let nightAsking = false;

            worldRef.current.startNight = async () => {
                if (nightAsking || world.replay?.night) {
                    return;
                }

                nightAsking = true;
                setNight("loading");

                const { from, to } = nightWindow(Date.now());
                let answer = null;

                try {
                    answer = await pocket.api(`history?from=${from}&to=${to}`);
                } catch {
                    answer = null;
                }

                nightAsking = false;

                if (stopped) {
                    setNight(null);

                    return;
                }

                if (!answer?.events?.length) {
                    setNight(null);
                    say("No history for the night yet");

                    return;
                }

                // The plain replay and the night are one slot: the night takes it.
                if (world.replay) {
                    world.stopReplay(world.data.events);
                }

                if (demoRef.current) {
                    worldRef.current.stopDemo();
                }

                const past = {
                    convs: table(answer.convs),
                    res: store.res,
                    humans: store.humans,
                    events: answer.events,
                    loaded: true,
                    unknown: new Map(),
                    batch: 0,
                    maxId: 0,
                };

                world.reset(past);
                world.setScope("all", null);
                world.startReplay(answer.events, 1, { span: to - from, night: true });
                world.fit();
                setScope("all");
                setNight("on");
            };

            worldRef.current.stopNight = () => {
                world.replay?.night && endNight();
            };

            return () => {
                stopped = true;
                clearInterval(tick);
                clearTimeout(splashTimer);
                clearTimeout(noticeTimer.current);
                observer.disconnect();
                listeners.delete(onFresh);
                demoRef.current?.stop();
                world.stop();
                sounder.dispose();
            };
        }, []);

        const world = worldRef.current;

        const pick = (ref) => {
            if (!world) {
                return;
            }

            world.select(ref);
            ref && world.focusOn(ref);
        };

        const toggleScope = () => {
            const next = scope === "family" ? "all" : "family";

            setScope(next);
            write("scope", next);
            world?.setScope(next, focus);
            world?.fit();
        };

        const cycleSky = () => {
            const next = { cycle: "day", day: "night", night: "cycle" }[sky];

            setSky(next);
            write("sky", next);
            world && (world.sky = next);
        };

        const toggleChronicle = () => {
            setChronicle(!chronicle);
            write("chronicle", chronicle ? "0" : "1");
            chronicleRef.current = !chronicle;
            world?.relayoutPanels?.();
            world?.fit();
        };

        const replay = () => {
            if (!world) {
                return;
            }

            if (world.replay?.night) {
                // The night holds the replay until it ends: press Night to stop it.
                return;
            }

            if (world.replay) {
                world.stopReplay(world.data.events);
            } else {
                world.startReplay(world.data.events, 4);
            }
        };

        const nightReplay = () => {
            if (!world) {
                return;
            }

            if (world.replay?.night) {
                world.stopNight?.();
            } else {
                world.startNight?.();
            }
        };

        const forget = async () => {
            await pocket.api("reset", {});
            setManual(false);
        };

        const close = () => {
            world?.select(null);
            setSelection(null);
        };

        const Sheet =
            selection?.type === "agent"
                ? AgentSheet
                : selection?.type === "place"
                  ? PlaceSheet
                  : selection?.type === "task"
                    ? TaskSheet
                    : null;

        return html`<div class=${`dune-root${chronicle ? " dune-with-log" : ""}`}>
            <div class="dune-stage" ref=${wrapRef}>
                <canvas
                    class="dune-canvas"
                    ref=${canvasRef}
                    aria-label="Arrakis: your agents as a desert"
                ></canvas>
            </div>

            <header class="dune-hud" ref=${hudRef}>
                <div class="dune-brand">
                    <span class="dune-title">ARRAKIS</span>
                    <span class="dune-sub"
                        >${demo ? "Demo · Chapterhouse at work" : (stats?.time ?? "Dune")}</span
                    >
                </div>
                <div class="dune-stats">
                    ${STATUS.map(
                        ([key, label, hint]) =>
                            html`<div class="dune-stat" title=${hint}>
                                <b
                                    >${stats ? (key === "tokens" ? fmt(stats.tokens) : key === "cost" ? solaris(stats.cost) : stats[key]) : "–"}</b
                                >
                                <span>${label}</span>
                            </div>`,
                    )}
                    ${stats?.storm && html`<div class="dune-stat dune-storm" title="Most calls are failing"><b>≋</b><span>Storm</span></div>`}
                </div>
                <nav class="dune-tools-bar">
                    ${focus && !demo && html`<button class="dune-btn" onClick=${toggleScope} title="This session's family, or every session">${scope === "family" ? "This sietch" : "All Arrakis"}</button>`}
                    <button
                        class="dune-btn"
                        onClick=${() => world?.fit()}
                        title="See the whole desert"
                    >
                        See all
                    </button>
                    <button
                        class=${`dune-btn${world?.replay && !night ? " dune-on" : ""}`}
                        onClick=${replay}
                        title="The day again, as a time-lapse"
                    >
                        ${world?.replay && !night && stats?.replay !== null && stats?.replay !== undefined ? `Replay ${stats.replay}%` : "Replay"}
                    </button>
                    ${
                        !demo &&
                        html`<button
                            class=${`dune-btn${night ? " dune-on" : ""}`}
                            onClick=${nightReplay}
                            title="Replay the night: 20:00 to 07:00, from the last 24 hours"
                        >
                            ${
                                night === "loading"
                                    ? "Night…"
                                    : night
                                      ? `☾ ${clock(stats?.replayAt || Date.now())}`
                                      : "Night"
                            }
                        </button>`
                    }
                    <button class="dune-btn" onClick=${cycleSky} title="Day and night">
                        ${{ cycle: "☾☀", day: "☀", night: "☾" }[sky]}
                    </button>
                    <button
                        class=${`dune-btn${sound ? " dune-on" : ""}`}
                        onClick=${() => setSound(soundRef.current?.toggle() ?? false)}
                        title="Sound of the desert"
                    >
                        ${sound ? "♪ On" : "♪ Off"}
                    </button>
                    <button
                        class=${`dune-btn${demo ? " dune-on" : ""}`}
                        onClick=${() => (demo ? world?.stopDemo() : world?.startDemo())}
                    >
                        ${demo ? "Leave demo" : "Demo"}
                    </button>
                    <button
                        class=${`dune-btn${chronicle ? " dune-on" : ""}`}
                        onClick=${toggleChronicle}
                    >
                        Chronicle
                    </button>
                    <button class="dune-btn" onClick=${() => setManual(true)}>Glossary</button>
                </nav>
            </header>

            ${
                chronicle &&
                html`<aside class="dune-log">
                    <h3>The Chronicle</h3>
                    ${log.length === 0 && html`<p class="dune-muted">The sand is still. Nothing has happened yet.</p>`}
                    <ol>
                        ${log.map(
                            (entry) =>
                                html`<li
                                    class=${`dune-entry dune-${entry.icon}`}
                                    onClick=${() => entry.c && pick({ type: "agent", id: entry.c })}
                                >
                                    <i>${GLYPH[entry.icon] ?? "·"}</i>
                                    <span>${entry.text}</span>
                                    <time>${time(entry.at)}</time>
                                </li>`,
                        )}
                    </ol>
                </aside>`
            }
            ${Sheet && html`<${Sheet} info=${selection} onClose=${close} onPick=${pick} onOpen=${(id) => pocket.openConversation(id)} demo=${demo} />`}
            ${manual && html`<${Glossary} onClose=${() => setManual(false)} onForget=${forget} demo=${demo} />`}
            ${error && html`<div class="dune-error">The desert could not be reached: ${error}</div>`}
            ${notice && html`<div class="dune-note">${notice}</div>`}
            ${!ready && !error && html`<div class="dune-loading">Listening for the thumpers…</div>`}
            ${
                splash &&
                html`<div class="dune-splash" onClick=${() => setSplash(false)}>
                    <div class="dune-splash-title">ARRAKIS</div>
                    <div class="dune-splash-rule"></div>
                    <div class="dune-splash-saying">${saying}</div>
                </div>`
            }
        </div>`;
    }

    pocket.page({ id: "dune", title: "Arrakis", component: Page, swipe: false });
}
