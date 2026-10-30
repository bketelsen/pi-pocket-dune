// The demo desert: Odrade's order at work, with no agent running. Each agent follows a little script of what its
// work looks like (Teg's playbooks, Duncan's tests, Moneo's NAS), in the server's event format, so the page draws it
// exactly as it would draw the real thing. It starts with a few minutes of history, then keeps going live.

const BRIAN = "Brian";

/** Who is in the demo, and what their work is made of. */
const CAST = [
    {
        id: "1",
        title: "Odrade: Morning council",
        provider: "anthropic",
        model: "claude-opus-5-5",
        cwd: "~/projects/odrade",
        asks: [
            "Morning council: who is blocked, and what needs Brian?",
            "Review the night shift reports",
            "Plan the week for the order",
        ],
        tools: [
            ["read", { path: "decisions/decided.md" }],
            ["memory", { action: "recall" }],
            ["bash", { command: "desk list --open" }],
        ],
    },
    {
        id: "2",
        parent: "1",
        title: "Miles Teg: Caddy upgrade window",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/fleet",
        asks: [
            "Upgrade Caddy on the proxy hosts",
            "Rotate the Incus lab certificates",
            "Fix the semaphore task for backups",
        ],
        tools: [
            ["read", { path: "roles/caddy/tasks/main.yml" }],
            ["edit", { path: "roles/caddy/defaults/main.yml" }],
            ["bash", { command: "ansible-lint playbooks/proxy.yml" }],
            ["bash", { command: "pytest -q tests/" }],
            ["bash", { command: "tofu plan -out lab.plan" }],
            ["bash", { command: "git push origin caddy-2.9" }, 0.25],
        ],
    },
    {
        id: "3",
        parent: "1",
        title: "Duncan Idaho: pilothouse CI fixes",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/frostyard/pilothouse",
        asks: [
            "Make pilothouse CI green again",
            "Add tests for the igloo config loader",
            "Review the snowkit PR",
        ],
        tools: [
            ["read", { path: "internal/config/load.go" }],
            ["read", { path: "internal/config/load_test.go" }],
            ["edit", { path: "internal/config/load.go" }],
            ["bash", { command: "go test ./..." }],
            ["bash", { command: "golangci-lint run" }],
            ["bash", { command: "gh pr checks 214" }],
            ["bash", { command: "git push origin fix/ci" }, 0.25],
            [
                "subagent",
                {
                    action: "spawn",
                    name: "scout",
                    message:
                        "Find every caller of LoadConfig across the frostyard repos and list them",
                },
                0.18,
            ],
        ],
        fail: 0.12,
    },
    {
        id: "4",
        parent: "1",
        title: "Sheeana: Pi Pocket v0.20 upgrade",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/pi-pocket",
        asks: [
            "Upgrade the server to v0.20.0",
            "Check the extension API changes",
            "Rebase Brian's fork on main",
        ],
        tools: [
            ["read", { path: "CHANGELOG.md" }],
            ["read", { path: "types/pocket.d.ts" }],
            ["bash", { command: "npm test" }],
            ["bash", { command: "git fetch origin --tags" }],
            [
                "browser",
                { action: "open", url: "https://github.com/TannerMidd/pi-pocket/releases" },
            ],
            ["edit", { path: "src/server/extensions/loader.ts" }],
        ],
    },
    {
        id: "5",
        parent: "1",
        title: "Bellonda: homewiki audit",
        provider: "github-copilot",
        model: "claude-sonnet-5.5",
        cwd: "~/projects/homewiki",
        asks: [
            "Audit the storage pages against what is running",
            "Date every observation in docs/network.md",
        ],
        tools: [
            ["read", { path: "docs/storage.md" }],
            ["read", { path: "docs/network.md" }],
            ["write", { path: "docs/storage.md" }],
            ["web_fetch", { url: "https://caddy.home.arpa/status" }],
            ["bash", { command: "git commit -am 'storage: observed 2026-10-30'" }],
        ],
    },
    {
        id: "6",
        parent: "1",
        title: "Murbella: snosi image build",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/frostyard/snosi",
        asks: ["Build and boot-test the snosi image", "Fix the sysext signing step"],
        tools: [
            ["read", { path: "mkosi.conf" }],
            ["bash", { command: "mkosi build" }],
            ["bash", { command: "just boot-test" }],
            ["edit", { path: "mkosi.conf.d/20-sysext.conf" }],
            [
                "subagent",
                {
                    action: "spawn",
                    name: "reader",
                    message:
                        "Read the systemd-sysext docs and summarize the signing requirements for us",
                },
                0.12,
            ],
        ],
        fail: 0.3,
    },
    {
        id: "7",
        parent: "1",
        title: "Lucilla: sysext delivery",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/frostyard/updex",
        asks: ["Publish the new incus sysext to the apt repo", "Check the homebrew tap formula"],
        tools: [
            ["bash", { command: "repogen publish --suite stable" }],
            ["read", { path: "manifests/incus.yaml" }],
            ["bash", { command: "gh release create v6.7.1" }],
            ["mcp_call", { server: "github", tool: "list_releases" }],
        ],
    },
    {
        id: "8",
        parent: "1",
        title: "Irulan: frostmail threading",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/frostyard/frostmail",
        asks: ["Fix reply threading in frostmail", "Polish the compose window"],
        tools: [
            ["read", { path: "src/thread.rs" }],
            ["edit", { path: "src/thread.rs" }],
            ["bash", { command: "cargo test" }],
            ["artifact", { title: "Threading before and after" }, 0.2],
        ],
    },
    {
        id: "9",
        parent: "1",
        title: "Tamalane: frostyard docs",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/frostyard/frostyard-org",
        asks: ["Write the getting-started guide for snosi", "Check every link on the docs site"],
        tools: [
            ["read", { path: "src/content/docs/install.mdx" }],
            ["write", { path: "src/content/docs/getting-started.mdx" }],
            ["browser", { action: "open", url: "https://frostyard.org/docs" }],
            ["bash", { command: "npm run build" }],
        ],
    },
    {
        id: "10",
        parent: "1",
        title: "Moneo: TrueNAS snapshot review",
        provider: "github-copilot",
        model: "claude-opus-5.5",
        cwd: "~/projects/truenas-mcp",
        asks: ["Check that every dataset has a snapshot task", "Review the app updates waiting"],
        tools: [
            ["mcp_call", { server: "truenas", tool: "pool.query" }],
            ["mcp_call", { server: "truenas", tool: "snapshot.list" }],
            ["mcp_call", { server: "truenas", tool: "app.upgrade_summary" }],
            ["memory", { action: "save" }],
        ],
    },
];

const SUBS = {
    scout: {
        tools: [
            ["bash", { command: "rg -n LoadConfig" }],
            ["read", { path: "cmd/igloo/main.go" }],
            ["read", { path: "cmd/chairlift/main.go" }],
        ],
    },
    reader: {
        tools: [
            [
                "browser",
                {
                    action: "open",
                    url: "https://www.freedesktop.org/software/systemd/man/systemd-sysext.html",
                },
            ],
            ["read", { path: "docs/signing.md" }],
        ],
    },
};

const pick = (list, random) => list[Math.floor(random() * list.length)];

function classify(name, args, cwd) {
    const strip = (path) => (cwd && path.startsWith(cwd) ? path.slice(cwd.length + 1) : path);

    switch (name) {
        case "read":
            return { s: "files", i: strip(args.path), l: `read ${strip(args.path)}` };
        case "write":
            return { s: "files", i: strip(args.path), l: `wrote ${strip(args.path)}`, w: 1 };
        case "edit":
            return { s: "files", i: strip(args.path), l: `edited ${strip(args.path)}`, w: 1 };
        case "bash": {
            const first = args.command.split(/\s+/)[0];

            return first === "git" || first === "gh"
                ? {
                      s: "github",
                      i: `${first} ${args.command.split(/\s+/)[1] ?? ""}`,
                      l: args.command,
                  }
                : { s: "shell", i: first, l: args.command };
        }

        case "browser": {
            const host = new URL(args.url).host;

            return { s: "web", i: host, l: `${args.action} ${host}` };
        }

        case "web_fetch":
            return { s: "web", i: "web_fetch", l: "web_fetch" };
        case "mcp_call":
            return { s: `mcp:${args.server}`, i: args.tool, l: `${args.server} · ${args.tool}` };
        case "memory":
            return { s: "memory", i: args.action, l: `memory ${args.action}` };
        case "artifact":
            return { s: "artifact", i: args.title, l: `published ${args.title}` };
        case "subagent":
            return { l: `${args.action} ${args.name}` };
        case "team_delegate":
            return { l: `delegate ${args.agent} ${args.title}` };
        case "team_message":
            return { l: `message ${args.to}` };
        default:
            return { s: "ext", i: name, l: name };
    }
}

export class Demo {
    constructor() {
        let seed = 20261030;

        this.random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;

            return seed / 4294967296;
        };

        this.store = {
            convs: Object.create(null),
            res: Object.create(null),
            humans: Object.create(null),
            events: [],
            maxId: 0,
            batch: 0,
            loaded: true,
            unknown: new Map(),
        };
        this.seq = 0;
        this.actors = new Map();
        this.listeners = new Set();
        this.timer = null;
        this.taskSeq = 0;

        const start = Date.now() - 7 * 60_000;

        for (const each of CAST) {
            this.store.convs[each.id] = {
                id: each.id,
                kind: each.parent ? "linked" : "session",
                parent: each.parent,
                name: each.parent ? each.title.split(":")[0] : undefined,
                title: each.title,
                provider: each.provider,
                model: each.model,
                thinking: "high",
                cwd: each.cwd,
                first: start + Number(each.id) * 1000,
                last: start,
                tin: 0,
                tout: 0,
                cost: 0,
                calls: 0,
                turns: 0,
                errors: 0,
                tools: Object.create(null),
                files: Object.create(null),
            };
            this.actors.set(each.id, {
                def: each,
                state: "idle",
                nextAt: start + 4000 + this.random() * 30_000,
                steps: 0,
            });
        }

        // Odrade starts the day: Brian writes, and she hands work to everyone.
        this.actors.get("1").nextAt = start + 500;

        // The past few minutes, at once.
        this.clock = start;

        while (this.clock < Date.now()) {
            this.clock += 250;
            this.tick(this.clock, false);
        }
    }

    emit(k, data, at) {
        const event = { id: ++this.seq, at, k, ...data };

        this.store.events.push(event);
        this.store.maxId = event.id;

        if (this.store.events.length > 3000) {
            this.store.events.splice(0, this.store.events.length - 3000);
        }

        this.fresh?.push(event);

        return event;
    }

    touch(key, item, by, at, write) {
        const res = (this.store.res[key] ??= {
            key,
            count: 0,
            last: 0,
            items: Object.create(null),
            by: Object.create(null),
        });

        res.count++;
        res.last = at;
        res.by[by] = (res.by[by] ?? 0) + 1;

        if (item) {
            const entry = (res.items[item] ??= { n: 0, last: at });

            entry.n++;
            entry.last = at;
            write && (entry.w = (entry.w ?? 0) + 1);
        }
    }

    /** One step of every actor whose time has come. */
    tick(now, live) {
        this.fresh = [];

        for (const [id, actor] of this.actors) {
            if (now >= actor.nextAt) {
                this.step(id, actor, now);
            }
        }

        const fresh = this.fresh;

        this.fresh = null;

        if (live && fresh.length > 0) {
            this.listeners.forEach((listener) => listener(fresh));
        }
    }

    step(id, actor, now) {
        const random = this.random;
        const conv = this.store.convs[id];
        const def = actor.def;
        const wait = (low, high) => {
            actor.nextAt = now + low + random() * (high - low);
        };

        conv.last = now;

        switch (actor.state) {
            case "idle": {
                // Subagents wait to be sent; the rest are asked by Odrade, Brian, or the night.
                if (conv.kind === "subagent") {
                    actor.nextAt = Infinity;

                    return;
                }

                if (id === "1") {
                    const text = pick(def.asks, random);

                    this.emit("msg", { from: `human:${BRIAN}`, to: id, via: "human", text }, now);
                    this.store.humans[BRIAN] ??= { name: BRIAN, count: 0, last: 0 };
                    this.store.humans[BRIAN].count++;
                    this.store.humans[BRIAN].last = now;
                    actor.delegations = 2 + Math.floor(random() * 3);
                } else if (random() < 0.12) {
                    this.emit(
                        "msg",
                        {
                            from: "station:night",
                            to: id,
                            via: "system",
                            text: `[night-shift] Round ${1 + Math.floor(random() * 4)}: ${pick(def.asks, random)}`,
                        },
                        now,
                    );
                } else {
                    // Waiting for Odrade to send for them.
                    wait(20_000, 60_000);

                    return;
                }

                actor.state = "think";
                actor.steps = 2 + Math.floor(random() * 6);
                wait(300, 900);
                break;
            }

            case "think": {
                this.emit(
                    "think",
                    { c: id, m: 3 + conv.turns * 2, pv: conv.provider, md: conv.model },
                    now,
                );
                actor.state = "reply";
                wait(900, 2600);
                break;
            }

            case "reply": {
                const tin = 3000 + Math.floor(random() * 28_000);
                const tout = 150 + Math.floor(random() * 1800);
                const cost = (tin * 3 + tout * 15) / 1e6;
                const done = actor.steps <= 0;

                conv.tin += tin;
                conv.tout += tout;
                conv.cost += cost;
                conv.turns++;
                this.touch(`model:${conv.provider}`, conv.model, id, now);
                this.emit(
                    "reply",
                    {
                        c: id,
                        pv: conv.provider,
                        md: conv.model,
                        tin,
                        tout,
                        cost,
                        calls: done ? 0 : 1,
                        stop: done ? "stop" : "toolUse",
                        ...(done
                            ? {
                                  text: pick(
                                      [
                                          "Done. The checks are green.",
                                          "Finished, with notes in the thread.",
                                          "Complete. Nothing needs Brian today.",
                                      ],
                                      random,
                                  ),
                              }
                            : {}),
                    },
                    now,
                );

                if (done) {
                    actor.state = "yield";
                    wait(200, 500);
                } else {
                    actor.state = "tool";
                    wait(100, 300);
                }

                break;
            }

            case "tool": {
                let tool;

                if (id === "1" && actor.delegations > 0) {
                    // Odrade sends work to one of her people.
                    const others = CAST.filter((each) => each.parent === "1");
                    const who = pick(others, random);
                    const agent = who.title.split(":")[0];
                    const task = pick(who.asks, random);

                    actor.delegations--;
                    tool = ["team_delegate", { agent, task, title: task.slice(0, 40) }];
                    actor.sendTo = { id: who.id, task };
                } else {
                    const list =
                        conv.kind === "subagent"
                            ? (SUBS[conv.name]?.tools ?? def.tools)
                            : def.tools;
                    const weighted = list.filter(
                        (each) => each[2] === undefined || random() < each[2],
                    );

                    tool = pick(weighted.length > 0 ? weighted : list, random);
                }

                const [name, args] = tool;
                const what = classify(name, args, conv.cwd);
                const call = `${id}:${++this.taskSeq}`;

                conv.calls++;
                conv.tools[name] = (conv.tools[name] ?? 0) + 1;

                if (what.s) {
                    this.touch(what.s, what.i, id, now, what.w);
                }

                if (what.s === "files") {
                    const entry = (conv.files[what.i] ??= { r: 0, w: 0, last: now });

                    entry[what.w ? "w" : "r"]++;
                    entry.last = now;
                }

                this.emit(
                    "tool",
                    {
                        c: id,
                        call,
                        n: name,
                        ...(what.s ? { s: what.s } : {}),
                        ...(what.i ? { i: what.i } : {}),
                        l: what.l,
                        ...(what.w ? { w: 1 } : {}),
                        ...(name === "subagent" ? { a: args.action, tn: args.name } : {}),
                        ...(name === "team_delegate" ? { a: "start", tn: args.agent } : {}),
                    },
                    now,
                );
                actor.call = { call, name, args };
                actor.state = "done";
                wait(500, name === "bash" ? 4200 : 1800);
                break;
            }

            case "done": {
                const { call, name, args } = actor.call;
                const fails =
                    random() < (def.fail ?? 0.05) &&
                    name !== "team_delegate" &&
                    name !== "subagent";

                if (fails) {
                    conv.errors++;
                }

                this.emit(
                    "done",
                    {
                        c: id,
                        call,
                        n: name,
                        ok: fails ? 0 : 1,
                        ...(fails
                            ? {
                                  e: pick(
                                      [
                                          "exit status 1",
                                          "test failed: TestLoad/empty",
                                          "permission denied",
                                          "timeout after 120s",
                                      ],
                                      random,
                                  ),
                              }
                            : {}),
                    },
                    now,
                );

                if (name === "team_delegate" && actor.sendTo) {
                    const target = this.actors.get(actor.sendTo.id);

                    this.emit(
                        "msg",
                        { from: id, to: actor.sendTo.id, via: "team", text: actor.sendTo.task },
                        now,
                    );

                    if (target && target.state === "idle") {
                        target.state = "think";
                        target.steps = 3 + Math.floor(random() * 7);
                        target.nextAt = now + 800 + random() * 1500;
                    }

                    actor.sendTo = null;
                }

                if (name === "subagent" && !fails) {
                    this.spawn(id, args, now);
                }

                actor.steps--;
                actor.state = "think";
                wait(300, 1200);
                break;
            }

            case "yield": {
                this.emit("idle", { c: id }, now);

                if (conv.kind === "subagent") {
                    this.emit(
                        "msg",
                        {
                            from: id,
                            to: conv.parent,
                            via: "report",
                            text: "Found 7 callers; 2 pass a nil path.",
                        },
                        now,
                    );
                    actor.state = "idle";
                    actor.nextAt = Infinity;

                    return;
                }

                actor.state = "idle";
                wait(id === "1" ? 25_000 : 30_000, id === "1" ? 50_000 : 90_000);
                break;
            }

            default:
                actor.state = "idle";
                wait(5000, 10_000);
        }
    }

    spawn(parent, args, now) {
        const existing = Object.values(this.store.convs).find(
            (each) => each.parent === parent && each.name === args.name && each.kind === "subagent",
        );
        const id = existing?.id ?? String(20 + Object.keys(this.store.convs).length);

        if (!existing) {
            this.store.convs[id] = {
                id,
                kind: "subagent",
                parent,
                name: args.name,
                provider: "github-copilot",
                model: "gpt-6-luna",
                first: now,
                last: now,
                tin: 0,
                tout: 0,
                cost: 0,
                calls: 0,
                turns: 0,
                errors: 0,
                tools: Object.create(null),
                files: Object.create(null),
                sure: true,
            };
            this.actors.set(id, {
                def: { tools: SUBS[args.name]?.tools ?? [] },
                state: "idle",
                nextAt: Infinity,
                steps: 0,
            });
            this.emit("link", { c: id, p: parent, kind: "subagent", name: args.name }, now);
        }

        this.emit("msg", { from: parent, to: id, via: "subagent", text: args.message }, now);

        const actor = this.actors.get(id);

        actor.state = "think";
        actor.steps = 2 + Math.floor(this.random() * 3);
        actor.nextAt = now + 600;
    }

    start(listener) {
        this.listeners.add(listener);

        if (!this.timer) {
            this.timer = setInterval(() => this.tick(Date.now(), true), 200);
        }
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.listeners.clear();
    }
}
