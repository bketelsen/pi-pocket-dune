// The desert's memory: what the server's events mean, with no drawing. Each task an agent is given raises a structure
// beside its sietch, built by the work itself; each event also says what the world should show (an effect), and a
// line for the Chronicle. Pure: tested in node (test/model.test.ts).

/** The parts a finished tool call adds to a structure. */
export const PART = {
    read: { label: "Scroll read", word: "read" },
    write: { label: "Windtrap vane", word: "wrote" },
    shell: { label: "Ixian gear", word: "ran" },
    git: { label: "Guild crate", word: "shipped" },
    web: { label: "Seer's lens", word: "looked out at" },
    mcp: { label: "House banner", word: "treated with" },
    artifact: { label: "Mural", word: "painted" },
    memory: { label: "Memory rune", word: "remembered" },
    delegate: { label: "Council seat", word: "sent for" },
    other: { label: "Landsraad seal", word: "used" },
    fail: { label: "Crack", word: "failed" },
};

/** What a finished task becomes, by the work that weighed most in it. */
export const STYLE = {
    read: { name: "Library Spire", blurb: "mostly reading: a tower of scrolls" },
    write: { name: "Windtrap", blurb: "mostly edits: a windtrap that wrings water from the air" },
    shell: { name: "Ixian Engine", blurb: "mostly commands: a humming machine of Ix" },
    web: { name: "Watchtower", blurb: "mostly the web: a tower that sees over the dunes" },
    git: { name: "Guild Beacon", blurb: "mostly git: a beacon for the heighliners" },
    delegate: { name: "Council Tent", blurb: "mostly helpers: a tent where the fedaykin gather" },
    mcp: { name: "Caravanserai", blurb: "mostly MCP: a trading post of the Great Houses" },
    artifact: { name: "Mural Arch", blurb: "mostly artifacts: an arch painted in the old way" },
    memory: { name: "Memory Shrine", blurb: "mostly memory: a shrine to Other Memory" },
    other: {
        name: "Landsraad Pavilion",
        blurb: "mostly other tools: a pavilion of the Great Houses",
    },
    mixed: { name: "Palace", blurb: "a bit of everything: a palace of the desert" },
    ruin: { name: "Buried Ruin", blurb: "most of its calls failed: the sand took it back" },
};

/** Tools that hand work to another agent. */
const DELEGATE = new Set(["subagent", "team", "team_delegate", "team_message"]);
const MAX_TASKS = 6;
const MAX_CHRONICLE = 200;
const TITLE_MARKER = "Task from the source session:";

/** The part a tool call stands for. */
export function partOf(tool) {
    const s = tool?.s ?? "";

    if (s === "files") {
        return tool.w ? "write" : "read";
    }

    if (s === "shell") {
        return "shell";
    }

    if (s === "github") {
        return "git";
    }

    if (s === "web") {
        return "web";
    }

    if (s.startsWith("mcp:")) {
        return "mcp";
    }

    if (s === "artifact" || s === "memory") {
        return s;
    }

    if (DELEGATE.has(tool?.n)) {
        return "delegate";
    }

    return "other";
}

/** The style a task's parts make. */
export function styleOf(task) {
    if (task.calls >= 2 && task.fails * 2 > task.calls) {
        return "ruin";
    }

    const counts = Object.entries(task.parts).filter(([part]) => part !== "fail");

    if (counts.length === 0) {
        return "mixed";
    }

    counts.sort((a, b) => b[1] - a[1]);

    const [top, n] = counts[0];
    const total = counts.reduce((sum, [, value]) => sum + value, 0);

    // A bit of everything: no kind of work has half of it, and there are 4 kinds or more.
    if (counts.length >= 4 && n * 2 < total) {
        return "mixed";
    }

    return top;
}

/** The first words of what was asked, without markers or the delegation's preamble. */
export function titleOf(text) {
    let value = String(text ?? "");
    const marker = value.indexOf(TITLE_MARKER);

    if (marker >= 0) {
        value = value.slice(marker + TITLE_MARKER.length);
    }

    value = value
        .replace(/^\s*\[[^\]]{1,40}\]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

    return value.length > 64 ? `${value.slice(0, 63)}…` : value || "Untold work";
}

/** A short form of a number of tokens: 950, 12.4k, 3.1M. */
export function fmt(n) {
    const value = Number(n) || 0;

    if (value >= 1e6) {
        return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
    }

    if (value >= 1e3) {
        return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
    }

    return String(Math.round(value));
}

/** Money as Solaris: the same dollars, in the Imperium's coin. */
export function solaris(cost) {
    const value = Number(cost) || 0;

    if (value === 0) {
        return "0 ◈";
    }

    return value < 0.01 ? `${(value * 100).toFixed(2)}¢ ◈` : `$${value.toFixed(2)} ◈`;
}

export class Desert {
    constructor() {
        this.reset({});
    }

    /** Forget everything; `convs` is the server's sessions, as the world holds them. */
    reset(convs) {
        this.convs = convs ?? {};
        this.calls = new Map();
        this.tasks = new Map();
        this.open = new Map();
        this.busy = new Map();
        this.fails = [];
        this.dones = [];
        this.chronicle = [];
        this.version = 0;
        this.lastAt = 0;
        this.storm = false;
    }

    /** The agent whose sietch a conversation's work builds at: itself, or the nearest one above a subagent. */
    ownerOf(id) {
        let at = id;

        for (let depth = 0; depth < 12; depth++) {
            const conv = this.convs[at];

            if (!conv || conv.kind !== "subagent" || !conv.parent) {
                return at;
            }

            at = conv.parent;
        }

        return at;
    }

    nameOf(id, names) {
        if (typeof id !== "string") {
            return "someone";
        }

        if (id.startsWith("human:")) {
            return id.slice(6) || "a person";
        }

        if (id.startsWith("station:")) {
            return STATION_WORD[id.slice(8)] ?? "the desert";
        }

        return names?.(id) ?? `#${id}`;
    }

    note(at, text, icon, c) {
        this.chronicle.unshift({ at, text, icon, c });

        if (this.chronicle.length > MAX_CHRONICLE) {
            this.chronicle.length = MAX_CHRONICLE;
        }

        this.version++;
    }

    taskList(owner) {
        let list = this.tasks.get(owner);

        if (!list) {
            list = [];
            this.tasks.set(owner, list);
        }

        return list;
    }

    begin(owner, at, title, from, via, id) {
        const task = {
            id: `t${id}`,
            owner,
            title: titleOf(title),
            from,
            via,
            start: at,
            end: null,
            last: at,
            parts: {},
            calls: 0,
            fails: 0,
            cost: 0,
            tokens: 0,
            files: [],
            hosts: [],
            helpers: [],
            log: [],
            state: "building",
            seed: id,
        };
        const list = this.taskList(owner);

        list.push(task);
        this.open.set(owner, task);

        // Each sietch keeps its newest structures: the oldest finished one goes.
        while (list.length > MAX_TASKS) {
            const index = list.findIndex((each) => each.state !== "building");

            list.splice(index < 0 ? 0 : index, 1);
        }

        return task;
    }

    finish(owner, at) {
        const task = this.open.get(owner);

        if (!task) {
            return null;
        }

        this.open.delete(owner);

        if (task.calls === 0) {
            // A message answered with no tool call builds nothing.
            const list = this.taskList(owner);

            list.splice(list.indexOf(task), 1);

            return null;
        }

        task.end = at;
        task.state = styleOf(task) === "ruin" ? "ruin" : "done";

        return task;
    }

    /**
     * One event, in order: what it changes, and what the world should show. `names` gives an agent's name, for the
     * Chronicle. Returns a list of effects (maybe empty).
     */
    apply(event, names) {
        const at = event.at ?? Date.now();
        const effects = [];
        const name = (id) => this.nameOf(id, names);

        this.lastAt = Math.max(this.lastAt, at);

        switch (event.k) {
            case "tool": {
                const owner = this.ownerOf(event.c);

                this.calls.set(event.call, { tool: event, owner });
                this.busy.set(event.c, { k: "tool", at, l: event.l, s: event.s });

                if (!this.open.has(owner)) {
                    this.begin(owner, at, "Unbidden work", undefined, "self", event.id);
                }

                effects.push({ type: "walk", c: event.c, s: event.s, label: event.l, n: event.n });

                if (event.s === "github" && /^git push\b/.test(event.l ?? "")) {
                    effects.push({ type: "heighliner", c: event.c });
                    this.note(
                        at,
                        `${name(event.c)} folds space: a heighliner leaves the port`,
                        "fold",
                        event.c,
                    );
                }

                if (DELEGATE.has(event.n) && (event.a === "start" || event.a === "spawn")) {
                    this.note(
                        at,
                        `${name(event.c)} summons ${event.tn || "a helper"}`,
                        "worm",
                        event.c,
                    );
                }

                break;
            }

            case "done": {
                const found = this.calls.get(event.call);

                this.calls.delete(event.call);

                const tool = found?.tool ?? { n: event.n, c: event.c };
                const owner = found?.owner ?? this.ownerOf(event.c);
                const part = event.ok ? partOf(tool) : "fail";
                const task = this.open.get(owner);

                if (task) {
                    task.calls++;
                    task.last = at;
                    task.parts[part] = (task.parts[part] ?? 0) + 1;

                    if (!event.ok) {
                        task.fails++;
                    }

                    const item = tool.i;

                    if (
                        item &&
                        (part === "read" || part === "write") &&
                        !task.files.includes(item)
                    ) {
                        task.files.push(item);
                        task.files.length > 24 && task.files.shift();
                    }

                    if (item && part === "web" && !task.hosts.includes(item)) {
                        task.hosts.push(item);
                        task.hosts.length > 12 && task.hosts.shift();
                    }

                    if (event.c !== owner && !task.helpers.includes(event.c)) {
                        task.helpers.push(event.c);
                    }

                    task.log.push({
                        at,
                        part,
                        l: tool.l ?? tool.n,
                        ok: event.ok ? 1 : 0,
                        c: event.c,
                    });
                    task.log.length > 40 && task.log.shift();
                }

                this.busy.set(event.c, { k: "done", at, l: tool.l, s: tool.s, ok: event.ok });
                this.dones.push(at);

                if (!event.ok) {
                    this.fails.push(at);
                    this.note(
                        at,
                        `${name(event.c)} stumbles: ${tool.l ?? tool.n}${event.e ? ` — ${event.e}` : ""}`,
                        "skull",
                        event.c,
                    );
                }

                effects.push({
                    type: "result",
                    c: event.c,
                    owner,
                    ok: Boolean(event.ok),
                    s: tool.s,
                    part,
                    task: task?.id,
                });

                const storm = this.stormy(at);

                if (storm !== this.storm) {
                    this.storm = storm;
                    this.note(
                        at,
                        storm
                            ? "A Coriolis storm rises: the calls are failing"
                            : "The storm passes. The sand settles.",
                        "storm",
                    );
                    effects.push({ type: "storm", on: storm });
                }

                break;
            }

            case "think": {
                this.busy.set(event.c, { k: "think", at, pv: event.pv });
                effects.push({ type: "think", c: event.c, pv: event.pv });
                break;
            }

            case "reply": {
                const owner = this.ownerOf(event.c);
                const task = this.open.get(owner);
                const tokens = (event.tin ?? 0) + (event.tout ?? 0);

                if (task) {
                    task.cost += event.cost ?? 0;
                    task.tokens += tokens;
                }

                this.busy.set(event.c, { k: "reply", at, calls: event.calls });
                effects.push({ type: "spice", c: event.c, pv: event.pv, amount: tokens });

                if (event.stop === "error" || event.e) {
                    this.note(
                        at,
                        `${name(event.c)}'s spice field failed: ${event.e ?? "error"}`,
                        "skull",
                        event.c,
                    );
                } else if (event.text && !event.calls) {
                    this.note(at, `${name(event.c)} answers: ${event.text}`, "scroll", event.c);
                }

                break;
            }

            case "idle": {
                this.busy.set(event.c, { k: "idle", at });
                effects.push({ type: "home", c: event.c });

                const conv = this.convs[event.c];

                if (!conv || conv.kind !== "subagent") {
                    const task = this.finish(event.c, at);

                    if (task) {
                        const style = STYLE[styleOf(task)] ?? STYLE.mixed;

                        effects.push({
                            type: "built",
                            owner: event.c,
                            task: task.id,
                            ruin: task.state === "ruin",
                        });
                        this.note(
                            at,
                            task.state === "ruin"
                                ? `${name(event.c)}'s work on “${task.title}” is buried by the sand`
                                : `${name(event.c)} raises a ${style.name}: “${task.title}”`,
                            task.state === "ruin" ? "skull" : "tower",
                            event.c,
                        );
                    }
                }

                break;
            }

            case "msg": {
                const to = event.to;

                effects.push({ type: "thopter", from: event.from, to, via: event.via });

                if (event.via === "report") {
                    this.note(
                        at,
                        `${name(event.from)} reports to ${name(to)}: ${event.text ?? ""}`,
                        "thopter",
                        event.from,
                    );
                    break;
                }

                if (event.via === "stop") {
                    this.note(at, `${name(event.from)} recalls ${name(to)}`, "thopter", event.from);
                    break;
                }

                if (typeof to === "string" && this.convs[to]?.kind !== "subagent") {
                    // Something new to do at this sietch: what it built so far stands as it is.
                    const open = this.open.get(to);

                    if (open && open.calls === 0) {
                        open.title = titleOf(event.text);
                        open.from = event.from;
                        open.via = event.via;
                    } else {
                        if (open) {
                            const task = this.finish(to, at);

                            task && effects.push({ type: "built", owner: to, task: task.id });
                        }

                        this.begin(to, at, event.text, event.from, event.via, event.id);
                    }
                }

                const word =
                    event.via === "human"
                        ? "sends word to"
                        : event.via === "system"
                          ? "calls upon"
                          : "dispatches a thopter to";

                this.note(
                    at,
                    `${name(event.from)} ${word} ${name(to)}: ${titleOf(event.text)}`,
                    "thopter",
                    to,
                );
                break;
            }

            case "link": {
                effects.push({ type: "relayout" });
                this.note(
                    at,
                    event.kind === "subagent"
                        ? `${event.name || name(event.c)} pledges to ${name(event.p)} as fedaykin`
                        : `${name(event.c)} joins ${name(event.p)}'s alliance`,
                    "worm",
                    event.c,
                );
                break;
            }

            default:
                break;
        }

        return effects;
    }

    /** A storm: 3 or more failed calls in the last 45 seconds, and most calls failing. */
    stormy(now) {
        const since = now - 45_000;

        this.fails = this.fails.filter((at) => at >= since);
        this.dones = this.dones.filter((at) => at >= since);

        return this.fails.length >= 3 && this.fails.length * 5 >= this.dones.length * 2;
    }

    /** Whether an agent works now: its last event is recent, and is not the end of a turn. */
    isBusy(id, now) {
        const last = this.busy.get(id);

        return Boolean(
            last &&
            now - last.at < 10 * 60_000 &&
            last.k !== "idle" &&
            !(last.k === "reply" && !last.calls),
        );
    }
}

/** What each station is called, as a sender. */
export const STATION_WORD = {
    schedule: "The Moon Dial",
    github: "The Guild Port",
    night: "The Night Watch",
    desk: "The Desk",
};
