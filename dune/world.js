// The engine: Arrakis on a canvas. It lays the desert out around the Arrakeen Citadel (the places on an inner ring,
// the sietches of the agents beyond them), walks the agents across the dunes to the places their tool calls reach,
// flies ornithopters with their messages, streams melange from the spice fields while they think, and raises a
// structure beside each sietch for every task. Worms pass. Storms rise when the calls fail. A day lasts 8 minutes.

import { castOf, hash, homeWord } from "./cast.js";
import { Desert, PART, STYLE, recentIds, styleOf } from "./model.js";
import { CITADEL, CORE, STATIONS, placeDef } from "./places.js";

const DAY_MS = 8 * 60_000;
const TAU = Math.PI * 2;
const FONT =
    '"Josefin Sans", "Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", system-ui, sans-serif';
const PART_COLOR = {
    read: "#f3e2b5",
    write: "#7fc8ff",
    shell: "#9fb4c8",
    git: "#ff9a3c",
    web: "#8fe3ff",
    mcp: "#e58bff",
    artifact: "#ffd166",
    memory: "#c9a7ff",
    delegate: "#f7f0d0",
    other: "#d8c49a",
    fail: "#ff4b3a",
};

// ——— small helpers ———

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function rng(seed) {
    let a = seed >>> 0 || 1;

    return () => {
        a = (a + 0x6d2b79f5) | 0;

        let t = Math.imul(a ^ (a >>> 15), 1 | a);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash2(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;

    h = Math.imul(h ^ (h >>> 13), 1274126177);

    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);

    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The height of the dunes at a point: long sharp-crested ridges, smaller ones across them, and ripples. */
function duneHeight(x, y) {
    const warp = noise(x * 0.0015, y * 0.0015) * 2 - 1;
    const warp2 = noise(x * 0.004 + 50, y * 0.004 - 20) * 2 - 1;
    const big = (1 - Math.abs(Math.sin(x * 0.0043 + y * 0.0019 + warp * 2.6))) ** 1.7;
    const small = (1 - Math.abs(Math.sin(x * 0.012 - y * 0.0045 + warp2 * 1.8))) ** 2 * 0.32;
    const ripple = Math.sin(x * 0.11 + y * 0.035 + warp * 7) * 0.025;

    return big + small + ripple;
}

/** A colour with some alpha, from #rrggbb or any CSS colour the canvas already parsed. */
function alpha(color, a) {
    if (color.startsWith("#") && color.length === 7) {
        const n = parseInt(color.slice(1), 16);

        return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    }

    if (color.startsWith("hsl(")) {
        return color.replace("hsl(", "hsla(").replace(")", ` / ${a})`);
    }

    return color;
}

/** Light or shade a #rrggbb colour by `amount` (-1 to 1). */
function shade(color, amount) {
    if (!color.startsWith("#") || color.length !== 7) {
        return color;
    }

    const n = parseInt(color.slice(1), 16);
    const f = (c) =>
        Math.round(clamp(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount, 0, 255));

    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** The light of the hour: 0 noon … 0.5 midnight. */
function skyAt(now, mode) {
    const t = mode === "day" ? 0.08 : mode === "night" ? 0.5 : (now % DAY_MS) / DAY_MS;
    // Night is how dark it is (0 to 1); dusk how golden.
    const sun = Math.cos(t * TAU);
    const night = clamp((0.25 - sun) / 0.55, 0, 1);
    const dusk = clamp(1 - Math.abs(sun - 0.05) / 0.35, 0, 1);

    return { t, sun, night, dusk, angle: t * TAU };
}

function timeWord(sky) {
    if (sky.night > 0.75) {
        return "Night of two moons";
    }

    if (sky.dusk > 0.5) {
        return sky.t < 0.5 ? "Dusk" : "Dawn";
    }

    return sky.sun > 0.8 ? "High sun" : sky.t < 0.5 ? "Afternoon" : "Morning";
}

// ——— the world ———

export class World {
    constructor(canvas, data) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.model = new Desert();
        this.cam = { x: 0, y: 0, z: 0.5 };
        this.goal = null;
        this.view = { w: 1, h: 1, dpr: 1 };
        this.agents = new Map();
        this.places = new Map();
        this.lots = new Map();
        this.fx = {
            prints: [],
            motes: [],
            bricks: [],
            thopters: [],
            worms: [],
            dust: [],
            ships: [],
            streaks: [],
        };
        this.scope = "all";
        this.focus = null;
        this.hits = [];
        this.selected = null;
        this.sky = "cycle";
        this.layoutKey = "";
        this.bounds = { x: -600, y: -600, w: 1200, h: 1200 };
        this.bg = null;
        this.calm =
            typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.replay = null;
        this.prunedAt = 0;
        this.nextWorm = performance.now() + 8000;
        this.storm = 0;
        this.sound = null;
        this.onSelect = null;
        this.onReplayEnd = null;
        this.fitted = false;
        this.toolTimes = [];
        this.setData(data);
        this.bindInput();
    }

    // ——— data ———

    setData(data) {
        this.data = data;
        this.model.reset(data.convs);
        this.agents.clear();
        this.layoutKey = "";
        this.selected = null;
        this.fitted = false;
    }

    reset(data) {
        this.setData(data);

        for (const list of Object.values(this.fx)) {
            list.length = 0;
        }
    }

    names = (id) => {
        const conv = this.data.convs[id];

        return conv ? this.castFor(conv).name : `#${id}`;
    };

    castFor(conv) {
        const key = `${conv.id}|${conv.persona ?? ""}|${conv.title ?? ""}|${conv.name ?? ""}|${conv.kind}`;

        if (conv._castKey !== key) {
            Object.defineProperty(conv, "_cast", {
                value: castOf(conv),
                writable: true,
                configurable: true,
            });
            Object.defineProperty(conv, "_castKey", {
                value: key,
                writable: true,
                configurable: true,
            });
        }

        return conv._cast;
    }

    /** One event into the model. One it cannot read is skipped: it never stops the desert. */
    apply(event) {
        try {
            return this.model.apply(event, this.names);
        } catch (error) {
            console.warn("dune: skipped an event", event?.k, error);

            return [];
        }
    }

    /** Every event again, without animation: the world as it stands after them. */
    derive(events) {
        this.model.reset(this.data.convs);

        for (const event of events) {
            this.apply(event);
        }

        this.toolTimes = events.filter((event) => event.k === "tool").map((event) => event.at);
        this.storm = this.model.storm ? 1 : 0;
        this.layout(true);
    }

    /** New events, as they come: each changes the model, and with `animate` shows in the world. */
    ingest(events, animate) {
        for (const event of events) {
            if (event.k === "tool") {
                this.toolTimes.push(event.at);
            }

            const effects = this.apply(event);

            if (animate) {
                effects.forEach((effect) => this.effect(effect));
            }
        }

        this.layout();
    }

    setScope(scope, focus) {
        this.scope = scope;
        this.focus = focus ?? null;
        this.layoutKey = "";
        this.fitted = false;
        this.layout(true);
    }

    rootOf(id) {
        let at = id;

        for (let depth = 0; depth < 16; depth++) {
            const parent = this.data.convs[at]?.parent;

            if (!parent || !this.data.convs[parent]) {
                return at;
            }

            at = parent;
        }

        return at;
    }

    /**
     * The sessions in view: those active in the last 12 hours and their ancestors (a server that sends `recent`
     * says how long that is), or all of them when it does not (the demo and the night store); then the focus
     * session's whole family, or every one.
     */
    get visible() {
        const ids =
            typeof this.data.recent === "number"
                ? recentIds(
                      this.data.convs,
                      Date.now(),
                      this.data.recent,
                      this.focus ? [this.focus] : [],
                  )
                : Object.keys(this.data.convs);

        if (this.scope !== "family" || !this.focus || !this.data.convs[this.focus]) {
            return ids;
        }

        const root = this.rootOf(this.focus);

        return ids.filter((id) => this.rootOf(id) === root);
    }

    // ——— layout ———

    layout(force = false) {
        const visible = this.visible;
        const res = Object.keys(this.data.res ?? {});
        const providers = new Set(
            res.filter((key) => key.startsWith("model:")).map((key) => key.slice(6)),
        );

        for (const id of visible) {
            const provider = this.data.convs[id]?.provider;

            provider && providers.add(provider);
        }

        const placeKeys = [
            ...CORE,
            ...res.filter((key) => !key.startsWith("model:") && !CORE.includes(key)),
            ...[...providers].map((provider) => `model:${provider}`),
        ];
        const key = [
            visible
                .map(
                    (id) =>
                        `${id}:${this.data.convs[id]?.parent ?? ""}:${this.data.convs[id]?.kind}`,
                )
                .sort()
                .join(","),
            placeKeys.join(","),
        ].join("|");

        if (!force && key === this.layoutKey) {
            return;
        }

        this.layoutKey = key;

        // The places, on a ring around the Citadel.
        const ringPlaces = Math.max(300, (placeKeys.length * 175) / TAU);
        const keepPlaces = new Map();

        keepPlaces.set("citadel", { key: "citadel", def: CITADEL, x: 0, y: 0, seed: 7 });
        placeKeys.forEach((placeKey, index) => {
            const angle = -Math.PI / 2 + (index / placeKeys.length) * TAU + 0.3;

            keepPlaces.set(placeKey, {
                key: placeKey,
                def: placeDef(placeKey),
                x: Math.cos(angle) * ringPlaces,
                y: Math.sin(angle) * ringPlaces * 0.82,
                seed: hash(placeKey),
                harvester: this.places.get(placeKey)?.harvester ?? 0,
            });
        });
        this.places = keepPlaces;

        // The sietches: a tree of sessions and linked sessions, each with its share of the circle.
        const homes = visible.filter((id) => this.data.convs[id]?.kind !== "subagent");
        const homeSet = new Set(homes);
        const children = new Map();
        const roots = [];

        for (const id of homes) {
            const parent = this.data.convs[id].parent;

            if (parent && homeSet.has(parent)) {
                (children.get(parent) ?? children.set(parent, []).get(parent)).push(id);
            } else {
                roots.push(id);
            }
        }

        const byFirst = (a, b) => (this.data.convs[a].first ?? 0) - (this.data.convs[b].first ?? 0);

        roots.sort(byFirst);
        children.forEach((list) => list.sort(byFirst));

        const weight = new Map();
        const weigh = (id, depth = 0) => {
            const total =
                1 +
                (depth < 8
                    ? (children.get(id) ?? []).reduce(
                          (sum, child) => sum + weigh(child, depth + 1),
                          0,
                      )
                    : 0);

            weight.set(id, total);

            return total;
        };
        const totalWeight = roots.reduce((sum, id) => sum + weigh(id), 0) || 1;
        const ringHomes = Math.max(ringPlaces + 340, (roots.length * 560) / TAU);
        const homeAt = new Map();
        /** A sietch at the middle of its share of the circle, and its allies further out within that share. */
        const place = (id, from, span, radius, depth) => {
            const angle = from + span / 2;

            homeAt.set(id, {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius * 0.82,
                angle,
                depth,
            });
            share(id, from, span, radius + 430, depth + 1);
        };
        const share = (id, from, span, radius, depth) => {
            const list = depth < 8 ? (children.get(id) ?? []) : [];
            const sum = list.reduce((acc, child) => acc + weight.get(child), 0) || 1;
            let at = from;

            for (const child of list) {
                const part = (span * weight.get(child)) / sum;

                place(child, at, part, radius, depth);
                at += part;
            }
        };

        if (roots.length === 1) {
            // One family: its head sits north of the Citadel, and its allies ring the whole desert.
            const head = roots[0];
            const count = children.get(head)?.length ?? 0;
            const radius = Math.max(ringPlaces + 520, (count * 480) / TAU);

            homeAt.set(head, {
                x: 0,
                y: -(ringPlaces + 330) * 0.82,
                angle: -Math.PI / 2,
                depth: 0,
            });
            // A gap in the north of the ring, where the head of the family sits.
            const gap = count > 2 ? Math.min(1.2, (1.6 * TAU) / (count + 1)) : 0;

            share(head, -Math.PI / 2 + gap / 2, TAU - gap, radius, 1);
        } else {
            let start = -Math.PI / 2 - (TAU * (weight.get(roots[0]) ?? 1)) / totalWeight / 2;

            for (const id of roots) {
                const span = (TAU * weight.get(id)) / totalWeight;

                place(id, start, span, ringHomes, 0);
                start += span;
            }
        }

        // The agents: every visible session; subagents in tents by their owner's sietch.
        const tentsOf = new Map();
        const keep = new Map();

        for (const id of visible) {
            const conv = this.data.convs[id];
            const old = this.agents.get(id);
            let home;
            let tent = null;

            if (conv.kind === "subagent") {
                const owner = this.model.ownerOf(id);
                const base = homeAt.get(owner) ?? homeAt.get(this.rootOf(id)) ?? { x: 0, y: 0 };
                const index = tentsOf.get(owner) ?? 0;

                tentsOf.set(owner, index + 1);

                const ring = 1 + Math.floor(index / 6);
                const angle = -Math.PI * 0.85 + (index % 6) * (Math.PI * 0.34) + ring * 0.2;

                tent = {
                    x: base.x + Math.cos(angle) * (95 + ring * 40),
                    y: base.y - 34 + Math.sin(angle) * (55 + ring * 26),
                };
                home = { x: tent.x + 10, y: tent.y + 14 };
            } else {
                const at = homeAt.get(id) ?? { x: 0, y: 0 };

                home = { x: at.x, y: at.y + 34 };
            }

            const agent = old ?? {
                id,
                pos: { ...home },
                from: { ...home },
                to: { ...home },
                t0: 0,
                dur: 0,
                state: "home",
                phase: Math.random() * TAU,
                pops: [],
                shake: 0,
                spiceUntil: 0,
                printSide: 0,
                lastPrint: { ...home },
            };

            agent.conv = conv;
            agent.kind = conv.kind;
            agent.cast = this.castFor(conv);
            agent.rock = conv.kind === "subagent" ? null : homeAt.get(id);
            agent.tent = tent;

            const moved = !old || dist(old.home ?? home, home) > 1;

            agent.home = home;

            if (moved && agent.state === "home") {
                agent.pos = { ...home };
                agent.to = { ...home };
            }

            agent.seed = hash(id);
            keep.set(id, agent);
        }

        this.agents = keep;

        // The lots: where each sietch's structures stand.
        const LOTS = [
            [-120, 78],
            [122, 80],
            [-205, 22],
            [208, 26],
            [-150, 150],
            [150, 152],
        ];

        this.lots.clear();

        for (const id of homes) {
            const at = homeAt.get(id);

            at &&
                this.lots.set(
                    id,
                    LOTS.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy })),
                );
        }

        // The bounds of it all, for the dunes and for See all.
        let minX = -ringPlaces - 200;
        let maxX = ringPlaces + 200;
        let minY = -ringPlaces - 200;
        let maxY = ringPlaces + 200;

        for (const at of homeAt.values()) {
            minX = Math.min(minX, at.x - 330);
            maxX = Math.max(maxX, at.x + 330);
            minY = Math.min(minY, at.y - 220);
            maxY = Math.max(maxY, at.y + 260);
        }

        this.content = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

        const b = this.bounds;

        if (!this.bg || minX < b.x || minY < b.y || maxX > b.x + b.w || maxY > b.y + b.h) {
            // Room to pan and zoom out on any screen before the dunes run out.
            const pad = Math.max(1200, Math.max(maxX - minX, maxY - minY) * 1.2);

            this.bounds = {
                x: minX - pad,
                y: minY - pad,
                w: maxX - minX + pad * 2,
                h: maxY - minY + pad * 2,
            };
            this.bg = null;
        }

        if (!this.fitted && this.view.w > 1) {
            this.fit(true);
        }
    }

    /** The dunes, drawn once for the bounds into a picture of their own. */
    paintDunes() {
        const b = this.bounds;
        const scale = Math.min(0.5, Math.sqrt(1_100_000 / (b.w * b.h)));
        const w = Math.max(64, Math.round(b.w * scale));
        const h = Math.max(64, Math.round(b.h * scale));
        const canvas = document.createElement("canvas");

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(w, h);
        const data = image.data;
        const step = 1 / scale;
        const dark = [150, 86, 44];
        const mid = [214, 150, 88];
        const lit = [247, 208, 148];

        for (let py = 0; py < h; py++) {
            const y = b.y + py * step;

            for (let px = 0; px < w; px++) {
                const x = b.x + px * step;
                const here = duneHeight(x, y);
                const slope = (duneHeight(x + 3, y - 1.5) - here) * 9;
                const light = clamp(0.55 + slope + here * 0.12, 0, 1);
                const grain = (hash2(px, py) - 0.5) * 10;
                const [from, to, t] =
                    light < 0.5 ? [dark, mid, light * 2] : [mid, lit, (light - 0.5) * 2];
                const index = (py * w + px) * 4;

                data[index] = lerp(from[0], to[0], t) + grain;
                data[index + 1] = lerp(from[1], to[1], t) + grain;
                data[index + 2] = lerp(from[2], to[2], t) + grain * 0.6;
                data[index + 3] = 255;
            }
        }

        ctx.putImageData(image, 0, 0);
        this.bg = canvas;
    }

    // ——— where things are ———

    /** Where a sender or receiver of a message is now. */
    whereIs(ref) {
        if (typeof ref !== "string") {
            return this.places.get("citadel");
        }

        if (ref.startsWith("human:")) {
            return this.places.get("citadel");
        }

        if (ref.startsWith("station:")) {
            return (
                this.places.get(STATIONS[ref.slice(8)] ?? "citadel") ?? this.places.get("citadel")
            );
        }

        const agent = this.agents.get(ref);

        return agent ? agent.pos : null;
    }

    /** The lot where a sietch's open (or newest) task stands. */
    lotOf(owner, taskId) {
        const lots = this.lots.get(owner);
        const list = this.model.tasks.get(owner) ?? [];
        const index = list.findIndex((task) => task.id === taskId);

        if (!lots) {
            return null;
        }

        return lots[index < 0 ? Math.max(0, list.length - 1) : index] ?? lots[0];
    }

    // ——— effects ———

    effect(effect) {
        const now = performance.now();

        switch (effect.type) {
            case "walk": {
                const agent = this.agents.get(effect.c);

                if (!agent) {
                    return;
                }

                agent.label = effect.label;
                agent.labelUntil = now + 6000;

                const place = effect.s ? this.places.get(effect.s) : null;

                if (place) {
                    const angle = ((agent.seed % 360) / 360) * TAU;
                    const spot = {
                        x: place.x + Math.cos(angle) * 58,
                        y: place.y + 40 + Math.sin(angle) * 26,
                    };

                    this.walk(agent, spot, "work");
                } else if (agent.state !== "walk") {
                    agent.state = "work";
                }

                this.sound?.play("step");
                break;
            }

            case "result": {
                const agent = this.agents.get(effect.c);

                if (agent) {
                    agent.pops.push({ ok: effect.ok, t0: now });

                    if (!effect.ok && !this.calm) {
                        agent.shake = now + 500;
                    }
                }

                const from = (effect.s && this.places.get(effect.s)) || agent?.pos;
                const to = this.lotOf(effect.owner, effect.task);

                if (from && to && !this.calm) {
                    this.fx.bricks.push({
                        from: { x: from.x, y: from.y - 20 },
                        to,
                        t0: now,
                        dur: 900,
                        color: PART_COLOR[effect.part] ?? "#fff",
                    });
                }

                this.sound?.play(effect.ok ? "ok" : "fail");
                break;
            }

            case "think": {
                const agent = this.agents.get(effect.c);

                if (agent) {
                    if (agent.state === "home" || agent.state === "think") {
                        agent.state = "think";
                    }

                    agent.spiceUntil = now + 30_000;
                    agent.pv = effect.pv ?? agent.conv.provider;
                }

                break;
            }

            case "spice": {
                const agent = this.agents.get(effect.c);
                const field = this.places.get(`model:${effect.pv ?? agent?.conv?.provider}`);

                if (agent) {
                    agent.spiceUntil = 0;

                    if (agent.state === "think") {
                        agent.state = "home";
                    }
                }

                if (agent && field && !this.calm) {
                    const count = clamp(Math.round(Math.log10(1 + effect.amount) * 4), 2, 26);

                    for (let index = 0; index < count; index++) {
                        this.fx.motes.push(this.mote(field, agent.home, now + index * 40, 1400));
                    }
                }

                this.sound?.play("spice");
                break;
            }

            case "home": {
                const agent = this.agents.get(effect.c);

                if (agent) {
                    agent.label = null;
                    agent.spiceUntil = 0;
                    this.walk(agent, agent.home, "home");
                }

                break;
            }

            case "thopter": {
                const from = this.whereIs(effect.from);
                const to = this.whereIs(effect.to);

                if (from && to && dist(from, to) > 10) {
                    const d = dist(from, to);

                    this.fx.thopters.push({
                        from: { x: from.x, y: from.y - 30 },
                        to: { x: to.x, y: to.y - 30 },
                        t0: now,
                        dur: clamp(d * 2.2, 1200, 4200),
                        via: effect.via,
                        seed: Math.random(),
                    });
                    this.sound?.play("thopter");
                }

                break;
            }

            case "heighliner": {
                const port = this.places.get("github");

                if (port) {
                    this.fx.ships.push({ x: port.x, y: port.y, t0: now, dur: 4200 });
                    this.sound?.play("heighliner");
                }

                break;
            }

            case "built": {
                const lot = this.lotOf(effect.owner, effect.task);
                const task = (this.model.tasks.get(effect.owner) ?? []).find(
                    (each) => each.id === effect.task,
                );

                if (lot && !this.calm) {
                    for (let index = 0; index < 16; index++) {
                        const angle = Math.random() * TAU;

                        this.fx.dust.push({
                            x: lot.x,
                            y: lot.y,
                            vx: Math.cos(angle) * (20 + Math.random() * 40),
                            vy: Math.sin(angle) * (10 + Math.random() * 20) - 10,
                            t0: now,
                            dur: 1200 + Math.random() * 800,
                            r: 4 + Math.random() * 6,
                        });
                    }
                }

                // A great work: Shai-Hulud comes to see it.
                if (lot && task && task.calls >= 8 && !effect.ruin) {
                    this.summonWorm({ x: lot.x + 160, y: lot.y + 90 }, true);
                }

                this.sound?.play("built");
                break;
            }

            case "storm":
                this.sound?.play(effect.on ? "storm" : "calm");
                break;

            case "relayout":
                this.layout(true);
                break;

            default:
                break;
        }
    }

    walk(agent, to, then) {
        const now = performance.now();

        agent.from = { ...agent.pos };
        agent.to = { ...to };
        agent.t0 = now;
        agent.dur = this.calm ? 1 : clamp(dist(agent.pos, to) / 0.6, 250, 1500);
        agent.state = "walk";
        agent.then = then;
    }

    mote(field, to, t0, dur) {
        const r = 70 * Math.sqrt(Math.random());
        const angle = Math.random() * TAU;

        return {
            from: { x: field.x + Math.cos(angle) * r, y: field.y + Math.sin(angle) * r * 0.6 },
            to: { x: to.x + (Math.random() - 0.5) * 16, y: to.y - 18 },
            t0,
            dur: dur + Math.random() * 400,
            lift: 60 + Math.random() * 90,
            size: 1.6 + Math.random() * 2,
        };
    }

    summonWorm(near, rise = false) {
        const b = this.content ?? this.bounds;
        const angle = Math.random() * TAU;
        const length = 900 + Math.random() * 600;
        const center = near ?? {
            x: b.x + Math.random() * b.w,
            y: b.y + Math.random() * b.h,
        };

        this.fx.worms.push({
            from: {
                x: center.x - (Math.cos(angle) * length) / 2,
                y: center.y - Math.sin(angle) * length * 0.3,
            },
            to: {
                x: center.x + (Math.cos(angle) * length) / 2,
                y: center.y + Math.sin(angle) * length * 0.3,
            },
            t0: performance.now(),
            dur: rise ? 9000 : 14_000 + Math.random() * 6000,
            rise,
            size: rise ? 1.3 : 0.8 + Math.random() * 0.5,
        });
        this.sound?.play("worm");
    }

    // ——— the replay ———

    /**
     * Play `events` again. `speed` shortens the pauses; with `options.span` (ms of real time) the whole time is
     * squeezed into it instead, so a whole night plays in minutes. `options.night` draws it as night.
     */
    startReplay(events, speed = 1, options = {}) {
        const list = events.filter((event) => this.data.convs[event.c] || event.k === "msg");

        this.model.reset(this.data.convs);
        this.agents.forEach((agent) => {
            agent.state = "home";
            agent.pos = { ...agent.home };
        });

        const span = Number(options.span) > 0 ? Number(options.span) : null;
        // How much of the clock one ms of real time stands for; a night starts at once.
        const scale = span ? Math.max(1, span / (options.length ?? 180_000)) : 1;
        let at = span ? 0 : 25;
        const queue = list.map((event, index) => {
            if (index > 0) {
                const diff = event.at - list[index - 1].at;

                // A night has no 25 ms floor: a burst of calls lands in one frame.
                at += span
                    ? clamp(diff / scale, 0, 1500)
                    : Math.max(clamp(diff, 0, 900) / speed, 25);
            }

            return { event, at };
        });

        this.replay = {
            queue,
            index: 0,
            t0: performance.now(),
            total: at,
            night: Boolean(options.night),
        };
        this.layout(true);
    }

    stopReplay(events) {
        this.replay = null;
        this.derive(events);
    }

    stepReplay(now) {
        const replay = this.replay;

        if (!replay) {
            return;
        }

        const elapsed = now - replay.t0;

        while (replay.index < replay.queue.length && replay.queue[replay.index].at <= elapsed) {
            const { event } = replay.queue[replay.index++];

            this.apply(event).forEach((effect) => this.effect(effect));
        }

        replay.progress = replay.total > 0 ? clamp(elapsed / replay.total, 0, 1) : 1;

        if (replay.index >= replay.queue.length) {
            this.onReplayEnd?.();
        }
    }

    // ——— the camera ———

    resize(width, height) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);

        this.view = { w: Math.max(1, width), h: Math.max(1, height), dpr };
        this.canvas.width = Math.round(this.view.w * dpr);
        this.canvas.height = Math.round(this.view.h * dpr);

        if (!this.fitted) {
            this.fit(true);
        }
    }

    fit(now = false) {
        const box = this.content ?? this.bounds;
        const inset = this.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
        const width = Math.max(120, this.view.w - inset.left - inset.right);
        const height = Math.max(120, this.view.h - inset.top - inset.bottom);
        const z = clamp(Math.min(width / box.w, height / box.h) * 0.96, 0.12, 2.4);
        // The middle of what the panels leave open, not of the canvas.
        const goal = {
            x: box.x + box.w / 2 - (inset.left - inset.right) / 2 / z,
            y: box.y + box.h / 2 - (inset.top - inset.bottom) / 2 / z,
            z,
        };

        if (this.view.w > 1) {
            this.fitted = true;
        }

        if (now) {
            this.cam = goal;
            this.goal = null;
        } else {
            this.goal = goal;
        }
    }

    focusOn(ref) {
        const at = this.refPos(ref);

        if (at) {
            this.goal = { x: at.x, y: at.y - 20, z: Math.max(this.cam.z, 1.1) };
        }
    }

    refPos(ref) {
        if (!ref) {
            return null;
        }

        if (ref.type === "agent") {
            return this.agents.get(ref.id)?.pos ?? null;
        }

        if (ref.type === "place") {
            return this.places.get(ref.key) ?? null;
        }

        if (ref.type === "task") {
            return this.lotOf(ref.owner, ref.id);
        }

        return null;
    }

    toWorld(sx, sy) {
        return {
            x: (sx - this.view.w / 2) / this.cam.z + this.cam.x,
            y: (sy - this.view.h / 2) / this.cam.z + this.cam.y,
        };
    }

    toScreen(x, y) {
        return {
            x: (x - this.cam.x) * this.cam.z + this.view.w / 2,
            y: (y - this.cam.y) * this.cam.z + this.view.h / 2,
        };
    }

    zoomAt(sx, sy, factor) {
        const before = this.toWorld(sx, sy);

        this.goal = null;
        this.cam.z = clamp(this.cam.z * factor, 0.1, 3.5);

        const after = this.toWorld(sx, sy);

        this.cam.x += before.x - after.x;
        this.cam.y += before.y - after.y;
    }

    bindInput() {
        const canvas = this.canvas;
        const pointers = new Map();
        let drag = null;
        let pinch = null;

        const local = (event) => {
            const box = canvas.getBoundingClientRect();

            return { x: event.clientX - box.left, y: event.clientY - box.top };
        };

        canvas.addEventListener("pointerdown", (event) => {
            canvas.setPointerCapture?.(event.pointerId);
            pointers.set(event.pointerId, local(event));

            if (pointers.size === 1) {
                const at = local(event);

                drag = { x: at.x, y: at.y, cx: this.cam.x, cy: this.cam.y, moved: 0 };
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];

                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
                drag = null;
            }
        });

        canvas.addEventListener("pointermove", (event) => {
            if (!pointers.has(event.pointerId)) {
                return;
            }

            pointers.set(event.pointerId, local(event));

            if (pinch && pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);

                this.zoomAt(
                    (a.x + b.x) / 2,
                    (a.y + b.y) / 2,
                    (pinch.z * (d / pinch.d)) / this.cam.z,
                );

                return;
            }

            if (drag) {
                const at = local(event);

                drag.moved = Math.max(drag.moved, Math.hypot(at.x - drag.x, at.y - drag.y));

                if (drag.moved > 4) {
                    this.goal = null;
                    this.cam.x = drag.cx - (at.x - drag.x) / this.cam.z;
                    this.cam.y = drag.cy - (at.y - drag.y) / this.cam.z;
                    canvas.style.cursor = "grabbing";
                }
            }
        });

        const up = (event) => {
            const wasTap = drag && drag.moved <= 6 && pointers.size === 1;
            const at = local(event);

            pointers.delete(event.pointerId);
            canvas.style.cursor = "";

            if (pointers.size < 2) {
                pinch = null;
            }

            if (wasTap) {
                this.select(this.pick(at.x, at.y));
            }

            drag = null;
        };

        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", (event) => {
            pointers.delete(event.pointerId);
            drag = null;
            pinch = null;
        });
        canvas.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();

                const at = local(event);

                this.zoomAt(at.x, at.y, Math.exp(-event.deltaY * 0.0015));
            },
            { passive: false },
        );
    }

    pick(sx, sy) {
        const at = this.toWorld(sx, sy);
        let best = null;
        let bestD = Infinity;

        for (const hit of this.hits) {
            // Far out, small things still take a finger: at least 14 pixels across.
            const least = 14 / this.cam.z;
            const d = Math.hypot(
                (at.x - hit.x) / Math.max(hit.rx, least),
                (at.y - hit.y) / Math.max(hit.ry, least),
            );

            if (d < 1 && d + hit.prio < bestD) {
                best = hit.ref;
                bestD = d + hit.prio;
            }
        }

        return best;
    }

    select(ref) {
        this.selected = ref;
        this.onSelect?.(ref);
    }

    // ——— what the page shows ———

    /** The light to draw: the night during a night replay, else the owner's choice. */
    get skyMode() {
        return this.replay?.night ? "night" : this.sky;
    }

    /** The desert's time: the last event's during a replay, else `now`. Reads the wall clock only when live. */
    clock(now) {
        return this.replay ? this.model.lastAt : (now ?? Date.now());
    }

    stats() {
        const now = Date.now();
        let homes = 0;
        let helpers = 0;
        let active = 0;
        let tokens = 0;
        let cost = 0;

        // A session that went quiet leaves the map while the page stays open. Once a minute is enough, and the
        // layout compares its key before it does any work.
        if (now - this.prunedAt > 60_000) {
            this.prunedAt = now;
            this.layout();
        }

        for (const agent of this.agents.values()) {
            agent.kind === "subagent" ? helpers++ : homes++;
            tokens += (agent.conv.tin ?? 0) + (agent.conv.tout ?? 0);
            cost += agent.conv.cost ?? 0;

            if (this.model.isBusy(agent.id, this.clock(now))) {
                active++;
            }
        }

        const since = this.clock(now) - 60_000;

        this.toolTimes = this.toolTimes.filter((at) => at >= now - 120_000 || this.replay);

        return {
            homes,
            helpers,
            active,
            perMinute: this.toolTimes.filter((at) => at >= since && at <= since + 60_000).length,
            tokens,
            cost,
            storm: this.model.storm,
            time: timeWord(skyAt(now, this.skyMode)),
            replay: this.replay ? Math.round((this.replay.progress ?? 0) * 100) : null,
            replayAt: this.replay ? this.model.lastAt : null,
            night: Boolean(this.replay?.night),
        };
    }

    /** What the selected thing is, for its sheet. */
    selection() {
        const ref = this.selected;

        if (!ref) {
            return null;
        }

        if (ref.type === "agent") {
            const agent = this.agents.get(ref.id);

            if (!agent) {
                return null;
            }

            const conv = agent.conv;
            const busy = this.model.busy.get(agent.id);
            const tasks = (this.model.tasks.get(agent.id) ?? []).map((task) => this.taskInfo(task));
            const helpers = [...this.agents.values()]
                .filter((each) => each.conv.parent === agent.id)
                .map((each) => ({
                    id: each.id,
                    name: each.cast.name,
                    title: each.cast.title,
                    kind: each.kind,
                }));
            const parent = conv.parent ? this.agents.get(conv.parent) : null;

            return {
                type: "agent",
                id: agent.id,
                conv,
                cast: agent.cast,
                home: homeWord(agent.cast, agent.kind),
                busy: this.model.isBusy(agent.id, this.clock()),
                doing: busy?.l ?? (busy?.k === "think" ? "consulting the spice" : null),
                tasks,
                helpers,
                parent: parent ? { id: parent.id, name: parent.cast.name } : null,
            };
        }

        if (ref.type === "place") {
            const place = this.places.get(ref.key);

            if (!place) {
                return null;
            }

            const res = this.data.res?.[ref.key];
            const visitors = Object.entries(res?.by ?? {})
                .filter(([id]) => this.agents.has(id))
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => ({ id, n, name: this.agents.get(id).cast.name }));
            const items = Object.entries(res?.items ?? {})
                .sort((a, b) => b[1].last - a[1].last)
                .slice(0, 24)
                .map(([name, item]) => ({ name, n: item.n, w: item.w ?? 0 }));
            const humans = ref.key === "citadel" ? Object.values(this.data.humans ?? {}) : [];

            return {
                type: "place",
                key: ref.key,
                def: place.def,
                count: res?.count ?? 0,
                last: res?.last,
                visitors,
                items,
                humans,
            };
        }

        if (ref.type === "task") {
            const task = (this.model.tasks.get(ref.owner) ?? []).find((each) => each.id === ref.id);

            return task ? { type: "task", ...this.taskInfo(task) } : null;
        }

        return null;
    }

    taskInfo(task) {
        const style = task.state === "building" ? null : styleOf(task);
        const owner = this.agents.get(task.owner);

        return {
            id: task.id,
            owner: task.owner,
            ownerName: owner?.cast.name ?? `#${task.owner}`,
            title: task.title,
            from: task.from ? this.model.nameOf(task.from, this.names) : null,
            via: task.via,
            state: task.state,
            style: style ? (STYLE[style] ?? STYLE.mixed) : null,
            start: task.start,
            end: task.end,
            calls: task.calls,
            fails: task.fails,
            cost: task.cost,
            tokens: task.tokens,
            parts: Object.entries(task.parts).map(([part, n]) => ({
                part,
                n,
                label: PART[part]?.label ?? part,
                color: PART_COLOR[part],
            })),
            files: task.files,
            hosts: task.hosts,
            helpers: task.helpers.map((id) => this.agents.get(id)?.cast.name ?? `#${id}`),
            log: task.log
                .slice(-12)
                .map((entry) => ({ ...entry, who: this.agents.get(entry.c)?.cast.name })),
        };
    }

    get chronicle() {
        return this.model.chronicle;
    }

    get chronicleVersion() {
        return this.model.version;
    }

    // ——— the loop ———

    start() {
        const frame = (now) => {
            if (this.stopped) {
                return;
            }

            this.raf = requestAnimationFrame(frame);
            this.update(now);
            this.draw(now);
        };

        this.stopped = false;
        this.raf = requestAnimationFrame(frame);
    }

    stop() {
        this.stopped = true;
        cancelAnimationFrame(this.raf);
    }

    update(now) {
        const dt = Math.min(0.05, (now - (this.lastFrame ?? now)) / 1000);

        this.lastFrame = now;
        this.stepReplay(now);

        if (this.goal) {
            const k = 1 - Math.exp(-dt * 6);

            this.cam.x = lerp(this.cam.x, this.goal.x, k);
            this.cam.y = lerp(this.cam.y, this.goal.y, k);
            this.cam.z = lerp(this.cam.z, this.goal.z, k);

            if (
                Math.abs(this.cam.z - this.goal.z) < 0.002 &&
                Math.abs(this.cam.x - this.goal.x) < 0.5
            ) {
                this.goal = null;
            }
        }

        this.storm = lerp(this.storm, this.model.storm ? 1 : 0, 1 - Math.exp(-dt * 1.5));

        // The agents walk, leaving footprints; one who thinks draws spice from the fields.
        for (const agent of this.agents.values()) {
            if (agent.state === "walk") {
                const t = clamp((now - agent.t0) / agent.dur, 0, 1);
                const e = ease(t);

                agent.pos = {
                    x: lerp(agent.from.x, agent.to.x, e),
                    y: lerp(agent.from.y, agent.to.y, e),
                };

                if (
                    dist(agent.pos, agent.lastPrint) > (agent.kind === "subagent" ? 9 : 12) &&
                    !this.calm
                ) {
                    const dx = agent.to.x - agent.from.x;
                    const dy = agent.to.y - agent.from.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const side = (agent.printSide = agent.printSide ? 0 : 1) ? 1 : -1;

                    this.fx.prints.push({
                        x: agent.pos.x - (dy / len) * 3 * side,
                        y: agent.pos.y + (dx / len) * 3 * side,
                        t0: now,
                        a: Math.atan2(dy, dx),
                        worm: agent.cast.special === "worm",
                    });
                    agent.lastPrint = { ...agent.pos };
                }

                if (t >= 1) {
                    agent.state = agent.then ?? "home";
                }
            }

            if (agent.spiceUntil > now && !this.calm && Math.random() < dt * 9) {
                const field = this.places.get(`model:${agent.pv ?? agent.conv.provider}`);

                field && this.fx.motes.push(this.mote(field, agent.pos, now, 1600));
            }
        }

        // Ambient worms, now and then; more often in a storm.
        if (now > this.nextWorm && !this.calm) {
            this.summonWorm();
            this.nextWorm = now + (this.model.storm ? 12_000 : 40_000 + Math.random() * 50_000);
        }

        const alive = (list, life) => {
            let write = 0;

            for (const item of list) {
                if (now - item.t0 < (item.dur ?? life)) {
                    list[write++] = item;
                }
            }

            list.length = write;
        };

        alive(this.fx.prints, 9000);
        alive(this.fx.motes);
        alive(this.fx.bricks);
        alive(this.fx.thopters);
        alive(this.fx.worms);
        alive(this.fx.dust);
        alive(this.fx.ships);

        if (this.fx.prints.length > 1500) {
            this.fx.prints.splice(0, this.fx.prints.length - 1500);
        }

        if (this.fx.motes.length > 900) {
            this.fx.motes.splice(0, this.fx.motes.length - 900);
        }

        for (const agent of this.agents.values()) {
            agent.pops = agent.pops.filter((pop) => now - pop.t0 < 1600);
        }
    }

    // ——— drawing ———

    draw(now) {
        const { ctx, view, cam } = this;
        const sky = skyAt(Date.now(), this.skyMode);

        this.sun = sky;

        if (!this.bg) {
            this.paintDunes();
        }

        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.fillStyle = "#c98e55";
        ctx.fillRect(0, 0, view.w, view.h);

        const z = cam.z * view.dpr;

        ctx.setTransform(
            z,
            0,
            0,
            z,
            (view.w / 2 - cam.x * cam.z) * view.dpr,
            (view.h / 2 - cam.y * cam.z) * view.dpr,
        );
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.bg, this.bounds.x, this.bounds.y, this.bounds.w, this.bounds.h);

        this.hits = [];
        this.drawTrails(now);
        this.drawPrints(now);

        for (const place of this.places.values()) {
            if (place.def.draw === "spice") {
                this.drawSpiceField(place, now);
            }
        }

        // Everything that stands, back to front; a worm stands where its head is.
        const items = [];

        for (const worm of this.fx.worms) {
            const t = (now - worm.t0) / worm.dur;

            items.push({
                y: lerp(worm.from.y, worm.to.y, t),
                draw: () => this.drawWorm(worm, now, sky),
            });
        }

        for (const place of this.places.values()) {
            place.def.draw !== "spice" &&
                items.push({ y: place.y, draw: () => this.drawPlace(place, now, sky) });
        }

        for (const agent of this.agents.values()) {
            if (agent.rock) {
                items.push({ y: agent.rock.y, draw: () => this.drawSietch(agent, now, sky) });
            }

            if (agent.tent) {
                items.push({ y: agent.tent.y, draw: () => this.drawTent(agent, now, sky) });
            }

            items.push({ y: agent.pos.y + 2, draw: () => this.drawAgent(agent, now, sky) });
        }

        for (const [owner, lots] of this.lots) {
            const tasks = this.model.tasks.get(owner) ?? [];

            tasks.forEach((task, index) => {
                const lot = lots[index];

                lot &&
                    items.push({
                        y: lot.y,
                        draw: () => this.drawStructure(task, lot, now, sky, owner),
                    });
            });
        }

        items.sort((a, b) => a.y - b.y);
        items.forEach((item) => item.draw());

        this.drawDust(now);
        this.drawBricks(now);
        this.drawMotes(now);
        this.drawShips(now);
        this.drawThopters(now);
        this.drawSelection(now);

        // The light of the hour, then what glows in it.
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        this.drawSky(sky, now);
        ctx.setTransform(
            z,
            0,
            0,
            z,
            (view.w / 2 - cam.x * cam.z) * view.dpr,
            (view.h / 2 - cam.y * cam.z) * view.dpr,
        );
        this.drawLights(sky, now);
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        this.drawStorm(now);
        this.drawLabels(now, sky);
    }

    /** A soft shadow at a foot, cast away from the sun (long at dusk, none at night). */
    shadow(x, y, w, h = w * 0.35, height = 20) {
        const { ctx } = this;
        const sky = this.sun;
        const strength = (1 - sky.night) * 0.28;

        if (strength <= 0.01) {
            return;
        }

        const length = height * (0.4 + sky.dusk * 1.6);
        const angle = Math.PI * 0.15 + Math.sin(sky.angle) * 0.9;
        const ox = Math.cos(angle) * length;
        const oy = Math.sin(angle) * length * 0.35;

        ctx.save();
        ctx.fillStyle = `rgba(70,30,10,${strength})`;
        ctx.beginPath();
        ctx.ellipse(
            x + ox / 2,
            y + oy / 2,
            w / 2 + Math.abs(ox) / 2,
            h / 2 + Math.abs(oy) / 3,
            Math.atan2(oy, ox) * 0.3,
            0,
            TAU,
        );
        ctx.fill();
        ctx.restore();
    }

    hit(x, y, rx, ry, ref, prio = 0) {
        this.hits.push({ x, y, rx, ry, ref, prio });
    }

    drawTrails() {
        const { ctx } = this;
        const citadel = this.places.get("citadel");

        ctx.save();
        ctx.lineCap = "round";

        for (const agent of this.agents.values()) {
            if (!agent.rock) {
                continue;
            }

            const parent = agent.conv.parent ? this.agents.get(agent.conv.parent) : null;
            const to = parent?.rock ? parent.home : citadel;

            if (!to) {
                continue;
            }

            ctx.strokeStyle = parent ? "rgba(90,45,20,0.22)" : "rgba(110,60,25,0.16)";
            ctx.lineWidth = parent ? 5 : 9;
            ctx.setLineDash(parent ? [2, 14] : []);
            ctx.beginPath();
            ctx.moveTo(agent.home.x, agent.home.y);

            const mx = (agent.home.x + to.x) / 2 + (agent.home.y - to.y) * 0.12;
            const my = (agent.home.y + to.y) / 2 - (agent.home.x - to.x) * 0.12;

            ctx.quadraticCurveTo(mx, my, to.x, to.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPrints(now) {
        const { ctx } = this;

        ctx.save();

        for (const print of this.fx.prints) {
            const age = (now - print.t0) / 9000;

            ctx.fillStyle = `rgba(95,48,20,${0.35 * (1 - age)})`;
            ctx.beginPath();
            ctx.ellipse(print.x, print.y, 2.2, 1.3, print.a, 0, TAU);
            ctx.fill();

            if (print.worm) {
                // A worm-rider's wake: rings in the sand.
                ctx.strokeStyle = `rgba(120,60,25,${0.25 * (1 - age)})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.ellipse(print.x, print.y + 6, 6 + age * 30, 3 + age * 14, 0, 0, TAU);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    drawSpiceField(place, now) {
        const { ctx } = this;
        const random = rng(place.seed);
        const color = "#e0782a";
        const busy = [...this.agents.values()].some(
            (agent) =>
                agent.spiceUntil > now && (agent.pv ?? agent.conv.provider) === place.def.provider,
        );

        ctx.save();

        for (let index = 0; index < 14; index++) {
            const r = 80 * Math.sqrt(random());
            const angle = random() * TAU;
            const x = place.x + Math.cos(angle) * r;
            const y = place.y + Math.sin(angle) * r * 0.6;
            const size = 18 + random() * 30;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);

            gradient.addColorStop(0, alpha(color, 0.55));
            gradient.addColorStop(1, alpha(color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(x, y, size, size * 0.6, 0, 0, TAU);
            ctx.fill();
        }

        // Sparkles of melange.
        for (let index = 0; index < 22; index++) {
            const r = 85 * Math.sqrt(random());
            const angle = random() * TAU;
            const twinkle = 0.5 + 0.5 * Math.sin(now / 300 + index * 1.7);

            ctx.fillStyle = `rgba(255,200,120,${0.25 + twinkle * 0.6})`;
            ctx.fillRect(
                place.x + Math.cos(angle) * r,
                place.y + Math.sin(angle) * r * 0.6,
                1.6,
                1.6,
            );
        }

        // The harvester crawls while someone draws from this field.
        place.harvester = (place.harvester ?? 0) + (busy ? 0.004 : 0.0006);

        const hx = place.x + Math.cos(place.harvester) * 46;
        const hy = place.y + Math.sin(place.harvester) * 22;

        this.shadow(hx, hy + 6, 34, 10, 16);
        ctx.fillStyle = "#5a4630";
        ctx.fillRect(hx - 15, hy - 10, 30, 14);
        ctx.fillStyle = "#7c6446";
        ctx.fillRect(hx - 13, hy - 16, 26, 7);
        ctx.fillStyle = "#3a2c1d";
        ctx.fillRect(hx - 16, hy + 2, 32, 4);
        ctx.fillStyle = busy ? "#ffb35a" : "#c08a50";
        ctx.fillRect(hx + 8, hy - 14, 4, 3);

        if (busy && !this.calm) {
            // A spice blow: a column of orange dust from the deep.
            for (let index = 0; index < 12; index++) {
                const t = (now / 1600 + index / 12) % 1;
                const x = place.x - 30 + Math.sin(index * 3.1 + now / 700) * 10 * t;
                const y = place.y - t * 130;

                ctx.fillStyle = `rgba(232,120,40,${0.35 * (1 - t)})`;
                ctx.beginPath();
                ctx.arc(x, y, 6 + t * 22, 0, TAU);
                ctx.fill();
            }
        }

        ctx.restore();
        this.hit(place.x, place.y, 95, 60, { type: "place", key: place.key }, 0.3);
    }

    drawWorm(worm, now, sky) {
        const { ctx } = this;
        const t = (now - worm.t0) / worm.dur;
        const head = { x: lerp(worm.from.x, worm.to.x, t), y: lerp(worm.from.y, worm.to.y, t) };
        const dx = worm.to.x - worm.from.x;
        const dy = worm.to.y - worm.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const s = worm.size;
        const fade = clamp(Math.min(t, 1 - t) * 8, 0, 1);

        ctx.save();
        ctx.globalAlpha = fade;

        // The trail: a dark furrow and a ridge of disturbed sand behind the head.
        ctx.strokeStyle = "rgba(110,55,22,0.35)";
        ctx.lineWidth = 26 * s;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(head.x - ux * 420 * s, head.y - uy * 420 * s);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(250,215,160,0.35)";
        ctx.lineWidth = 6 * s;
        ctx.stroke();

        if (worm.rise && t > 0.3 && t < 0.62) {
            // Shai-Hulud rises: a great ringed column, mouth to the sky.
            const r = Math.sin(((t - 0.3) / 0.32) * Math.PI);
            const height = 190 * s * r;
            const width = 34 * s;
            const x = head.x;
            const y = head.y;

            this.shadow(x, y + 4, width * 3, width, height);

            const body = ctx.createLinearGradient(x - width, 0, x + width, 0);

            body.addColorStop(0, "#5b3f29");
            body.addColorStop(0.45, "#a98060");
            body.addColorStop(1, "#4a3020");
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.moveTo(x - width, y);
            ctx.quadraticCurveTo(x - width * 1.1, y - height * 0.6, x - width * 0.9, y - height);
            ctx.lineTo(x + width * 0.9, y - height);
            ctx.quadraticCurveTo(x + width * 1.1, y - height * 0.6, x + width, y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(40,20,10,0.45)";
            ctx.lineWidth = 2;

            for (let ring = 1; ring < 9; ring++) {
                const ry = y - (height * ring) / 9;

                ctx.beginPath();
                ctx.ellipse(x, ry, width * 0.98, 5 * s, 0, 0, Math.PI);
                ctx.stroke();
            }

            // The mouth, with its crystal teeth.
            ctx.fillStyle = "#2a130a";
            ctx.beginPath();
            ctx.ellipse(x, y - height, width * 0.9, width * 0.42, 0, 0, TAU);
            ctx.fill();
            ctx.fillStyle = "#f3e6c8";

            for (let tooth = 0; tooth < 22; tooth++) {
                const angle = (tooth / 22) * TAU;

                ctx.beginPath();
                ctx.arc(
                    x + Math.cos(angle) * width * 0.75,
                    y - height + Math.sin(angle) * width * 0.34,
                    1.6 * s,
                    0,
                    TAU,
                );
                ctx.fill();
            }

            ctx.fillStyle = "rgba(255,150,60,0.4)";
            ctx.beginPath();
            ctx.ellipse(x, y - height, width * 0.4, width * 0.18, 0, 0, TAU);
            ctx.fill();

            // Sand pours from its flanks.
            for (let grain = 0; grain < 18; grain++) {
                const g = (now / 900 + grain / 18) % 1;
                const side = grain % 2 ? 1 : -1;

                ctx.fillStyle = `rgba(230,180,110,${0.7 * (1 - g)})`;
                ctx.fillRect(x + side * (width + g * 14), y - height * (1 - g) + 6, 2, 2);
            }
        } else {
            // Its back breaks the sand in great arcs, then dives again.
            for (let segment = 0; segment < 9; segment++) {
                const phase = now / 380 - segment * 0.7;
                const lift = Math.sin(phase);

                if (lift <= 0) {
                    continue;
                }

                const x = head.x - ux * segment * 30 * s;
                const y = head.y - uy * segment * 30 * s;

                ctx.fillStyle = segment === 0 ? "#8a6448" : "#7a573c";
                ctx.beginPath();
                ctx.ellipse(
                    x,
                    y - lift * 9 * s,
                    17 * s,
                    9 * s * lift + 2,
                    Math.atan2(uy, ux),
                    Math.PI,
                    TAU,
                );
                ctx.fill();
                ctx.strokeStyle = "rgba(40,20,10,0.4)";
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            // Dust ahead of it.
            ctx.fillStyle = "rgba(235,190,130,0.35)";

            for (let puff = 0; puff < 6; puff++) {
                const p = (now / 500 + puff / 6) % 1;

                ctx.beginPath();
                ctx.arc(
                    head.x + ux * 20 * s + (puff - 3) * 6,
                    head.y + uy * 20 * s - p * 18,
                    4 + p * 9,
                    0,
                    TAU,
                );
                ctx.fill();
            }
        }

        ctx.restore();
        void sky;
    }

    // ——— the places ———

    drawPlace(place, now, sky) {
        const { ctx } = this;
        const { x, y } = place;
        const res = this.data.res?.[place.key];
        const hot = res && Date.now() - res.last < 8000;
        const kind = place.def.draw;

        ctx.save();

        switch (kind) {
            case "citadel":
                this.drawCitadel(x, y, now);
                break;
            case "archives":
                this.drawArchives(x, y, hot);
                break;
            case "foundry":
                this.drawFoundry(x, y, hot, now);
                break;
            case "port":
                this.drawPort(x, y, hot, now);
                break;
            case "spire":
                this.drawSpire(x, y, hot, now);
                break;
            case "tanks":
                this.drawTanks(x, y, hot, now);
                break;
            case "vault":
                this.drawVault(x, y, hot, now);
                break;
            case "murals":
                this.drawMurals(x, y, place.seed);
                break;
            case "dial":
                this.drawDial(x, y, now);
                break;
            case "embassy":
                this.drawEmbassy(x, y, place.def.color, now);
                break;
            default:
                this.drawHall(x, y, hot, now);
                break;
        }

        ctx.restore();

        const big = kind === "citadel" ? 1.6 : 1;

        this.hit(x, y - 30 * big, 70 * big, 60 * big, { type: "place", key: place.key }, 0.2);
        void sky;
    }

    /** A block in 2.5D: a front face and a lighter top. */
    block(x, y, w, h, depth, color) {
        const { ctx } = this;

        ctx.fillStyle = shade(color, -0.18);
        ctx.fillRect(x - w / 2, y - h, w, h);
        ctx.fillStyle = shade(color, 0.12);
        ctx.fillRect(x - w / 2, y - h - depth, w, depth);
    }

    dome(x, y, r, color) {
        const { ctx } = this;
        const gradient = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.1, x, y, r);

        gradient.addColorStop(0, shade(color, 0.35));
        gradient.addColorStop(1, shade(color, -0.25));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI, TAU);
        ctx.closePath();
        ctx.fill();
    }

    banner(x, y, height, color, now, width = 10) {
        const { ctx } = this;
        const wave = Math.sin(now / 400 + x) * 2;

        ctx.strokeStyle = "#3b2a1c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - height);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - height);
        ctx.lineTo(x + width + wave, y - height + 3);
        ctx.lineTo(x + width - 2 + wave, y - height + 9);
        ctx.lineTo(x, y - height + 12);
        ctx.closePath();
        ctx.fill();
    }

    drawCitadel(x, y, now) {
        const { ctx } = this;
        const stone = "#c9a57a";

        this.shadow(x, y + 4, 230, 60, 90);
        this.block(x, y, 220, 26, 30, shade(stone, -0.08));
        this.block(x, y - 26, 170, 30, 24, stone);
        this.block(x, y - 56, 110, 34, 18, shade(stone, 0.06));
        this.dome(x, y - 108, 30, "#d9b88c");
        this.dome(x - 62, y - 80, 16, "#cfae82");
        this.dome(x + 62, y - 80, 16, "#cfae82");
        // A tall needle tower.
        this.block(x + 90, y - 26, 16, 70, 6, shade(stone, -0.05));
        this.dome(x + 90, y - 102, 9, "#d9b88c");
        ctx.fillStyle = "#2b1a10";

        for (let index = -3; index <= 3; index++) {
            ctx.fillRect(x + index * 22 - 4, y - 18, 8, 12);
        }

        ctx.fillRect(x - 10, y - 48, 20, 22);
        this.banner(x, y - 138, 26, "#2f6b3b", now, 16);
        this.banner(x - 62, y - 96, 16, "#e3c25a", now);
        this.banner(x + 62, y - 96, 16, "#e3c25a", now);
    }

    drawArchives(x, y, hot) {
        const { ctx } = this;
        const stone = "#d8c29a";

        this.shadow(x, y + 3, 120, 34, 50);
        this.block(x, y, 116, 10, 12, shade(stone, -0.1));
        // Columns.
        for (let index = 0; index < 6; index++) {
            const cx = x - 48 + index * 19.2;

            ctx.fillStyle = shade(stone, index % 2 ? -0.05 : 0.04);
            ctx.fillRect(cx - 4, y - 52, 8, 42);
        }

        ctx.fillStyle = shade(stone, 0.1);
        ctx.beginPath();
        ctx.moveTo(x - 62, y - 52);
        ctx.lineTo(x, y - 78);
        ctx.lineTo(x + 62, y - 52);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hot ? "#ffd27a" : "#6b4a2a";
        ctx.beginPath();
        ctx.arc(x, y - 62, 5, 0, TAU);
        ctx.fill();
    }

    drawFoundry(x, y, hot, now) {
        const { ctx } = this;
        const metal = "#7d8894";

        this.shadow(x, y + 3, 120, 34, 60);
        this.block(x - 12, y, 90, 40, 18, metal);
        this.block(x + 38, y, 26, 82, 10, shade(metal, -0.1));
        // Gears.
        ctx.save();
        ctx.translate(x - 30, y - 22);
        ctx.rotate(now / (hot ? 300 : 1800));
        ctx.strokeStyle = "#c9d4de";
        ctx.lineWidth = 3;

        for (let tooth = 0; tooth < 8; tooth++) {
            ctx.rotate(TAU / 8);
            ctx.beginPath();
            ctx.moveTo(0, 7);
            ctx.lineTo(0, 12);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, TAU);
        ctx.stroke();
        ctx.restore();
        // The furnace mouth.
        ctx.fillStyle = hot ? "#ff8a2a" : "#4a2a18";
        ctx.fillRect(x + 2, y - 26, 20, 18);

        if (hot && !this.calm) {
            for (let puff = 0; puff < 5; puff++) {
                const t = (now / 1400 + puff / 5) % 1;

                ctx.fillStyle = `rgba(90,90,100,${0.4 * (1 - t)})`;
                ctx.beginPath();
                ctx.arc(x + 38 + t * 20, y - 96 - t * 50, 5 + t * 12, 0, TAU);
                ctx.fill();
            }
        }
    }

    drawPort(x, y, hot, now) {
        const { ctx } = this;

        this.shadow(x, y + 2, 150, 40, 10);
        ctx.fillStyle = "#6e5a46";
        ctx.beginPath();
        ctx.ellipse(x, y - 4, 74, 30, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = hot ? "#ffa64a" : "#c08a50";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.ellipse(x, y - 4, 60, 23, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        // The Guild's sign: a fold of space.
        ctx.strokeStyle = "#ffcf8a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y - 4, 16, 6, now / 2000, 0, TAU);
        ctx.ellipse(x, y - 4, 6, 16 * 0.4, now / 2000, 0, TAU);
        ctx.stroke();
        // A control tower.
        this.block(x + 70, y - 2, 14, 56, 6, "#8c7356");
        ctx.fillStyle = hot ? "#ffb35a" : "#a07a4a";
        ctx.fillRect(x + 64, y - 64, 12, 5);
    }

    drawSpire(x, y, hot, now) {
        const { ctx } = this;
        const stone = "#b99a74";

        this.shadow(x, y + 3, 50, 18, 130);
        ctx.fillStyle = shade(stone, -0.12);
        ctx.beginPath();
        ctx.moveTo(x - 20, y);
        ctx.lineTo(x - 7, y - 120);
        ctx.lineTo(x + 7, y - 120);
        ctx.lineTo(x + 20, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(stone, 0.08);
        ctx.beginPath();
        ctx.moveTo(x - 20, y);
        ctx.lineTo(x - 7, y - 120);
        ctx.lineTo(x - 2, y - 120);
        ctx.lineTo(x - 8, y);
        ctx.closePath();
        ctx.fill();

        const pulse = 0.6 + 0.4 * Math.sin(now / (hot ? 180 : 900));
        const glow = ctx.createRadialGradient(x, y - 130, 0, x, y - 130, 20);

        glow.addColorStop(0, `rgba(160,230,255,${0.9 * pulse})`);
        glow.addColorStop(1, "rgba(80,170,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y - 130, 20, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#dff6ff";
        ctx.beginPath();
        ctx.arc(x, y - 130, 5, 0, TAU);
        ctx.fill();
    }

    drawTanks(x, y, hot, now) {
        const { ctx } = this;

        this.shadow(x, y + 3, 120, 30, 40);

        for (let index = 0; index < 4; index++) {
            const tx = x - 45 + index * 30;
            const bubble = (now / 900 + index * 0.3) % 1;

            ctx.fillStyle = "#4e5636";
            ctx.fillRect(tx - 11, y - 8, 22, 8);
            ctx.fillStyle = hot ? "rgba(170,230,120,0.75)" : "rgba(120,160,90,0.6)";
            ctx.beginPath();
            ctx.roundRect(tx - 10, y - 46, 20, 38, 9);
            ctx.fill();
            ctx.fillStyle = "rgba(240,255,220,0.6)";
            ctx.beginPath();
            ctx.arc(tx + 2, y - 12 - bubble * 30, 2, 0, TAU);
            ctx.fill();
        }
    }

    drawVault(x, y, hot, now) {
        const { ctx } = this;

        this.shadow(x, y + 3, 100, 30, 50);
        this.block(x, y, 92, 16, 10, "#8e7a9a");
        this.dome(x, y - 26, 40, "#9d86ab");

        const pulse = 0.5 + 0.5 * Math.sin(now / (hot ? 200 : 1200));

        ctx.strokeStyle = `rgba(220,190,255,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 38);
        ctx.lineTo(x, y - 52);
        ctx.lineTo(x + 8, y - 38);
        ctx.moveTo(x, y - 52);
        ctx.lineTo(x, y - 30);
        ctx.stroke();
    }

    drawMurals(x, y, seed) {
        const { ctx } = this;
        const random = rng(seed);

        this.shadow(x, y + 3, 120, 30, 60);
        this.rock(x, y, 120, 58, seed, "#8a6244");
        ctx.fillStyle = "#1f120b";
        ctx.beginPath();
        ctx.ellipse(x, y - 12, 26, 18, 0, Math.PI, TAU);
        ctx.fill();

        // Hands in ochre and blue, painted on the rock.
        for (let index = 0; index < 6; index++) {
            ctx.fillStyle = ["#e0782a", "#4fb2ff", "#f3e2b5"][index % 3];
            ctx.beginPath();
            ctx.arc(x - 48 + random() * 96, y - 30 - random() * 22, 3.5, 0, TAU);
            ctx.fill();
        }
    }

    drawDial(x, y, now) {
        const { ctx } = this;

        this.shadow(x, y + 2, 110, 36, 10);
        ctx.fillStyle = "#b99b76";
        ctx.beginPath();
        ctx.ellipse(x, y - 6, 52, 22, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#5b4330";
        ctx.lineWidth = 1.5;

        for (let mark = 0; mark < 12; mark++) {
            const angle = (mark / 12) * TAU;

            ctx.beginPath();
            ctx.moveTo(x + Math.cos(angle) * 40, y - 6 + Math.sin(angle) * 16);
            ctx.lineTo(x + Math.cos(angle) * 48, y - 6 + Math.sin(angle) * 20);
            ctx.stroke();
        }

        // The two moons, on their arms.
        const first = now / 9000;
        const second = now / 5200;

        ctx.fillStyle = "#f2efe6";
        ctx.beginPath();
        ctx.arc(x + Math.cos(first) * 30, y - 34 + Math.sin(first) * 6, 7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#c9d6e8";
        ctx.beginPath();
        ctx.arc(x + Math.cos(second) * 20, y - 30 + Math.sin(second) * 4, 4.5, 0, TAU);
        ctx.fill();
    }

    drawEmbassy(x, y, color, now) {
        const { ctx } = this;

        this.shadow(x, y + 3, 100, 30, 50);
        ctx.fillStyle = "#e9d8b8";
        ctx.beginPath();
        ctx.moveTo(x - 50, y);
        ctx.lineTo(x - 30, y - 46);
        ctx.lineTo(x + 30, y - 46);
        ctx.lineTo(x + 50, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;

        for (let stripe = 0; stripe < 3; stripe++) {
            ctx.beginPath();
            ctx.moveTo(x - 50 + stripe * 36, y);
            ctx.lineTo(x - 30 + stripe * 24, y - 46);
            ctx.lineTo(x - 22 + stripe * 24, y - 46);
            ctx.lineTo(x - 38 + stripe * 36, y);
            ctx.closePath();
            ctx.fill();
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = "#2a1a10";
        ctx.fillRect(x - 8, y - 20, 16, 20);
        this.banner(x - 30, y - 46, 26, color, now, 14);
        this.banner(x + 30, y - 46, 26, color, now, 14);
    }

    drawHall(x, y, hot, now) {
        const { ctx } = this;
        const stone = "#bfa07a";

        this.shadow(x, y + 3, 130, 34, 50);
        this.block(x, y, 126, 44, 22, stone);
        ctx.fillStyle = "#2c1b10";

        for (let index = -2; index <= 2; index++) {
            ctx.beginPath();
            ctx.roundRect(x + index * 24 - 6, y - 32, 12, 24, [6, 6, 0, 0]);
            ctx.fill();
        }

        const colors = ["#2f6b3b", "#c8372d", "#f0c04a", "#4fb2ff", "#b48cff"];

        colors.forEach((color, index) =>
            this.banner(x - 52 + index * 26, y - 66, 18, color, now, 9),
        );

        if (hot) {
            ctx.fillStyle = "rgba(255,210,120,0.6)";
            ctx.fillRect(x - 60, y - 70, 120, 3);
        }
    }

    /** A rock outcrop: a mesa of layered stone, the same every time for its seed. */
    rock(x, y, w, h, seed, color) {
        const { ctx } = this;
        const random = rng(seed);
        const top = [];
        const count = 9;

        for (let index = 0; index <= count; index++) {
            const t = index / count;
            const edge = Math.sin(t * Math.PI);

            top.push({
                x: x - w / 2 + t * w,
                y: y - h * (0.35 + edge * 0.65) - random() * 10 * edge,
            });
        }

        // The face.
        const face = ctx.createLinearGradient(0, y - h, 0, y);

        face.addColorStop(0, shade(color, 0.12));
        face.addColorStop(1, shade(color, -0.3));
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 8, y);
        top.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.lineTo(x + w / 2 + 8, y);
        ctx.closePath();
        ctx.fill();

        // Strata.
        ctx.strokeStyle = shade(color, -0.35);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.2;

        for (let layer = 1; layer < 4; layer++) {
            const ly = y - (h * layer) / 4.2;

            ctx.beginPath();
            ctx.moveTo(x - w / 2 + layer * 4, ly + random() * 3);
            ctx.bezierCurveTo(
                x - w / 6,
                ly - 3,
                x + w / 6,
                ly + 4,
                x + w / 2 - layer * 4,
                ly + random() * 3,
            );
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        // A lit rim along the top.
        ctx.strokeStyle = shade(color, 0.35);
        ctx.lineWidth = 2;
        ctx.beginPath();
        top.forEach((point, index) =>
            index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
        );
        ctx.stroke();

        return top;
    }

    // ——— the agents' homes ———

    drawSietch(agent, now, sky) {
        const { ctx } = this;
        const { x, y } = agent.rock;
        const cast = agent.cast;
        const busy = this.model.isBusy(agent.id, this.clock());
        const w = agent.kind === "linked" ? 160 : 190;
        const h = agent.kind === "linked" ? 74 : 90;

        this.shadow(x, y + 4, w + 30, 34, h);

        const top = this.rock(
            x,
            y,
            w,
            h,
            agent.seed,
            cast.factionKey === "harkonnen" ? "#5a4a44" : "#8b5f3e",
        );

        // The cave mouth, lit from within.
        ctx.fillStyle = "#1a0d07";
        ctx.beginPath();
        ctx.moveTo(x - 16, y);
        ctx.quadraticCurveTo(x - 17, y - 32, x, y - 34);
        ctx.quadraticCurveTo(x + 17, y - 32, x + 16, y);
        ctx.closePath();
        ctx.fill();

        const glow = 0.25 + sky.night * 0.6 + (busy ? 0.25 : 0);

        ctx.fillStyle = `rgba(255,150,60,${glow})`;
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.quadraticCurveTo(x - 10, y - 22, x, y - 24);
        ctx.quadraticCurveTo(x + 10, y - 22, x + 10, y);
        ctx.closePath();
        ctx.fill();

        // A windtrap on the summit, and the faction's banner.
        const peak = top[Math.floor(top.length / 2)];
        const trap = top[Math.floor(top.length / 2) - 2];

        ctx.fillStyle = "#6f5b47";
        ctx.fillRect(trap.x - 4, trap.y - 22, 8, 22);
        ctx.fillStyle = "#9a8266";

        for (let vane = 0; vane < 3; vane++) {
            ctx.fillRect(trap.x - 7, trap.y - 22 + vane * 6, 14, 2);
        }

        this.banner(peak.x + 14, peak.y + 2, 30, cast.trim, now, 14);

        // A worm-rider keeps a maker hook by her door.
        if (cast.special === "worm") {
            ctx.strokeStyle = "#3b2a1c";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x + 28, y);
            ctx.lineTo(x + 28, y - 34);
            ctx.arc(x + 23, y - 34, 5, 0, Math.PI, true);
            ctx.stroke();
        }

        // The rock, and the name and words under it.
        this.hit(x, y - h / 4, w / 2 + 10, h * 0.75 + 30, { type: "agent", id: agent.id }, 0.4);
    }

    drawTent(agent, now, sky) {
        const { ctx } = this;
        const { x, y } = agent.tent;
        const color = agent.cast.robe.startsWith("#") ? agent.cast.robe : "#7a5a3a";

        this.shadow(x, y + 2, 40, 12, 18);
        ctx.fillStyle = shade(color, 0.25);
        ctx.beginPath();
        ctx.moveTo(x - 20, y);
        ctx.quadraticCurveTo(x - 14, y - 26, x, y - 26);
        ctx.quadraticCurveTo(x + 14, y - 26, x + 20, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(color, -0.2);
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x, y - 14);
        ctx.lineTo(x + 5, y);
        ctx.fill();
        ctx.fillStyle = `rgba(255,170,80,${0.15 + sky.night * 0.5})`;
        ctx.fillRect(x - 2, y - 7, 4, 7);
        void now;
    }

    // ——— the structures of each task ———

    drawStructure(task, lot, now, sky, owner) {
        const { ctx } = this;
        const building = task.state === "building";
        const style = task.state === "ruin" ? "ruin" : styleOf(task);
        const random = rng(task.seed * 7919);
        const size = clamp(0.55 + Math.sqrt(task.calls) * 0.14, 0.6, 1.5);
        const growth = building ? clamp(0.25 + task.calls / 20, 0.25, 0.9) : 1;
        const stone = ["#d7b98e", "#c9a57a", "#bfa284", "#d4b08a", "#b9946c"][
            Math.floor(random() * 5)
        ];
        const accent = `hsl(${Math.floor(random() * 360)} 55% 55%)`;
        const { x, y } = lot;
        const h = 60 * size * growth;

        this.shadow(x, y + 3, 54 * size, 16 * size, h);
        ctx.save();

        switch (building ? (task.calls === 0 ? "site" : style) : style) {
            case "site":
                ctx.strokeStyle = "rgba(70,40,20,0.5)";
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(x - 22, y - 10, 44, 10);
                ctx.setLineDash([]);
                break;
            case "read":
                for (let tier = 0; tier < 4; tier++) {
                    const tw = (28 - tier * 5) * size;

                    this.block(x, y - (h * tier) / 4, tw, h / 4 - 2, 4, shade(stone, tier * 0.04));
                }

                ctx.fillStyle = accent;
                ctx.fillRect(x - 3, y - h - 10, 6, 10);
                break;
            case "write":
                this.block(x, y, 22 * size, h, 6, stone);
                ctx.fillStyle = shade(stone, -0.35);

                for (let vane = 0; vane < 5; vane++) {
                    ctx.fillRect(x - 11 * size + vane * 5 * size, y - h + 4, 2, h - 8);
                }

                this.dome(x, y - h - 6, 13 * size, "#7fc8ff");
                break;
            case "shell":
                this.block(x, y, 40 * size, h * 0.6, 10, "#8b97a4");
                this.block(x + 14 * size, y - h * 0.6, 8, h * 0.4, 4, "#6f7a86");
                ctx.strokeStyle = "#d8e2ea";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x - 8 * size, y - h * 0.3, 7 * size, now / 400, now / 400 + 5);
                ctx.stroke();
                break;
            case "web":
                this.block(x, y, 16 * size, h, 4, stone);
                this.block(x, y - h, 26 * size, 8, 4, shade(stone, 0.1));
                ctx.fillStyle = `rgba(150,230,255,${0.6 + 0.4 * Math.sin(now / 500 + task.seed)})`;
                ctx.beginPath();
                ctx.arc(x, y - h - 16, 5 * size, 0, TAU);
                ctx.fill();
                break;
            case "git":
                ctx.fillStyle = shade(stone, -0.15);
                ctx.beginPath();
                ctx.moveTo(x - 12 * size, y);
                ctx.lineTo(x - 4, y - h);
                ctx.lineTo(x + 4, y - h);
                ctx.lineTo(x + 12 * size, y);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = `rgba(255,154,60,${0.6 + 0.4 * Math.sin(now / 300 + task.seed)})`;
                ctx.beginPath();
                ctx.arc(x, y - h - 4, 5, 0, TAU);
                ctx.fill();

                for (let crate = 0; crate < Math.min(4, task.parts.git ?? 0); crate++) {
                    this.block(x + 18 + crate * 9, y, 8, 7, 3, "#8a6a44");
                }

                break;
            case "delegate":
                ctx.fillStyle = "#efe2c4";
                ctx.beginPath();
                ctx.moveTo(x - 32 * size, y);
                ctx.lineTo(x, y - h * 0.8);
                ctx.lineTo(x + 32 * size, y);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = accent;

                for (let stripe = -1; stripe <= 1; stripe++) {
                    ctx.beginPath();
                    ctx.moveTo(x + stripe * 20 * size - 4, y);
                    ctx.lineTo(x, y - h * 0.8);
                    ctx.lineTo(x + stripe * 20 * size + 4, y);
                    ctx.fill();
                }

                break;
            case "mcp":
                this.block(x, y, 52 * size, 12, 18 * size, stone);
                [accent, "#e58bff", "#4fb2ff"].forEach((color, index) =>
                    this.banner(
                        x - 18 * size + index * 18 * size,
                        y - 12 - 18 * size,
                        18,
                        color,
                        now,
                        8,
                    ),
                );
                break;
            case "artifact":
                ctx.strokeStyle = stone;
                ctx.lineWidth = 9 * size;
                ctx.beginPath();
                ctx.arc(x, y - h * 0.5, 18 * size, Math.PI, TAU);
                ctx.moveTo(x - 18 * size, y - h * 0.5);
                ctx.lineTo(x - 18 * size, y);
                ctx.moveTo(x + 18 * size, y - h * 0.5);
                ctx.lineTo(x + 18 * size, y);
                ctx.stroke();
                ctx.strokeStyle = accent;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(x, y - h * 0.5, 18 * size, Math.PI, TAU);
                ctx.stroke();
                break;
            case "memory":
                this.block(x, y, 30 * size, 10, 6, stone);
                this.dome(x, y - 10, 18 * size, "#a993c0");
                ctx.fillStyle = `rgba(220,190,255,${0.5 + 0.5 * Math.sin(now / 700 + task.seed)})`;
                ctx.fillRect(x - 2, y - 22 * size, 4, 8);
                break;
            case "ruin":
                ctx.fillStyle = shade(stone, -0.2);
                ctx.beginPath();
                ctx.moveTo(x - 24, y);
                ctx.lineTo(x - 20, y - 22);
                ctx.lineTo(x - 12, y - 14);
                ctx.lineTo(x - 6, y - 26);
                ctx.lineTo(x + 2, y - 10);
                ctx.lineTo(x + 14, y - 18);
                ctx.lineTo(x + 24, y);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "#d9a466";
                ctx.beginPath();
                ctx.ellipse(x + 4, y, 34, 10, 0, Math.PI, TAU);
                ctx.fill();
                break;
            default:
                // A palace: a bit of everything.
                this.block(x, y, 46 * size, h * 0.45, 12, stone);
                this.dome(x, y - h * 0.45 - 12, 14 * size, shade(stone, 0.1));
                this.dome(x - 16 * size, y - h * 0.45 - 6, 8 * size, "#c9a57a");
                this.dome(x + 16 * size, y - h * 0.45 - 6, 8 * size, "#c9a57a");
                ctx.fillStyle = accent;
                ctx.fillRect(x - 1, y - h * 0.45 - 34 * size, 2, 10);
                break;
        }

        // Cracks, one for each failure.
        if (task.fails > 0 && style !== "ruin") {
            ctx.strokeStyle = "rgba(40,15,5,0.7)";
            ctx.lineWidth = 1;

            for (let crack = 0; crack < Math.min(3, task.fails); crack++) {
                const cx = x - 8 + crack * 8;
                const cy = y - h * 0.3 - crack * 6;

                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + 3, cy + 5);
                ctx.lineTo(cx - 1, cy + 9);
                ctx.lineTo(cx + 2, cy + 13);
                ctx.stroke();
            }
        }

        // Scaffolding while it is built.
        if (building && task.calls > 0) {
            ctx.strokeStyle = "rgba(90,60,30,0.85)";
            ctx.lineWidth = 1.2;

            const sw = 26 * size;
            const sh = h + 10;

            ctx.strokeRect(x - sw, y - sh, sw * 2, sh);
            ctx.beginPath();

            for (let level = 1; level < 4; level++) {
                ctx.moveTo(x - sw, y - (sh * level) / 4);
                ctx.lineTo(x + sw, y - (sh * level) / 4);
            }

            ctx.moveTo(x - sw, y);
            ctx.lineTo(x + sw, y - sh);
            ctx.stroke();

            if (!this.calm && Math.random() < 0.05) {
                this.fx.dust.push({
                    x: x + (Math.random() - 0.5) * sw * 2,
                    y,
                    vx: (Math.random() - 0.5) * 20,
                    vy: -12,
                    t0: now,
                    dur: 900,
                    r: 3,
                });
            }
        }

        ctx.restore();
        this.hit(x, y - h / 2, 32 * size, h / 2 + 12, { type: "task", owner, id: task.id }, 0.1);
        void sky;
    }

    // ——— the agents ———

    drawAgent(agent, now, sky) {
        const { ctx } = this;
        const cast = agent.cast;
        const small = agent.kind === "subagent";
        const s = small ? 1 : 1.3;
        const walking = agent.state === "walk";
        const step = walking ? Math.sin(now / 70 + agent.phase) : 0;
        const shake = agent.shake > now ? Math.sin(now / 20) * 2 : 0;
        const x = agent.pos.x + shake;
        const y = agent.pos.y - Math.abs(step) * 1.5;
        const thinking = agent.spiceUntil > now;

        this.shadow(agent.pos.x, agent.pos.y + 1, 16 * s, 5 * s, 26 * s);

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);

        // A navigator floats in a tank of orange gas.
        if (cast.special === "tank") {
            ctx.fillStyle = "rgba(255,140,40,0.35)";
            ctx.strokeStyle = "rgba(255,220,180,0.7)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(-13, -42, 26, 42, 6);
            ctx.fill();
            ctx.stroke();
        }

        // Thinking: a halo of melange.
        if (thinking) {
            const glow = ctx.createRadialGradient(0, -24, 2, 0, -24, 26);

            glow.addColorStop(0, `rgba(255,150,50,${0.35 + 0.15 * Math.sin(now / 200)})`);
            glow.addColorStop(1, "rgba(255,120,30,0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(0, -24, 26, 0, TAU);
            ctx.fill();
        }

        // The robe: a bell from the shoulders, swaying with the walk.
        const sway = step * 2;

        ctx.fillStyle = cast.robe;
        ctx.beginPath();
        ctx.moveTo(-5, -24);
        ctx.quadraticCurveTo(-9, -10, -9 + sway, 0);
        ctx.lineTo(9 + sway, 0);
        ctx.quadraticCurveTo(9, -10, 5, -24);
        ctx.closePath();
        ctx.fill();
        // The trim, at the hem and down the front.
        ctx.fillStyle = cast.trim;
        ctx.fillRect(-9 + sway, -2, 18, 2);
        ctx.fillRect(-0.75, -22, 1.5, 20);

        // Fremen wear a stillsuit beneath: a tube from the nose.
        const faction = cast.faction ?? {};

        // The head.
        if (faction.hood) {
            ctx.fillStyle = shade(cast.robe.startsWith("#") ? cast.robe : "#5a4630", 0.1);
            ctx.beginPath();
            ctx.ellipse(0, -28, 6.2, 7, 0, 0, TAU);
            ctx.fill();
            ctx.fillStyle = cast.skin;
            ctx.beginPath();
            ctx.ellipse(0, -27.5, 3.4, 4.2, 0, 0, TAU);
            ctx.fill();
        } else {
            ctx.fillStyle = cast.skin;
            ctx.beginPath();
            ctx.arc(0, -28, 4.6, 0, TAU);
            ctx.fill();

            if (!faction.bald) {
                ctx.fillStyle = cast.factionKey === "matre" ? "#2a1410" : "#3a2616";
                ctx.beginPath();
                ctx.arc(0, -29.5, 4.8, Math.PI, TAU);
                ctx.fill();
            }
        }

        // Eyes: blue within blue for the spice-touched.
        const eyes = faction.eyes;

        ctx.fillStyle = eyes ?? "#1b120c";
        ctx.fillRect(-2.2, -28.5, 1.4, 1.2);
        ctx.fillRect(0.8, -28.5, 1.4, 1.2);

        if (eyes && sky.night > 0.4) {
            ctx.fillStyle = "rgba(80,180,255,0.5)";
            ctx.beginPath();
            ctx.arc(0, -28, 4, 0, TAU);
            ctx.fill();
        }

        if (faction.tube) {
            ctx.strokeStyle = "#5d6a72";
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(1, -26);
            ctx.quadraticCurveTo(4, -23, 2, -19);
            ctx.stroke();
        }

        if (cast.special === "mentat") {
            // Sapho-stained lips.
            ctx.fillStyle = "#b0182a";
            ctx.fillRect(-1.2, -25.6, 2.4, 1);
        }

        if (faction.crown || cast.special === "crown") {
            ctx.fillStyle = cast.factionKey === "bene" ? "#d8c8ff" : "#ffd36b";
            ctx.beginPath();
            ctx.moveTo(-4, -33);
            ctx.lineTo(-3, -36);
            ctx.lineTo(-1, -34);
            ctx.lineTo(0, -37);
            ctx.lineTo(1, -34);
            ctx.lineTo(3, -36);
            ctx.lineTo(4, -33);
            ctx.closePath();
            ctx.fill();
        }

        // What each carries.
        switch (cast.special) {
            case "sword":
                ctx.strokeStyle = "#e8edf2";
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(7, -14);
                ctx.lineTo(13, -30);
                ctx.stroke();
                ctx.strokeStyle = "#c9a33a";
                ctx.beginPath();
                ctx.moveTo(5, -16);
                ctx.lineTo(9, -14);
                ctx.stroke();
                break;
            case "staff":
                ctx.strokeStyle = "#6a4a2a";
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(9, 0);
                ctx.lineTo(9, -36);
                ctx.stroke();
                ctx.fillStyle = cast.trim;
                ctx.fillRect(7.5, -38, 3, 3);
                break;
            case "scroll":
            case "ledger":
                ctx.fillStyle = cast.special === "ledger" ? "#7a5a3a" : "#f3e2b5";
                ctx.fillRect(5, -17, 6, 5);
                break;
            case "keys":
                ctx.strokeStyle = "#ffd36b";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(7, -12, 2.2, 0, TAU);
                ctx.stroke();
                break;
            case "talon":
                ctx.fillStyle = "#ff9d3b";
                ctx.fillRect(6, -14, 1, 3);
                ctx.fillRect(8, -14, 1, 3);
                break;
            case "worm":
                // The maker hook, carried over the shoulder.
                ctx.strokeStyle = "#4a341f";
                ctx.lineWidth = 1.3;
                ctx.beginPath();
                ctx.moveTo(-7, -4);
                ctx.lineTo(-11, -34);
                ctx.arc(-8, -34, 3, Math.PI, TAU);
                ctx.stroke();
                break;
            default:
                break;
        }

        ctx.restore();

        // Over the head: what just happened.
        for (const pop of agent.pops) {
            const t = (now - pop.t0) / 1600;
            const py = y - 44 * s - t * 18;

            ctx.save();
            ctx.globalAlpha = 1 - t;

            if (pop.ok) {
                // A drop of water: the work held.
                ctx.fillStyle = "#6fc8ff";
                ctx.beginPath();
                ctx.moveTo(x, py - 6);
                ctx.quadraticCurveTo(x + 4.5, py, x, py + 3);
                ctx.quadraticCurveTo(x - 4.5, py, x, py - 6);
                ctx.fill();
            } else {
                // A crysknife, broken.
                ctx.strokeStyle = "#ff4b3a";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - 4, py - 4);
                ctx.lineTo(x + 4, py + 4);
                ctx.moveTo(x + 4, py - 4);
                ctx.lineTo(x - 4, py + 4);
                ctx.stroke();
            }

            ctx.restore();
        }

        this.hit(agent.pos.x, agent.pos.y - 16 * s, 12, 20 * s, { type: "agent", id: agent.id }, 0);
    }

    // ——— what flies ———

    drawDust(now) {
        const { ctx } = this;

        for (const puff of this.fx.dust) {
            const t = (now - puff.t0) / puff.dur;
            const age = (now - puff.t0) / 1000;

            ctx.fillStyle = `rgba(232,190,130,${0.5 * (1 - t)})`;
            ctx.beginPath();
            ctx.arc(puff.x + puff.vx * age, puff.y + puff.vy * age, puff.r * (1 + t), 0, TAU);
            ctx.fill();
        }
    }

    drawBricks(now) {
        const { ctx } = this;

        for (const brick of this.fx.bricks) {
            const t = clamp((now - brick.t0) / brick.dur, 0, 1);
            const x = lerp(brick.from.x, brick.to.x, t);
            const y = lerp(brick.from.y, brick.to.y - 20, t) - Math.sin(t * Math.PI) * 80;

            ctx.fillStyle = brick.color;
            ctx.shadowColor = brick.color;
            ctx.shadowBlur = 6;
            ctx.fillRect(x - 3, y - 2, 6, 4);
            ctx.shadowBlur = 0;
        }
    }

    drawMotes(now) {
        const { ctx } = this;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        for (const mote of this.fx.motes) {
            const t = (now - mote.t0) / mote.dur;

            if (t < 0) {
                continue;
            }

            const e = ease(clamp(t, 0, 1));
            const x = lerp(mote.from.x, mote.to.x, e);
            const y = lerp(mote.from.y, mote.to.y, e) - Math.sin(e * Math.PI) * mote.lift;

            ctx.fillStyle = `rgba(255,${130 + Math.round(60 * (1 - t))},40,${0.85 * (1 - t * 0.5)})`;
            ctx.beginPath();
            ctx.arc(x, y, mote.size, 0, TAU);
            ctx.fill();
        }

        ctx.restore();
    }

    drawShips(now) {
        const { ctx } = this;

        for (const ship of this.fx.ships) {
            const t = (now - ship.t0) / ship.dur;
            const rise = ease(clamp(t / 0.7, 0, 1));
            const fold = clamp((t - 0.7) / 0.3, 0, 1);
            const y = ship.y - 40 - rise * 260;

            ctx.save();
            ctx.globalAlpha = 1 - fold;

            const body = ctx.createLinearGradient(0, y - 18, 0, y + 18);

            body.addColorStop(0, "#5a5048");
            body.addColorStop(0.5, "#2e2722");
            body.addColorStop(1, "#16110e");
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.roundRect(ship.x - 110 * (1 - fold * 0.8), y - 16, 220 * (1 - fold * 0.8), 32, 16);
            ctx.fill();
            ctx.fillStyle = "#ff9a3c";

            for (let light = 0; light < 9; light++) {
                ctx.fillRect(ship.x - 90 + light * 22, y + 2, 4, 2);
            }

            ctx.restore();

            if (fold > 0) {
                // Space folds: a ring of light, and it is gone.
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                ctx.strokeStyle = `rgba(255,200,140,${1 - fold})`;
                ctx.lineWidth = 6 * (1 - fold);
                ctx.beginPath();
                ctx.ellipse(ship.x, y, 20 + fold * 220, 6 + fold * 60, 0, 0, TAU);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawThopters(now) {
        const { ctx } = this;

        for (const thopter of this.fx.thopters) {
            const t = clamp((now - thopter.t0) / thopter.dur, 0, 1);
            const e = ease(t);
            const x = lerp(thopter.from.x, thopter.to.x, e);
            const lift = Math.sin(t * Math.PI) * 90;
            const y = lerp(thopter.from.y, thopter.to.y, e) - lift;
            const angle = Math.atan2(thopter.to.y - thopter.from.y, thopter.to.x - thopter.from.x);
            const flap = Math.sin(now / 28 + thopter.seed * 10);
            const color =
                thopter.via === "stop"
                    ? "#c8372d"
                    : thopter.via === "human"
                      ? "#2f6b3b"
                      : thopter.via === "report"
                        ? "#b48cff"
                        : "#5c5246";

            // Its shadow on the sand.
            ctx.fillStyle = "rgba(60,25,10,0.18)";
            ctx.beginPath();
            ctx.ellipse(x + lift * 0.3, y + lift, 12, 4, 0, 0, TAU);
            ctx.fill();

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            // Wings: two pairs, beating.
            ctx.fillStyle = "rgba(230,225,210,0.75)";

            for (const side of [-1, 1]) {
                for (const offset of [-4, 5]) {
                    ctx.beginPath();
                    ctx.ellipse(
                        offset,
                        side * (6 + flap * 3),
                        7,
                        2.2 + Math.abs(flap) * 1.5,
                        side * (0.2 + flap * 0.3),
                        0,
                        TAU,
                    );
                    ctx.fill();
                }
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(0, 0, 11, 3.6, 0, 0, TAU);
            ctx.fill();
            ctx.fillStyle = "#a7d6ff";
            ctx.beginPath();
            ctx.ellipse(7, 0, 3, 2.2, 0, 0, TAU);
            ctx.fill();
            // The message capsule.
            ctx.fillStyle = "#f3e2b5";
            ctx.fillRect(-9, 3, 5, 2.5);
            ctx.restore();
        }
    }

    drawSelection(now) {
        const at = this.refPos(this.selected);

        if (!at) {
            return;
        }

        const { ctx } = this;
        const pulse = 0.5 + 0.5 * Math.sin(now / 250);
        const r = this.selected.type === "place" ? 80 : this.selected.type === "task" ? 40 : 22;

        ctx.save();
        ctx.strokeStyle = `rgba(255,220,140,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 2 / this.cam.z;
        ctx.setLineDash([6 / this.cam.z, 4 / this.cam.z]);
        ctx.beginPath();
        ctx.ellipse(at.x, at.y + 2, r, r * 0.4, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
    }

    // ——— light and weather ———

    drawSky(sky) {
        const { ctx, view } = this;

        if (sky.dusk > 0.02) {
            ctx.save();
            ctx.globalCompositeOperation = "soft-light";
            ctx.fillStyle = `rgba(255,110,40,${sky.dusk * 0.55})`;
            ctx.fillRect(0, 0, view.w, view.h);
            ctx.restore();
        }

        if (sky.night > 0.02) {
            ctx.save();
            ctx.globalCompositeOperation = "multiply";
            ctx.fillStyle = `rgba(${Math.round(lerp(255, 78, sky.night))},${Math.round(lerp(255, 86, sky.night))},${Math.round(lerp(255, 150, sky.night))},1)`;
            ctx.fillRect(0, 0, view.w, view.h);
            ctx.restore();

            // Moonlight: a cool wash from the corner of the sky.
            const moon = ctx.createRadialGradient(
                view.w * 0.85,
                -view.h * 0.2,
                0,
                view.w * 0.85,
                -view.h * 0.2,
                view.w,
            );

            moon.addColorStop(0, `rgba(170,190,255,${0.18 * sky.night})`);
            moon.addColorStop(1, "rgba(170,190,255,0)");
            ctx.fillStyle = moon;
            ctx.fillRect(0, 0, view.w, view.h);
        }

        // Heat haze at high noon.
        if (sky.sun > 0.6 && !this.calm) {
            ctx.save();
            ctx.globalAlpha = (sky.sun - 0.6) * 0.18;
            ctx.fillStyle = "#fff4dc";
            ctx.fillRect(0, 0, view.w, view.h);
            ctx.restore();
        }
    }

    drawLights(sky, now) {
        const { ctx } = this;
        const glow = sky.night;

        if (glow < 0.05) {
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        const light = (x, y, r, color, a) => {
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);

            gradient.addColorStop(0, alpha(color, a * glow));
            gradient.addColorStop(1, alpha(color, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        };

        for (const agent of this.agents.values()) {
            if (agent.rock) {
                light(
                    agent.rock.x,
                    agent.rock.y - 12,
                    60,
                    "#ff9a3c",
                    0.45 + 0.08 * Math.sin(now / 300 + agent.seed),
                );
            }

            if (agent.tent) {
                light(agent.tent.x, agent.tent.y - 4, 26, "#ffb060", 0.35);
            }

            if (agent.spiceUntil > now) {
                light(agent.pos.x, agent.pos.y - 20, 34, "#ff8a2a", 0.4);
            }

            if (agent.cast.faction?.eyes) {
                light(agent.pos.x, agent.pos.y - 28, 8, "#4fb2ff", 0.6);
            }
        }

        for (const place of this.places.values()) {
            const color =
                place.def.draw === "spice"
                    ? "#ff8a2a"
                    : place.def.draw === "spire"
                      ? "#8fe3ff"
                      : "#ffcf8a";

            light(
                place.x,
                place.y - 30,
                place.key === "citadel" ? 160 : 70,
                color,
                place.def.draw === "spice" ? 0.35 : 0.3,
            );
        }

        for (const [owner, lots] of this.lots) {
            (this.model.tasks.get(owner) ?? []).forEach((task, index) => {
                const lot = lots[index];

                lot && task.state !== "ruin" && light(lot.x, lot.y - 20, 30, "#ffc070", 0.25);
            });
        }

        ctx.restore();
    }

    drawStorm(now) {
        const { ctx, view } = this;
        const power = this.storm;

        if (power < 0.02) {
            return;
        }

        ctx.save();
        ctx.fillStyle = `rgba(165,88,34,${0.52 * power})`;
        ctx.fillRect(0, 0, view.w, view.h);

        if (!this.calm) {
            const streaks = this.fx.streaks;

            while (streaks.length < 280 * power) {
                streaks.push({
                    x: Math.random() * view.w,
                    y: Math.random() * view.h,
                    v: 600 + Math.random() * 900,
                    l: 20 + Math.random() * 60,
                });
            }

            streaks.length = Math.min(streaks.length, Math.ceil(280 * power));

            const dt = 1 / 60;

            ctx.strokeStyle = `rgba(250,210,150,${0.6 * power})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();

            for (const streak of streaks) {
                streak.x += streak.v * dt;
                streak.y += streak.v * dt * 0.12;

                if (streak.x > view.w + 80) {
                    streak.x = -80;
                    streak.y = Math.random() * view.h;
                }

                ctx.moveTo(streak.x, streak.y);
                ctx.lineTo(streak.x - streak.l, streak.y - streak.l * 0.12);
            }

            ctx.stroke();
        }

        // Swirls of the Coriolis.
        const swirl = ctx.createRadialGradient(
            view.w * 0.3 + Math.sin(now / 2000) * 80,
            view.h * 0.5,
            0,
            view.w * 0.3,
            view.h * 0.5,
            view.w * 0.7,
        );

        swirl.addColorStop(0, `rgba(120,60,20,${0.4 * power})`);
        swirl.addColorStop(1, "rgba(120,60,20,0)");
        ctx.fillStyle = swirl;
        ctx.fillRect(0, 0, view.w, view.h);
        ctx.restore();
    }

    // ——— words ———

    /** Text at a world point, drawn in screen space so it stays sharp and readable at any zoom. */
    label(
        x,
        y,
        text,
        {
            size = 12,
            color = "#fff6e2",
            weight = 600,
            bg = "rgba(28,14,6,0.72)",
            spacing = 2,
            pad = 5,
            upper = true,
            dy = 0,
        } = {},
    ) {
        if (!text) {
            return;
        }

        const { ctx } = this;
        const at = this.toScreen(x, y);

        at.y += dy;

        if (at.x < -200 || at.x > this.view.w + 200 || at.y < -40 || at.y > this.view.h + 40) {
            return;
        }

        const words = upper ? text.toUpperCase() : text;

        ctx.font = `${weight} ${size}px ${FONT}`;

        if ("letterSpacing" in ctx) {
            ctx.letterSpacing = `${spacing}px`;
        }

        const width = ctx.measureText(words).width;

        if (bg) {
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.roundRect(
                at.x - width / 2 - pad,
                at.y - size / 2 - pad + 1,
                width + pad * 2,
                size + pad * 2 - 2,
                3,
            );
            ctx.fill();
        }

        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(words, at.x + (spacing ? spacing / 2 : 0), at.y + 1);

        if ("letterSpacing" in ctx) {
            ctx.letterSpacing = "0px";
        }
    }

    drawLabels(now) {
        const z = this.cam.z;

        if (z < 0.16) {
            return;
        }

        for (const place of this.places.values()) {
            const y = place.y + (place.def.draw === "spice" ? 62 : 18);

            // Far out, the places crowd each other: only the Citadel keeps its name.
            if (z < 0.5 && place.key !== "citadel") {
                continue;
            }

            this.label(place.x, y, z < 0.45 ? place.def.short : place.def.label, {
                size: place.key === "citadel" ? 13 : 11,
                color: place.def.draw === "spice" ? "#ffcf8a" : "#f3e2b5",
            });
        }

        for (const agent of this.agents.values()) {
            const cast = agent.cast;

            if (agent.rock) {
                const { x, y } = agent.rock;

                this.label(x, y + 26, cast.name, {
                    size: 14,
                    color: "#fff6e2",
                    weight: 700,
                    spacing: 3,
                    bg: alpha("#1c0e06", 0.8),
                });

                if (z > 0.35) {
                    this.label(x, y + 26, `${cast.title} · ${cast.faction?.label ?? ""}`, {
                        dy: 19,
                        size: 10,
                        color: cast.accent,
                        bg: "rgba(28,14,6,0.55)",
                        spacing: 1.5,
                        pad: 3,
                    });
                }

                const open = this.model.open.get(agent.id);

                if (open && z > 0.5) {
                    this.label(x, y + 26, `“${open.title}”`, {
                        dy: 36,
                        size: 11,
                        color: "#f3e2b5",
                        bg: "rgba(28,14,6,0.5)",
                        spacing: 0,
                        upper: false,
                        weight: 400,
                    });
                }
            } else if (z > 0.7) {
                this.label(agent.pos.x, agent.pos.y, cast.name, {
                    dy: 12,
                    size: 10,
                    bg: "rgba(28,14,6,0.6)",
                    spacing: 1,
                });
            }

            // What they are doing, while they do it.
            if (agent.label && agent.labelUntil > now && z > 0.55 && agent.state !== "home") {
                const text = agent.label.length > 46 ? `${agent.label.slice(0, 45)}…` : agent.label;

                this.label(agent.pos.x, agent.pos.y, text, {
                    dy: -((agent.kind === "subagent" ? 40 : 52) * z + 16),
                    size: 11,
                    color: "#1c0e06",
                    bg: "rgba(255,240,210,0.88)",
                    spacing: 0,
                    upper: false,
                    weight: 500,
                });
            }
        }

        if (z > 0.95) {
            for (const [owner, lots] of this.lots) {
                (this.model.tasks.get(owner) ?? []).forEach((task, index) => {
                    const lot = lots[index];

                    if (lot && task.state !== "building") {
                        const words =
                            task.title.length > 26 ? `${task.title.slice(0, 25)}…` : task.title;

                        this.label(lot.x, lot.y + 14, words, {
                            size: 9,
                            bg: "rgba(28,14,6,0.55)",
                            spacing: 0,
                            upper: false,
                            weight: 400,
                        });
                    }
                });
            }
        }
    }
}

/** A picture of an agent, large, for their dossier: the same figure the desert draws. */
export function portraitURL(cast, kind = "session", scale = 4) {
    const canvas = document.createElement("canvas");

    canvas.width = 24 * scale;
    canvas.height = 40 * scale;

    const ctx = canvas.getContext("2d");
    const painter = {
        ctx,
        calm: true,
        sun: { night: 0, dusk: 0, angle: 0 },
        shadow() {},
        hit() {},
    };

    ctx.setTransform(scale, 0, 0, scale, 12 * scale, 0);
    World.prototype.drawAgent.call(
        painter,
        {
            cast,
            kind: "subagent",
            pos: { x: 0, y: 39 },
            state: "home",
            pops: [],
            shake: 0,
            spiceUntil: 0,
            phase: 0,
        },
        0,
        painter.sun,
    );
    void kind;

    return canvas.toDataURL();
}
