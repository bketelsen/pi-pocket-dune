import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Host, Web } from "../_pocket.d.ts";
import setup from "../dune.ts";

type Handler = (...args: never[]) => unknown;
type Route = (request: unknown) => unknown;

let dataDir = "";

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "dune-"));
    // Each test starts a fresh world: no handover from the one before.
    forgetHandover();
});

/** Like a restart: the next module starts from its file, not from the one before it in this process. */
function forgetHandover() {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("x.dune.state")];
}

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
});

async function harness() {
    const routes = new Map<string, Route>();
    const sent: { event: string; data: unknown }[] = [];
    const disposers: (() => unknown)[] = [];
    let client = "";
    const web = {
        route: (method: string, path: string, handle: Route) =>
            routes.set(`${method} ${path}`, handle),
        conversationRoute: (
            method: string,
            path: string,
            handle: Route,
            options: { conversation: string },
        ) => {
            assert.equal(options.conversation, "source");
            routes.set(`${method} ${path}`, handle);
        },
        client: (entry: string) => {
            client = entry;
        },
        send: (event: string, data: unknown) => sent.push({ event, data }),
        onDispose: (run: () => unknown) => disposers.push(run),
    };
    const extension = (await setup({ dataDir } as Host, web as unknown as Web)) as unknown as {
        name: string;
        hooks: { handlers: Record<string, Handler> }[];
    };
    const handlers = Object.assign({}, ...extension.hooks.map((each) => each.handlers)) as Record<
        string,
        (...args: unknown[]) => unknown
    >;
    const api = (conversationId: string, taskId = `task-${conversationId}`) => ({
        conversationId,
        taskId,
        snapshot: async () => undefined,
    });
    const tool = (id: string, conversation: string, name: string, args: object) =>
        handlers.beforeTool!({ id, name, arguments: args }, api(conversation));
    const world = () =>
        routes.get("GET world")!({}) as {
            convs: Record<string, unknown>;
            events: Record<string, unknown>[];
            unknown: string[];
        };
    const meta = (id: string, title = "A session") =>
        routes.get("GET meta/:source")!({
            conversation: { id, title, cwd: "/work" },
            linkedSessions: { list: async () => [] },
            snapshot: async () => undefined,
            context: {},
        }) as Promise<{ events: unknown[] }>;
    const dispose = async () => {
        for (const run of disposers) {
            await run();
        }
    };

    return {
        extension,
        handlers,
        routes,
        sent,
        client: () => client,
        api,
        tool,
        world,
        meta,
        dispose,
    };
}

test("it adds its routes and its page, and names its extension", async () => {
    const town = await harness();

    assert.equal(town.extension.name, "dune");
    assert.deepEqual([...town.routes.keys()].sort(), [
        "GET meta/:source",
        "GET world",
        "POST reset",
    ]);
    assert.equal(town.client(), "dune");
    assert.deepEqual(Object.keys(town.handlers).sort(), [
        "afterResponse",
        "afterTool",
        "beforeRequest",
        "beforeTool",
        "onYield",
    ]);
    await town.dispose();
});

test("its hooks change no call, and never throw, whatever they are given", async () => {
    const town = await harness();
    const api = town.api("1");

    assert.equal(
        town.handlers.beforeTool!({ id: "a", name: "bash", arguments: { command: "ls" } }, api),
        undefined,
    );
    assert.equal(
        town.handlers.afterTool!({ id: "a", name: "bash" }, { isError: false }, api),
        undefined,
    );
    assert.equal(await town.handlers.beforeRequest!({ messages: [] }, api, {}), undefined);
    assert.equal(
        town.handlers.afterResponse!({ content: [], provider: "p", model: "m" }, api),
        undefined,
    );
    assert.equal(town.handlers.onYield!({ content: [] }, api), undefined);

    // Nonsense in: still nothing out, and nothing thrown (each hook logs its own error).
    const warn = console.warn;

    console.warn = () => {};

    try {
        for (const name of Object.keys(town.handlers)) {
            assert.doesNotThrow(() => town.handlers[name]!(null, null, null));
            assert.equal(await town.handlers[name]!(null, null, null), undefined);
        }
    } finally {
        console.warn = warn;
    }

    await town.dispose();
});

test("a session stays hidden until Pi Pocket confirms that the owner may see it", async () => {
    const town = await harness();

    town.tool("t1", "7", "read", { path: "/secret/plan.md" });
    town.tool("t2", "8", "read", { path: "/other/notes.md" });

    let world = town.world();

    assert.equal(world.events.length, 0);
    assert.deepEqual(Object.keys(world.convs), []);
    assert.deepEqual(world.unknown.sort(), ["7", "8"]);

    const answer = await town.meta("7");

    assert.ok(answer.events.length > 0);
    world = town.world();
    assert.deepEqual(Object.keys(world.convs), ["7"]);
    assert.ok(world.events.every((event) => event.c === "7"));
    assert.ok(world.events.some((event) => event.c === "7"));
    await town.dispose();
});

test("the file on disk keeps no words, paths, or titles of an unconfirmed session", async () => {
    const town = await harness();

    town.tool("t1", "7", "bash", { command: "cat /home/someone/private.txt" });
    town.tool("t2", "9", "read", { path: "/mine/readme.md" });
    await town.meta("9", "Mine");
    await town.dispose();

    const saved = JSON.parse(await readFile(join(dataDir, "dune", "world.json"), "utf8"));
    const hidden = saved.events.filter((event: { c?: string }) => event.c === "7");

    assert.ok(hidden.length > 0);

    for (const event of hidden) {
        for (const field of ["text", "l", "i", "e", "name", "title", "tn"]) {
            assert.equal(event[field], undefined, `field ${field} of a hidden event was saved`);
        }
    }

    assert.ok(!JSON.stringify(saved).includes("private.txt"));
    assert.ok(JSON.stringify(saved).includes("readme.md"));
});

test("a subagent's name goes in its own field, never where a session id belongs", async () => {
    const town = await harness();

    await town.meta("3");
    town.tool("t1", "3", "subagent", { action: "spawn", name: "reviewer" });

    const event = town.world().events.find((each) => each.n === "subagent");

    assert.ok(event, "the subagent call shows");
    assert.equal(event.tn, "reviewer");
    assert.equal(event.to, undefined);
    await town.dispose();
});

test("a shell command's label drops its leading cd", async () => {
    const town = await harness();

    await town.meta("4");
    town.tool("t1", "4", "bash", { command: "cd /home/me/project && npm test" });

    const event = town.world().events.find((each) => each.k === "tool");

    assert.equal(event?.l, "npm test");
    assert.equal(event?.i, "npm");
    await town.dispose();
});

test("a model request is never held: the hook returns at once", async () => {
    const town = await harness();
    const result = town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
        town.api("5"),
        {},
    );

    assert.equal(result, undefined);
    await town.dispose();
});

test("a call that runs twice in one process is counted once", async () => {
    const town = await harness();

    await town.meta("6");
    town.tool("same", "6", "read", { path: "a.md" });
    town.tool("same", "6", "read", { path: "a.md" });

    assert.equal(town.world().events.filter((event) => event.k === "tool").length, 1);
    await town.dispose();
});

test("matching words never show an unrelated conversation", async () => {
    const town = await harness();
    const text = "Please inspect these exact requirements before proceeding";

    await town.meta("1");
    town.tool("spawn", "1", "subagent", { action: "spawn", name: "reviewer", message: text });
    town.handlers.beforeRequest!(
        {
            messages: [
                { role: "user", content: `${text}\nPRIVATE OTHER PERSON DATA`, timestamp: 1 },
            ],
        },
        town.api("2"),
        {},
    );
    assert.equal(town.world().convs["2"], undefined);
    assert.ok(!JSON.stringify(town.world()).includes("PRIVATE OTHER PERSON DATA"));

    // The parent's own tool result names the child: now it shows.
    town.handlers.afterTool!(
        {
            id: "spawn",
            name: "subagent",
            arguments: { action: "spawn", name: "reviewer", message: text },
        },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name: "reviewer", action: "spawn" },
        },
        town.api("1"),
    );
    assert.ok(town.world().convs["2"]);
    await town.dispose();
});

test("a reset sends nothing from before it", async () => {
    const town = await harness();

    await town.meta("1");
    town.tool("old", "1", "read", { path: "/old-private-path.md" });
    await town.routes.get("POST reset")!({});
    await town.meta("1");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(town.world().events.length, 0);
    assert.ok(!JSON.stringify(town.sent).includes("/old-private-path.md"));
    await town.dispose();
});

test("a call that runs again after a restart is counted once", async () => {
    const first = await harness();

    await first.meta("1");
    first.tool("same", "1", "read", { path: "a.md" });
    await first.dispose();
    forgetHandover();

    const reopened = await harness();

    reopened.tool("same", "1", "read", { path: "a.md" });
    assert.equal(reopened.world().events.filter((event) => event.k === "tool").length, 1);
    assert.equal((reopened.world().convs["1"] as { calls: number }).calls, 1);
    await reopened.dispose();
});

test("no name from outside reaches Object.prototype", async () => {
    const town = await harness();

    await town.meta("1");
    town.tool("p1", "1", "read", { path: "__proto__" });
    town.tool("p2", "1", "__proto__", {});
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: "[from: __proto__] hello", timestamp: 7 }] },
        town.api("1"),
        {},
    );
    await town.dispose();

    const probe = {} as Record<string, unknown>;

    for (const field of ["n", "r", "w", "last", "count", "name"]) {
        assert.equal(probe[field], undefined, `Object.prototype.${field} was set`);
    }

    // And not after a restart from the file either.
    forgetHandover();
    await (await harness()).dispose();
    assert.equal(({} as Record<string, unknown>).last, undefined);
});

test("a burst goes out in batches small enough for the app, numbered in order", async () => {
    const town = await harness();

    await town.meta("1");

    for (let index = 0; index < 1500; index++) {
        town.tool(`c${index}`, "1", "read", { path: `src/${"deep/".repeat(12)}file-${index}.ts` });
    }

    await new Promise((resolve) => setTimeout(resolve, 2600));

    const batches = town.sent.filter((each) => each.event === "batch").map((each) => each.data);

    assert.ok(batches.length > 1);

    for (const batch of batches) {
        assert.ok(JSON.stringify(batch).length < 256 * 1024, "a batch is under 256 KiB");
    }

    const numbers = batches.map((batch) => (batch as { n: number }).n);

    assert.deepEqual(
        numbers,
        numbers.map((_, index) => numbers[0]! + index),
    );

    const events = batches.flatMap((batch) => (batch as { events: { k: string }[] }).events);

    assert.equal(events.filter((event) => event.k === "tool").length, 1500);
    await town.dispose();
});

test("what looks like a secret is masked before it is kept", async () => {
    const town = await harness();

    await town.meta("1");
    town.tool("s1", "1", "bash", {
        command: "curl -H 'Authorization: Bearer abcdef1234567890' https://x",
    });
    town.tool("s2", "1", "bash", {
        command: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv node run.js",
    });
    town.tool("s3", "1", "bash", {
        command: "git push https://ghp_abcdefghijklmnopqrstuvwxyz@github.com/x",
    });

    const kept = JSON.stringify(town.world());

    for (const secret of [
        "abcdef1234567890",
        "sk-abcdefghijklmnopqrstuv",
        "ghp_abcdefghijklmnopqrstuvwxyz",
    ]) {
        assert.ok(!kept.includes(secret), `${secret} was kept`);
    }

    await town.dispose();
});

// The formats below belong to Pi Pocket, not to this module, and can change in any release
// (api-stability.md, "What is internal"). These tests pin what Pi Pocket 0.19.0 sends.
test("Pi Pocket 0.19 formats: a person's name, a linked session, and a schedule", async () => {
    const town = await harness();

    await town.meta("1");
    await town.meta("2");
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: "[from: Sam] can you look?", timestamp: 1 }] },
        town.api("1"),
        {},
    );
    town.tool("t1", "1", "team", {
        action: "start",
        title: "Docs",
        message: "Write the docs for the new limit please",
    });
    town.handlers.beforeRequest!(
        {
            messages: [
                {
                    role: "user",
                    content:
                        "Message from linked session Docs (address abc)\n<linked-session-message>\nWrite the docs for the new limit please\n</linked-session-message>",
                    timestamp: 2,
                },
            ],
        },
        town.api("2"),
        {},
    );
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: "[scheduled] check the build", timestamp: 3 }] },
        town.api("1x"),
        {},
    );

    const world = town.world();
    const messages = world.events.filter((event) => event.k === "msg");

    assert.ok(messages.some((event) => event.from === "human:Sam" && event.to === "1"));
    assert.equal((world.convs["2"] as { parent?: string; kind: string }).parent, "1");
    assert.equal((world.convs["2"] as { kind: string }).kind, "linked");
    assert.ok(
        world.events.some((event) => event.k === "link" && event.c === "2" && event.p === "1"),
    );
    await town.dispose();
});

test("two different messages with the same time both arrive, and old ones never come back", async () => {
    const town = await harness();
    const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
    const ask = (messages: unknown[]) =>
        town.handlers.beforeRequest!({ messages }, town.api("1", `task-${messages.length}`), {});

    await town.meta("1");

    const history = [user("first", 5), { role: "assistant", content: [], timestamp: 6 }];

    ask(history);
    // Two messages placed at one moment (Pi Durable gives them the same time).
    history.push(user("one", 10), user("two", 10));
    ask(history);

    const both = town
        .world()
        .events.filter((event) => event.k === "msg")
        .map((event) => event.text);

    assert.deepEqual(both, ["one", "two"]);

    // Thousands more, then a compaction keeps only the last few: none of the old ones is new again.
    for (let index = 0; index < 6000; index++) {
        history.push(user(`m${index}`, 100 + index));
    }

    ask(history);

    const lastId = Math.max(...town.world().events.map((event) => event.id as number));

    ask([user("summary", 1), ...history.slice(-3), user("newest", 99_999)]);

    const added = town
        .world()
        .events.filter((event) => (event.id as number) > lastId && event.k === "msg")
        .map((event) => event.text);

    assert.deepEqual(added, ["newest"]);
    await town.dispose();
});

test("a subagent's first events reach open pages once its parent's result names it", async () => {
    const town = await harness();
    const text = "Find every caller of spend.check and list them";

    await town.meta("1");
    town.tool("spawn", "1", "subagent", { action: "spawn", name: "scout", message: text });
    // The subagent starts before its parent's tool call returns.
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: text, timestamp: 1 }] },
        town.api("2"),
        {},
    );
    town.tool("r1", "2", "read", { path: "src/spend.ts" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    town.handlers.afterTool!(
        {
            id: "spawn",
            name: "subagent",
            arguments: { action: "spawn", name: "scout", message: text },
        },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name: "scout", action: "spawn" },
        },
        town.api("1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const sent = town.sent
        .filter((each) => each.event === "batch")
        .flatMap((each) => {
            const batch = each.data as {
                events: { c?: string; k: string }[];
                late?: { c?: string; k: string }[];
            };

            return [...batch.events, ...(batch.late ?? [])];
        });

    assert.ok(
        sent.some((event) => event.c === "2" && event.k === "tool"),
        "its read went out",
    );
    await town.dispose();
});

test("a hidden session never keeps the pages busy with empty batches", async () => {
    const town = await harness();

    town.tool("t1", "9", "read", { path: "a.md" });
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const batches = town.sent.filter((each) => each.event === "batch");

    assert.ok(batches.length <= 1, `${batches.length} batches for one hidden call`);
    await town.dispose();
});

test("batches stay under the app's limit in bytes, not characters", async () => {
    const town = await harness();

    await town.meta("1");

    for (let index = 0; index < 1200; index++) {
        town.tool(`u${index}`, "1", "bash", {
            command: `echo ${"日本語のテキスト".repeat(12)} ${index}`,
        });
    }

    await new Promise((resolve) => setTimeout(resolve, 2600));

    for (const each of town.sent.filter((sent) => sent.event === "batch")) {
        assert.ok(Buffer.byteLength(JSON.stringify(each.data)) < 256 * 1024);
    }

    await town.dispose();
});

test("passwords in flags, JSON, and addresses are masked too", async () => {
    const town = await harness();

    await town.meta("1");
    town.tool("s1", "1", "bash", { command: "mysql --password hunter2xyz -u root" });
    town.tool("s2", "1", "bash", { command: "curl -u admin:topsecret9 https://api.example.com" });
    town.tool("s3", "1", "bash", { command: "git clone https://me:tok3nvalue@example.com/r.git" });
    town.tool("s4", "1", "bash", { command: `curl -d '{"password":"pa55word!"}' https://x` });

    const kept = JSON.stringify(town.world());

    for (const secret of ["hunter2xyz", "topsecret9", "tok3nvalue", "pa55word!"]) {
        assert.ok(!kept.includes(secret), `${secret} was kept`);
    }

    await town.dispose();
});

test("in one flush: another session's event, a hidden child's, then the parent's result; each goes out once", async () => {
    const town = await harness();
    const text = "Read the spend module and report what calls it";

    await town.meta("7");
    town.tool("spawn", "7", "subagent", { action: "spawn", name: "scout", message: text });
    await new Promise((resolve) => setTimeout(resolve, 300));
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: text, timestamp: 1 }] },
        town.api("9"),
        {},
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Now, all within one flush:
    town.tool("other", "7", "read", { path: "a.md" });
    town.tool("child", "9", "read", { path: "b.md" });
    town.handlers.afterTool!(
        {
            id: "spawn",
            name: "subagent",
            arguments: { action: "spawn", name: "scout", message: text },
        },
        {
            isError: false,
            output: [],
            details: { conversationId: "9", name: "scout", action: "spawn" },
        },
        town.api("7"),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const ids = town.sent
        .filter((each) => each.event === "batch")
        .flatMap((each) => {
            const batch = each.data as { events?: { id: number }[]; late?: { id: number }[] };

            return [...(batch.events ?? []), ...(batch.late ?? [])].map((event) => event.id);
        });

    assert.equal(new Set(ids).size, ids.length, "no event went out twice");

    const sentTools = town.sent
        .filter((each) => each.event === "batch")
        .flatMap((each) => {
            const batch = each.data as {
                events?: Record<string, unknown>[];
                late?: Record<string, unknown>[];
            };

            return [...(batch.events ?? []), ...(batch.late ?? [])];
        })
        .filter((event) => event.k === "tool");

    assert.ok(sentTools.some((event) => event.c === "7" && event.i === "a.md"));
    assert.ok(sentTools.some((event) => event.c === "9" && event.i === "b.md"));
    await town.dispose();
});

test("late events of a burst stay within the byte limit", async () => {
    const town = await harness();
    const text = "Investigate the flaky animation test and report";

    await town.meta("1");
    town.tool("spawn", "1", "subagent", { action: "spawn", name: "deep", message: text });
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: text, timestamp: 1 }] },
        town.api("2"),
        {},
    );

    for (let index = 0; index < 300; index++) {
        town.handlers.afterResponse!(
            {
                content: [{ type: "text", text: `${"long answer ".repeat(60)} ${index}` }],
                provider: "p",
                model: "m",
                timestamp: 1000 + index,
                usage: { input: 1, output: 1, cost: { total: 0 } },
            },
            town.api("2", `t${index}`),
        );
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    town.handlers.afterTool!(
        {
            id: "spawn",
            name: "subagent",
            arguments: { action: "spawn", name: "deep", message: text },
        },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name: "deep", action: "spawn" },
        },
        town.api("1"),
    );
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const batches = town.sent.filter((each) => each.event === "batch").map((each) => each.data);

    for (const batch of batches) {
        assert.ok(Buffer.byteLength(JSON.stringify(batch)) < 256 * 1024);
    }

    const late = batches.flatMap((batch) => (batch as { late?: { k: string }[] }).late ?? []);

    assert.equal(late.filter((event) => event.k === "reply").length, 300);
    await town.dispose();
});

// The owner's own team tools, and the stations that send word into a session.
test("team_delegate links the session it starts, though its first message opens with a preamble", async () => {
    const town = await harness();
    const task = "Audit the spice harvest ledger and report every gap you find";

    await town.meta("1");
    await town.meta("2");
    town.tool("d1", "1", "team_delegate", { agent: "stilgar", task, title: "Ledger audit" });

    const call = town.world().events.find((event) => event.n === "team_delegate");

    assert.equal(call?.a, "start");
    assert.equal(call?.tn, "stilgar");
    assert.equal(call?.l, "delegate stilgar Ledger audit");

    town.handlers.beforeRequest!(
        {
            messages: [
                {
                    role: "user",
                    content: `Message from linked session Stilgar: Ledger audit (address abc)\n<linked-session-message>\nYou are Stilgar, naib of Sietch Tabr.\nWork in the worktree at /work/tabr.\n\nTask from the source session:\n${task}\n</linked-session-message>`,
                    timestamp: 1,
                },
            ],
        },
        town.api("2"),
        {},
    );

    const world = town.world();
    const linked = world.convs["2"] as { parent?: string; kind: string; name?: string };

    assert.equal(linked.kind, "linked");
    assert.equal(linked.parent, "1");
    assert.equal(linked.name, "stilgar");
    assert.ok(
        world.events.some((event) => event.k === "link" && event.c === "2" && event.p === "1"),
    );
    assert.ok(
        world.events.some(
            (event) =>
                event.k === "msg" &&
                event.from === "1" &&
                event.to === "2" &&
                event.via === "team" &&
                event.text === task,
        ),
    );
    await town.dispose();
});

test("team_message goes to its session as a team message", async () => {
    const town = await harness();
    const message = "The worm sign is moving toward the eastern ridge now";

    await town.meta("1");
    await town.meta("2");
    town.tool("m1", "1", "team_message", { to: "chani", message });

    const call = town.world().events.find((event) => event.n === "team_message");

    assert.equal(call?.a, "send");
    assert.equal(call?.tn, "chani");
    assert.equal(call?.l, "message chani");

    town.handlers.beforeRequest!(
        {
            messages: [
                {
                    role: "user",
                    content: `Message from linked session Main (address abc)\n<linked-session-message>\n${message}\n</linked-session-message>`,
                    timestamp: 1,
                },
            ],
        },
        town.api("2"),
        {},
    );

    const world = town.world();

    assert.ok(
        world.events.some(
            (event) =>
                event.k === "msg" && event.from === "1" && event.to === "2" && event.via === "team",
        ),
    );
    // No task marker: the message shows the body as it is.
    assert.ok(world.events.some((event) => event.k === "msg" && event.text === message));
    // A message, not a start: the session stays a session of its own.
    assert.equal((world.convs["2"] as { kind: string }).kind, "session");
    await town.dispose();
});

test("the night shift and the desk send word from their stations", async () => {
    const town = await harness();

    await town.meta("1");
    town.handlers.beforeRequest!(
        {
            messages: [
                { role: "user", content: "[night-shift] run the nightly checks", timestamp: 1 },
                { role: "user", content: "[desk] a new ticket came in", timestamp: 2 },
            ],
        },
        town.api("1"),
        {},
    );

    const messages = town.world().events.filter((event) => event.k === "msg");

    assert.ok(
        messages.some(
            (event) =>
                event.from === "station:night" &&
                event.to === "1" &&
                event.via === "system" &&
                event.text === "[night-shift] run the nightly checks",
        ),
    );
    assert.ok(
        messages.some(
            (event) => event.from === "station:desk" && event.to === "1" && event.via === "system",
        ),
    );
    assert.ok(!messages.some((event) => event.via === "human"));
    await town.dispose();
});

test("the team extension names a session's agent when its title does not", async () => {
    const town = await harness();
    const key = Symbol.for("pi-pocket-team.team");
    const shared = globalThis as unknown as Record<symbol, unknown>;
    const asked: unknown[] = [];

    shared[key] = {
        version: 1,
        persona: async (read: { snapshot: unknown }, conversationId: unknown) => {
            asked.push(conversationId);
            assert.equal(typeof read.snapshot, "function");

            return conversationId === "1"
                ? { id: "odrade", name: "Odrade", role: "supervisor" }
                : undefined;
        },
    };

    try {
        await town.meta("1", "Morning council");
        await town.meta("2", "Something else");

        const world = town.world();

        assert.equal((world.convs["1"] as { persona?: string }).persona, "Odrade");
        assert.equal((world.convs["2"] as { persona?: string }).persona, undefined);
        assert.deepEqual(asked, ["1", "2"]);
    } finally {
        delete shared[key];
        await town.dispose();
    }
});

test("a failing team extension changes nothing", async () => {
    const town = await harness();
    const key = Symbol.for("pi-pocket-team.team");
    const shared = globalThis as unknown as Record<symbol, unknown>;

    shared[key] = {
        persona: async () => {
            throw new Error("no documents");
        },
    };

    try {
        await town.meta("1", "Morning council");
        assert.equal((town.world().convs["1"] as { title?: string }).title, "Morning council");
        assert.equal((town.world().convs["1"] as { persona?: string }).persona, undefined);
    } finally {
        delete shared[key];
        await town.dispose();
    }
});
