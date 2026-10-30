// The browser module's logic that needs no browser: who each agent is, and what the events build.
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { castOf, lookup, titleName } from "../dune/cast.js";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { Desert, partOf, styleOf, titleOf } from "../dune/model.js";
// @ts-expect-error: the browser module is plain JavaScript, without types.
import { placeDef } from "../dune/places.js";

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
