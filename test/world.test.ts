// The engine's logic that needs no screen: a World on a stub canvas that records what it draws.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { World } from "../dune/world.js";

type Call = [string, ...unknown[]];

/** A 2D context that keeps each call and each property set, in order. */
function recorder() {
    const calls: Call[] = [];
    let gradients = 0;
    const ctx: Record<string | symbol, unknown> = new Proxy(
        {},
        {
            get(_target, name) {
                if (typeof name !== "string") {
                    return undefined;
                }

                return (...args: unknown[]) => {
                    calls.push([name, ...args]);

                    if (name === "createRadialGradient" || name === "createLinearGradient") {
                        const id = `gradient#${++gradients}`;

                        return {
                            id,
                            addColorStop: (...stop: unknown[]) =>
                                calls.push([`${id}.addColorStop`, ...stop]),
                        };
                    }

                    if (name === "measureText") {
                        return { width: String(args[0]).length * 6 };
                    }

                    return undefined;
                };
            },
            set(_target, name, value) {
                const shown =
                    value && typeof value === "object" && "id" in value ? value.id : value;

                calls.push([`=${String(name)}`, shown]);

                return true;
            },
        },
    );

    return { ctx, calls };
}

function makeWorld(t: TestContext, convs: Record<string, Record<string, unknown>>) {
    // The constructor reads the monotonic clock: fix it, so no test reads real time.
    t.mock.method(performance, "now", () => 5000);

    const { ctx, calls } = recorder();
    const canvas = {
        getContext: () => ctx,
        addEventListener: () => undefined,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    };
    const world = new World(canvas, { convs });

    return { world, calls };
}

const digest = (calls: Call[]) => createHash("sha256").update(JSON.stringify(calls)).digest("hex");

test("the desert's clock: live it is now, in a replay the last event's time", (t) => {
    const FIXED = 1_800_000_000_000;
    const OLD = 1_000_000;

    t.mock.method(Date, "now", () => FIXED);

    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });

    // One tool call long ago: the model's last event is at OLD + 1.
    world.derive([
        { id: 1, at: OLD, k: "tool", c: "1", call: "a", n: "read", s: "files", l: "read a.go" },
    ]);
    world.model.busy.set("1", { k: "tool", at: OLD, calls: 1 });
    assert.equal(world.model.lastAt, OLD);
    world.selected = { type: "agent", id: "1" };

    // Live: the clock is now, and the call is over 10 minutes old.
    const live = world.stats();

    assert.equal(live.active, 0);
    assert.equal(live.perMinute, 0);
    assert.equal(live.replay, null);
    assert.equal(live.replayAt, null);
    assert.equal(world.selection().busy, false);

    // In a replay: the clock is the last event's time, so the agent is at work.
    world.derive([
        { id: 1, at: OLD, k: "tool", c: "1", call: "a", n: "read", s: "files", l: "read a.go" },
    ]);
    world.replay = { progress: 0.5 };
    world.selected = { type: "agent", id: "1" };

    const replay = world.stats();

    assert.equal(replay.active, 1);
    assert.equal(replay.perMinute, 1);
    assert.equal(replay.replay, 50);
    assert.equal(replay.replayAt, OLD);
    assert.equal(world.selection().busy, true);

    // The same agent, busy now: at work live, and still at work in a replay (the call is ahead of the clock).
    world.replay = null;
    world.model.busy.set("1", { k: "tool", at: FIXED - 1000, calls: 1 });
    assert.equal(world.stats().active, 1);
    assert.equal(world.selection().busy, true);
});

test("in a replay, the selection and the sietch read no wall clock", (t) => {
    const now = t.mock.method(Date, "now", () => 1_800_000_000_000);
    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });

    world.derive([
        { id: 1, at: 1000, k: "tool", c: "1", call: "a", n: "read", s: "files", l: "read a.go" },
    ]);
    world.selected = { type: "agent", id: "1" };

    const agent = world.agents.get("1");
    const sky = { night: 0, dusk: 0, angle: 0 };

    world.sun = sky;
    assert.ok(agent);

    // Live: each reads the wall clock 1 time.
    now.mock.resetCalls();
    world.selection();
    assert.equal(now.mock.callCount(), 1);
    now.mock.resetCalls();
    world.drawSietch(agent, 0, sky);
    assert.equal(now.mock.callCount(), 1);

    // In a replay: the last event's time is the clock, and the wall clock is not read.
    world.replay = { progress: 0 };
    now.mock.resetCalls();
    world.selection();
    world.drawSietch(agent, 0, sky);
    assert.equal(now.mock.callCount(), 0);
});

test("think and walk effects change the agent's state only where they should", (t) => {
    const FIXED = 1_800_000_000_000;

    t.mock.method(Date, "now", () => FIXED);
    const { world } = makeWorld(t, {
        "1": { id: "1", kind: "session", provider: "anthropic" },
    });

    world.derive([]);

    const agent = world.agents.get("1");

    assert.ok(agent);
    assert.equal(agent.state, "home");

    // Think from home: the agent thinks, takes spice, and keeps the provider.
    world.effect({ type: "think", c: "1", pv: "openai" });
    assert.equal(agent.state, "think");
    assert.equal(agent.spiceUntil, 35_000);
    assert.equal(agent.pv, "openai");

    // Think again while it thinks: it still thinks; no provider falls back to the session's.
    world.effect({ type: "think", c: "1" });
    assert.equal(agent.state, "think");
    assert.equal(agent.pv, "anthropic");

    // Think while it works or walks: the state stays.
    for (const state of ["work", "walk"]) {
        agent.state = state;
        world.effect({ type: "think", c: "1" });
        assert.equal(agent.state, state);
    }

    // A walk to no known place: a walking agent keeps walking, any other works where it is.
    agent.state = "walk";
    world.effect({ type: "walk", c: "1", label: "read a.go" });
    assert.equal(agent.state, "walk");
    assert.equal(agent.label, "read a.go");
    assert.equal(agent.labelUntil, 11_000);

    for (const state of ["home", "think", "work"]) {
        agent.state = state;
        world.effect({ type: "walk", c: "1", s: "nowhere", label: "x" });
        assert.equal(agent.state, "work");
    }

    // An effect for an agent that is not on the map changes nothing and does not throw.
    world.effect({ type: "think", c: "missing" });
    world.effect({ type: "walk", c: "missing", label: "x" });
});

// Each structure's canvas calls, recorded on the base commit (e5f8d92) by this same test before the refactor:
// [number of calls, sha256 of the JSON of the call list].
const STRUCTURES: [string, Record<string, unknown>, number, string][] = [
    [
        "palace",
        { id: "t1", state: "done", seed: 11, calls: 6, fails: 1, parts: {} },
        46,
        "3a625cece0fd4eb6552960e14c5272934a39ce8bb3a1aaa2b2f3c41370a5bd78",
    ],
    [
        "ruin",
        { id: "t2", state: "ruin", seed: 23, calls: 4, fails: 3, parts: { read: 1 } },
        23,
        "7784b7b484db745b3fefd01cb46f40d88d191a32d9d8f2b083e1967d3f518506",
    ],
    [
        "building",
        { id: "t3", state: "building", seed: 37, calls: 5, fails: 0, parts: { read: 3, write: 2 } },
        39,
        "884e027e397a85707c45bd031e058b632b84edafcdeec14d0aa1367fcbeb742a",
    ],
    [
        "building that fails",
        { id: "t4", state: "building", seed: 41, calls: 4, fails: 3, parts: { shell: 4 } },
        36,
        "cdef75cd279614fe2f0fef689f9e02463e8c8fdd18345d11e1800e1698934040",
    ],
];

for (const [name, task, count, hash] of STRUCTURES) {
    test(`drawStructure draws a ${name} as it did before`, (t) => {
        t.mock.method(Math, "random", () => 0.01);

        const { world, calls } = makeWorld(t, {});

        world.sun = { night: 0.2, dusk: 0.3, angle: 1.1 };
        calls.length = 0;
        world.drawStructure(task, { x: 120, y: 80 }, 9000, world.sun, "1");

        if (process.env.DUNE_RECORD) {
            console.log(name, calls.length, digest(calls));
        }

        assert.equal(calls.length, count);
        assert.equal(digest(calls), hash);
        assert.deepEqual(world.hits.at(-1)?.ref, { type: "task", owner: "1", id: task.id });
    });
}

test("the open task's name sits under the sietch's title, only close up", (t) => {
    t.mock.method(Date, "now", () => 1_800_000_000_000);

    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });

    world.derive([
        { id: 1, at: 1000, k: "msg", from: "human:Brian", to: "1", via: "human", text: "Fix it" },
    ]);
    assert.ok(world.model.open.get("1"));

    const shown: [string, Record<string, unknown>][] = [];

    world.label = (_x: number, _y: number, text: string, options: Record<string, unknown>) => {
        shown.push([text, options]);
    };

    for (const z of [0.4, 0.5, 0.51, 1]) {
        shown.length = 0;
        world.cam.z = z;
        world.drawLabels(0);

        const task = shown.find(([text]) => text === "“Fix it”");

        if (z > 0.5) {
            assert.equal(task?.[1].dy, 36, `zoom ${z}`);
        } else {
            assert.equal(task, undefined, `zoom ${z}`);
        }
    }
});

test("a replay counts its own tool calls in calls/minute, each 1 time", (t) => {
    const FIXED = 1_800_000_000_000;

    t.mock.method(Date, "now", () => FIXED);

    const calls = (from: number) =>
        [0, 1, 2].map((index) => ({
            id: index + 1,
            at: from + index * 1000,
            k: "tool",
            c: "1",
            call: `c${index}`,
            n: "read",
            s: "files",
            l: "read a.go",
        }));

    // A night: calls long past, which the live page does not hold.
    const night = makeWorld(t, { "1": { id: "1", kind: "session" } }).world;
    const old = calls(1_000_000);

    night.derive([]);
    night.startReplay(old, 1);
    // The monotonic clock is 5000 in makeWorld: 10 s later, every event of the replay has played.
    night.stepReplay(15_000);
    assert.equal(night.stats().replayAt, 1_002_000);
    assert.equal(night.stats().perMinute, 3);

    // After it, the live count is back: the calls are long past.
    night.stopReplay([]);
    assert.equal(night.stats().perMinute, 0);

    // A replay of the page's own events, from the last minute: each call counts 1 time, not 2.
    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });
    const recent = calls(FIXED - 3000);

    world.derive(recent);
    assert.equal(world.stats().perMinute, 3);
    world.startReplay(recent, 1);
    world.stepReplay(15_000);
    assert.equal(world.stats().perMinute, 3);
    world.stopReplay(recent);
    assert.equal(world.stats().perMinute, 3);
});

test("the storm's streaks move at the same speed at 60 Hz and at 120 Hz", (t) => {
    const travel = (hz: number) => {
        const { world } = makeWorld(t, {});

        world.view = { w: 100_000, h: 1000, dpr: 1 };
        world.model.storm = true;
        world.storm = 1;
        world.nextWorm = Infinity;
        world.fx.streaks = Array.from({ length: 280 }, () => ({ x: 0, y: 0, v: 600, l: 20 }));

        // 1 second of frames, from the first frame at 0 ms.
        for (let frame = 0; frame <= hz; frame++) {
            const now = (frame * 1000) / hz;

            world.update(now);
            world.drawStorm(now);
        }

        return world.fx.streaks[0].x;
    };

    const at60 = travel(60);
    const at120 = travel(120);

    // 600 px per second, at any frame rate.
    assert.ok(Math.abs(at60 - 600) < 1, `60 Hz: ${at60}`);
    assert.ok(Math.abs(at120 - 600) < 1, `120 Hz: ${at120}`);
});

test("a failed task that a new message ends is buried, and no worm comes to see it", (t) => {
    t.mock.method(Date, "now", () => 1_800_000_000_000);
    t.mock.method(Math, "random", () => 0.5);

    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });
    let id = 0;
    const ev = (k: string, data: Record<string, unknown>) => ({
        id: ++id,
        at: 1000 + id,
        k,
        ...data,
    });

    world.derive([ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Fix it" })]);

    // 8 calls, 6 of them fail: a great work, but a ruin.
    const calls = [];

    for (let index = 0; index < 8; index++) {
        calls.push(ev("tool", { c: "1", call: `c${index}`, n: "bash", s: "shell", l: "go test" }));
        calls.push(ev("done", { c: "1", call: `c${index}`, n: "bash", ok: index < 2 ? 1 : 0 }));
    }

    world.ingest(calls, true);
    world.fx.worms.length = 0;

    const first = world.model.open.get("1");

    assert.equal(first?.calls, 8);

    // A new message ends the task before the agent went idle.
    world.ingest([ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Again" })], true);

    assert.equal(first.state, "ruin");
    assert.equal(world.fx.worms.length, 0);
});

test("a great work that a new message ends still brings a worm", (t) => {
    t.mock.method(Date, "now", () => 1_800_000_000_000);
    t.mock.method(Math, "random", () => 0.5);

    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });
    let id = 0;
    const ev = (k: string, data: Record<string, unknown>) => ({
        id: ++id,
        at: 1000 + id,
        k,
        ...data,
    });

    world.derive([ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Fix it" })]);

    const calls = [];

    for (let index = 0; index < 8; index++) {
        calls.push(
            ev("tool", { c: "1", call: `c${index}`, n: "read", s: "files", l: "read a.go" }),
        );
        calls.push(ev("done", { c: "1", call: `c${index}`, n: "read", ok: 1 }));
    }

    world.ingest(calls, true);
    world.fx.worms.length = 0;
    world.ingest([ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Again" })], true);

    assert.equal(world.model.tasks.get("1")?.[0]?.state, "done");
    assert.equal(world.fx.worms.length, 1);
    assert.equal(world.fx.worms[0].rise, true);
});

test("a new message that ends a failed task says it is a ruin, as idle does", (t) => {
    const { world } = makeWorld(t, { "1": { id: "1", kind: "session" } });
    const desert = world.model;
    let id = 0;
    const ev = (k: string, data: Record<string, unknown>) =>
        desert.apply({ id: ++id, at: 1000 + id, k, ...data });

    ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Fix it" });

    for (let index = 0; index < 3; index++) {
        ev("tool", { c: "1", call: `c${index}`, n: "bash", s: "shell", l: "go test" });
        ev("done", { c: "1", call: `c${index}`, n: "bash", ok: 0 });
    }

    const effects = ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Again" });
    const built = effects.find((effect: { type: string }) => effect.type === "built");

    assert.deepEqual(built, { type: "built", owner: "1", task: "t1", ruin: true });
});
