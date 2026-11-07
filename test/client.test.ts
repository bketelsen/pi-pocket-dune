// The browser module's logic that needs no browser: who each agent is, and what the events build.
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { castOf, lookup, titleName } from "../dune/cast.js";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import setup, { nextAsk } from "../dune/index.js";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { Desert, nightWindow, partOf, recentIds, styleOf, titleOf } from "../dune/model.js";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { placeDef } from "../dune/places.js";

test("Desert.isBusy characterizes the rule for an agent at work", () => {
    const desert = new Desert();
    const now = 1_000_000;

    assert.equal(desert.isBusy("none", now), false);

    desert.busy.set("tool", { k: "tool", at: now });
    desert.busy.set("think", { k: "think", at: now });
    desert.busy.set("done", { k: "done", at: now });
    desert.busy.set("idle", { k: "idle", at: now });
    desert.busy.set("reply-zero", { k: "reply", at: now, calls: 0 });
    desert.busy.set("reply-none", { k: "reply", at: now });
    desert.busy.set("reply-one", { k: "reply", at: now, calls: 1 });
    desert.busy.set("exact", { k: "tool", at: now - 10 * 60_000 });
    desert.busy.set("under", { k: "tool", at: now - (10 * 60_000 - 1) });

    assert.equal(desert.isBusy("tool", now), true);
    assert.equal(desert.isBusy("think", now), true);
    assert.equal(desert.isBusy("done", now), true);
    assert.equal(desert.isBusy("idle", now), false);
    assert.equal(desert.isBusy("reply-zero", now), false);
    assert.equal(desert.isBusy("reply-none", now), false);
    assert.equal(desert.isBusy("reply-one", now), true);
    assert.equal(desert.isBusy("exact", now), false);
    assert.equal(desert.isBusy("under", now), true);
});

test("the rail badge counts only sessions at work", (t) => {
    const FIXED = 1_800_000_000_000;

    t.mock.timers.enable({ apis: ["setInterval"] });
    t.mock.method(Date, "now", () => FIXED);

    const handlers = new Map<string, (arg: unknown) => unknown>();
    const railUpdates: { badge: number | null }[] = [];
    let dispose: (() => unknown) | undefined;

    const pocket = {
        html: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        useEffect: () => undefined,
        useRef: (value: unknown) => ({ current: value }),
        useState: (value: unknown) => [
            typeof value === "function" ? value() : value,
            () => undefined,
        ],
        style: () => undefined,
        rail: () => ({
            update: (arg: { badge: number | null }) => {
                railUpdates.push(arg);
            },
        }),
        launcher: () => undefined,
        onDispose: (fn: () => unknown) => {
            dispose = fn;
        },
        on: (name: string, fn: (arg: unknown) => unknown) => {
            handlers.set(name, fn);
        },
        page: () => undefined,
        api: () => Promise.resolve({}),
    };

    setup(pocket);

    handlers.get("batch")!({
        n: 1,
        events: [
            { id: 1, at: FIXED, k: "tool", c: "tool-session" },
            { id: 2, at: FIXED, k: "think", c: "think-session" },
            { id: 3, at: FIXED, k: "idle", c: "idle-session" },
            { id: 4, at: FIXED, k: "reply", c: "reply-zero", calls: 0 },
            { id: 5, at: FIXED, k: "reply", c: "reply-two", calls: 2 },
            { id: 6, at: FIXED - 11 * 60_000, k: "tool", c: "old-session" },
        ],
    });

    assert.deepEqual(railUpdates.at(-1), { badge: 3 });

    handlers.get("batch")!({
        n: 2,
        events: [
            { id: 7, at: FIXED, k: "idle", c: "tool-session" },
            { id: 8, at: FIXED, k: "idle", c: "think-session" },
            { id: 9, at: FIXED, k: "idle", c: "idle-session" },
            { id: 10, at: FIXED, k: "idle", c: "reply-zero" },
            { id: 11, at: FIXED, k: "idle", c: "reply-two" },
            { id: 12, at: FIXED, k: "idle", c: "old-session" },
        ],
    });

    assert.deepEqual(railUpdates.at(-1), { badge: null });

    dispose?.();
});

test("a session's title names its agent", () => {
    assert.equal(titleName("Duncan Idaho: pilothouse CI fixes"), "Duncan Idaho");
    assert.equal(titleName("Miles Teg: Caddy upgrade"), "Miles Teg");
    assert.equal(titleName("Fix the build: it is red"), "Fix the build");
    assert.equal(titleName("no colon here"), undefined);
    assert.equal(titleName("This is far too long a sentence to be a name: x"), undefined);
});

test("names from the books find their characters", () => {
    assert.equal(lookup("Odrade")?.title, "Mother Superior");
    assert.equal(lookup("darwi odrade")?.name, "Odrade");
    assert.equal(lookup("Miles Teg")?.faction, "atreides");
    assert.equal(lookup("Sheeana")?.special, "worm");
    assert.equal(lookup("Muad'Dib")?.name, "Paul Muad'Dib");
    assert.equal(lookup("The Clerk")?.faction, "guild");
    assert.equal(lookup("Fix the build"), undefined);
});

test("the cast of a conversation", () => {
    const duncan = castOf({ id: "3", kind: "linked", title: "Duncan Idaho: pilothouse CI fixes" });

    assert.equal(duncan.known, true);
    assert.equal(duncan.name, "Duncan Idaho");
    assert.equal(duncan.faction.label, "House Atreides");

    const bell = castOf({ id: "5", kind: "linked", name: "bellonda" });

    assert.equal(bell.name, "Bellonda");
    assert.equal(bell.special, "mentat");

    // A stranger gets a Fremen name from its id: the same every time.
    const stranger = castOf({ id: "77", kind: "session", title: "Refactor the parser" });

    assert.equal(stranger.known, false);
    assert.equal(
        stranger.name,
        castOf({ id: "77", kind: "session", title: "Something else" }).name,
    );

    // The team extension's persona wins over a title that names no one.
    const odrade = castOf({
        id: "1",
        kind: "session",
        title: "Morning council",
        persona: "Odrade",
    });

    assert.equal(odrade.name, "Odrade");
    assert.equal(odrade.title, "Mother Superior");
    // A persona outside the books keeps its own name.
    assert.equal(castOf({ id: "4", kind: "session", title: "x", persona: "Zed" }).name, "Zed");

    // A subagent keeps the name it was given.
    assert.equal(castOf({ id: "9", kind: "subagent", name: "scout" }).name, "scout");
    // A title that names someone outside the books: that name.
    assert.equal(castOf({ id: "8", kind: "session", title: "Brian: notes" }).name, "Brian");
});

test("places are named for Arrakis", () => {
    assert.equal(placeDef("files").label, "Archives of Chapterhouse");
    assert.equal(placeDef("model:anthropic").label, "Spice Fields of Anthropic");
    assert.equal(placeDef("model:github-copilot").short, "Copilot Fields");
    assert.equal(placeDef("mcp:truenas").label, "Embassy of House Truenas");
});

test("the part each tool call adds", () => {
    assert.equal(partOf({ s: "files" }), "read");
    assert.equal(partOf({ s: "files", w: 1 }), "write");
    assert.equal(partOf({ s: "shell" }), "shell");
    assert.equal(partOf({ s: "github" }), "git");
    assert.equal(partOf({ s: "mcp:truenas" }), "mcp");
    assert.equal(partOf({ n: "team_delegate" }), "delegate");
    assert.equal(partOf({ s: "ext", n: "weird" }), "other");
});

test("a task's style is the work that weighed most", () => {
    assert.equal(styleOf({ calls: 4, fails: 0, parts: { read: 3, write: 1 } }), "read");
    assert.equal(styleOf({ calls: 4, fails: 3, parts: { read: 1, fail: 3 } }), "ruin");
    assert.equal(
        styleOf({ calls: 8, fails: 0, parts: { read: 2, write: 2, shell: 2, git: 2 } }),
        "mixed",
    );
});

test("a delegated task's title skips its preamble", () => {
    assert.equal(
        titleOf("You are Duncan.\n\nTask from the source session:\nMake CI green"),
        "Make CI green",
    );
    assert.equal(titleOf("[night-shift] Round 2: tidy up"), "Round 2: tidy up");
    assert.equal(titleOf(""), "Untold work");
});

test("events raise a structure by the sietch, and its subagent builds it too", () => {
    const convs = {
        "1": { id: "1", kind: "session" },
        "2": { id: "2", kind: "subagent", parent: "1" },
    };
    const desert = new Desert();
    let id = 0;
    const ev = (k: string, data: Record<string, unknown>): { type: string }[] =>
        desert.apply({ id: ++id, at: 1000 + id, k, ...data });

    desert.reset(convs);
    ev("msg", { from: "human:Brian", to: "1", via: "human", text: "Make the tests pass" });
    ev("tool", { c: "1", call: "a", n: "read", s: "files", i: "a.go", l: "read a.go" });
    ev("done", { c: "1", call: "a", n: "read", ok: 1 });
    ev("tool", { c: "2", call: "b", n: "bash", s: "shell", i: "go", l: "go test" });
    ev("done", { c: "2", call: "b", n: "bash", ok: 0, e: "exit 1" });

    const open = desert.open.get("1");

    assert.equal(open?.title, "Make the tests pass");
    assert.equal(open?.calls, 2);
    assert.equal(open?.fails, 1);
    assert.deepEqual(open?.helpers, ["2"]);

    const effects = ev("idle", { c: "1" });

    assert.ok(effects.some((effect: { type: string }) => effect.type === "built"));
    assert.equal(desert.tasks.get("1")?.[0]?.state, "done");
    assert.equal(desert.open.has("1"), false);
});

test("a message answered with no tool call builds nothing", () => {
    const desert = new Desert();

    desert.reset({ "1": { id: "1", kind: "session" } });
    desert.apply({
        id: 1,
        at: 1,
        k: "msg",
        from: "human:Brian",
        to: "1",
        via: "human",
        text: "hello",
    });
    desert.apply({ id: 2, at: 2, k: "idle", c: "1" });

    assert.equal(desert.tasks.get("1")?.length ?? 0, 0);
});

test("a storm rises when most calls fail", () => {
    const desert = new Desert();
    let storm = false;

    desert.reset({ "1": { id: "1", kind: "session" } });

    for (let index = 0; index < 4; index++) {
        desert.apply({
            id: index * 2 + 1,
            at: 1000 + index,
            k: "tool",
            c: "1",
            call: `c${index}`,
            n: "bash",
            s: "shell",
            l: "x",
        });

        const effects = desert.apply({
            id: index * 2 + 2,
            at: 1000 + index,
            k: "done",
            c: "1",
            call: `c${index}`,
            n: "bash",
            ok: 0,
        });

        storm ||= effects.some(
            (effect: { type: string; on?: boolean }) =>
                effect.type === "storm" && effect.on === true,
        );
    }

    assert.equal(storm, true);
    assert.equal(desert.storm, true);
});

test("a task of other tools finishes as a Landsraad Pavilion", () => {
    const desert = new Desert();

    desert.reset({ "1": { id: "1", kind: "session" } });
    desert.apply({
        id: 1,
        at: 1,
        k: "msg",
        from: "human:Brian",
        to: "1",
        via: "human",
        text: "Work the desk",
    });

    for (let index = 0; index < 3; index++) {
        desert.apply({
            id: 2 + index * 2,
            at: 2,
            k: "tool",
            c: "1",
            call: `c${index}`,
            n: "team_work",
            s: "ext",
            l: "team work",
        });
        desert.apply({
            id: 3 + index * 2,
            at: 3,
            k: "done",
            c: "1",
            call: `c${index}`,
            n: "team_work",
            ok: 1,
        });
    }

    const effects = desert.apply({ id: 20, at: 4, k: "idle", c: "1" });

    assert.ok(effects.some((effect: { type: string }) => effect.type === "built"));
    assert.match(desert.chronicle[0].text, /Landsraad Pavilion/);
});

test("the map keeps the sessions active in the last 12 hours and their ancestors", () => {
    const now = new Date(2026, 9, 31, 12, 0, 0, 0).getTime();
    const hour = 60 * 60_000;
    const convs = {
        "1": { id: "1", kind: "session", last: now - 30 * hour },
        "2": { id: "2", kind: "subagent", parent: "1", last: now - 1 * hour },
        "3": { id: "3", kind: "session", last: now - 13 * hour },
        "4": { id: "4", kind: "subagent", parent: "3", last: now - 14 * hour },
        "5": { id: "5", kind: "session", last: now - 11 * hour },
    };

    // A session quiet for 13 hours is out; the one it started is out with it.
    assert.deepEqual(recentIds(convs, now, 12 * hour), ["1", "2", "5"]);
    // The quiet work of an old session still stands beside it, while the owner looks at it.
    assert.deepEqual(recentIds(convs, now, 12 * hour, ["4"]), ["1", "2", "3", "4", "5"]);
    // A session the world does not hold keeps nothing.
    assert.deepEqual(recentIds(convs, now, 12 * hour, ["99"]), ["1", "2", "5"]);
});

test("the night runs from 20:00 to 07:00", () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0, 0).getTime();
    const lastNight = at(30, 20);
    const thisMorning = at(31, 7);

    // Late in the evening: the night began an hour ago.
    assert.deepEqual(nightWindow(at(31, 21)), { from: at(31, 20), to: at(31, 21) });
    // In the small hours: the night goes on.
    assert.deepEqual(nightWindow(at(31, 3)), { from: lastNight, to: at(31, 3) });
    // In the day: the whole of the last night.
    assert.deepEqual(nightWindow(at(31, 10)), { from: lastNight, to: thisMorning });
});

test("a compact night of events builds a finished work", () => {
    const desert = new Desert();

    desert.reset({ "1": { id: "1", kind: "session" } });

    // The shape the history route sends: a number for the call, and no error text.
    const night = [
        {
            id: 1,
            at: 1000,
            k: "msg",
            from: "human:Brian",
            to: "1",
            via: "human",
            text: "Night work",
        },
        {
            id: 2,
            at: 2000,
            k: "tool",
            c: "1",
            call: 1,
            n: "read",
            s: "files",
            i: "a.go",
            l: "read a.go",
        },
        { id: 3, at: 2500, k: "done", c: "1", call: 1, n: "read", ok: 1 },
        {
            id: 4,
            at: 3000,
            k: "tool",
            c: "1",
            call: 2,
            n: "bash",
            s: "shell",
            i: "go test",
            l: "go test ./...",
        },
        { id: 5, at: 4000, k: "done", c: "1", call: 2, n: "bash", ok: 1 },
        { id: 6, at: 5000, k: "idle", c: "1" },
    ];
    const effects = night.flatMap((event) => desert.apply(event));

    assert.ok(effects.some((effect: { type: string }) => effect.type === "built"));
    assert.equal(desert.tasks.get("1")?.[0]?.state, "done");
    assert.equal(desert.open.has("1"), false);
});

test("a store without the focus session asks for the focus first", () => {
    const other = { id: "2", kind: "session", title: "Another session" };
    const convs = { "2": other };
    const question = (
        focus: string | null,
        held: Record<string, { id: string; kind: string; title?: string }> = convs,
        asked: Set<string> = new Set(),
        retryAt: Map<string, number> = new Map(),
    ) =>
        nextAsk({
            convs: held,
            unknown: new Map<string, number>(),
            visible: Object.keys(held),
            focus,
            asked,
            askedAt: new Map<string, number>(),
            askedTries: new Map<string, number>(),
            retryAt,
            now: 1000,
        });

    // The focus session was quiet for more than 12 hours: the world leaves it out, so ask for it first.
    assert.equal(question("7"), "7");

    // Asked once already, or the world holds it now: another session comes next.
    assert.equal(question("7", convs, new Set(["7"])), "2");
    assert.equal(question("7", { ...convs, "7": { id: "7", kind: "session" } }), "2");

    // A focus that is not a session of the server (a person, the demo) is nobody to ask about.
    assert.equal(question("human:Brian"), "2");

    // A failed ask waits, like any other.
    assert.equal(question("7", convs, new Set(), new Map([["7", 5000]])), "2");
    // A focus that is not numeric but is in the world: no question about it either.
    assert.equal(question(null, convs, new Set(["2"])), null);
});

test("an empty world still asks for a missing focus session", () => {
    // The automatic demo shows a desert of its own, so the page names no session of the server: only the focus
    // session can be chosen, and its answer ends the demo.
    const want = nextAsk({
        convs: {},
        unknown: new Map<string, number>(),
        visible: [],
        focus: "12",
        asked: new Set<string>(),
        askedAt: new Map<string, number>(),
        askedTries: new Map<string, number>(),
        retryAt: new Map<string, number>(),
        now: 1000,
    });

    assert.equal(want, "12");

    // No focus, or one the server cannot name: nothing to ask, so the demo runs on.
    assert.equal(
        nextAsk({
            convs: {},
            unknown: new Map<string, number>(),
            visible: [],
            focus: "human:Brian",
            asked: new Set<string>(),
            askedAt: new Map<string, number>(),
            askedTries: new Map<string, number>(),
            retryAt: new Map<string, number>(),
            now: 1000,
        }),
        null,
    );
});
