import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { Host, Web } from "../_pocket.d.ts";
import setup, { capHistory, setHistoryBudgetForTests } from "../dune.ts";

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

/** Every harness a test made: a test whose assertion fails before its own dispose is disposed here, so the run ends. */
const open: (() => Promise<void>)[] = [];

afterEach(async () => {
    for (const dispose of open.splice(0)) {
        await dispose();
    }

    await rm(dataDir, { recursive: true, force: true });
});

/** Wait for a real save: those tests mock the module's timers, so a real pause is the one that waits. */
async function until(check: () => Promise<boolean>) {
    for (let round = 0; round < 200; round++) {
        if (await check()) {
            return;
        }

        await sleep(10);
    }
}

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
            active: number;
        };
    const history = (query = "") =>
        routes.get("GET history")!({ query: new URLSearchParams(query) }) as {
            from: number;
            to: number;
            now: number;
            convs: Record<string, { title?: string; tools?: unknown }>;
            events: Record<string, unknown>[];
        };
    const meta = (
        id: string,
        title = "A session",
        linked: { conversationId: string; title?: string }[] = [],
    ) =>
        routes.get("GET meta/:source")!({
            conversation: { id, title, cwd: "/work" },
            linkedSessions: { list: async () => linked },
            snapshot: async () => undefined,
            context: {},
        }) as Promise<{ events: unknown[] }>;
    // Once only: the test's own call, or else the one in afterEach.
    const dispose = async () => {
        for (const run of disposers.splice(0)) {
            await run();
        }
    };

    open.push(dispose);

    return {
        extension,
        handlers,
        routes,
        sent,
        client: () => client,
        api,
        tool,
        world,
        history,
        meta,
        dispose,
    };
}

test("it adds its routes and its page, and names its extension", async () => {
    const town = await harness();

    assert.equal(town.extension.name, "dune");
    assert.deepEqual([...town.routes.keys()].sort(), [
        "GET history",
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
    assert.equal((await stat(join(dataDir, "dune", "world.json"))).mode & 0o777, 0o600);
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

test("a conversation's title is masked and cut before it is kept", async () => {
    const town = await harness();
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const title = `deploy with OPENAI_API_KEY=${secret} and then tell everyone about it`;

    await town.meta("7", title);

    const kept = (town.world().convs["7"] as { title?: string }).title;

    assert.ok(kept, "the title is kept");
    assert.ok(!kept.includes(secret), "the secret was kept in the title");
    assert.ok(kept.length <= 60, `the title is ${kept.length} characters`);

    await town.dispose();

    const saved = JSON.parse(await readFile(join(dataDir, "dune", "world.json"), "utf8"));
    const onDisk = saved.convs["7"].title as string;

    assert.ok(!onDisk.includes(secret), "the secret was saved in the title");
    assert.ok(onDisk.length <= 60, `the saved title is ${onDisk.length} characters`);
    assert.equal((await stat(join(dataDir, "dune", "world.json"))).mode & 0o777, 0o600);
});

test("a linked session's title is masked before it is kept", async () => {
    const town = await harness();
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz";
    const title = `linked work with token ${secret} and many more words after that`;

    // The linked session is one the owner may see already.
    town.tool("t1", "2", "read", { path: "/work/notes.md" });
    await town.meta("2", "Linked session");

    await town.meta("1", "Mine", [{ conversationId: "2", title }]);

    const kept = (town.world().convs["2"] as { title?: string }).title;

    assert.ok(kept, "its title is kept");
    assert.ok(!kept.includes(secret), "the secret was kept in the linked title");
    assert.ok(kept.length <= 60, `the linked title is ${kept.length} characters`);
    await town.dispose();
});

test("a stop message masks the name it carries", async () => {
    const town = await harness();
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const name = `reviewer ${secret}`;

    await town.meta("1");
    town.handlers.afterTool!(
        { id: "spawn", name: "subagent", arguments: { action: "stop", name } },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name, action: "stop" },
        },
        town.api("1"),
    );

    const event = town.world().events.find((each) => each.via === "stop");

    assert.ok(event, "the stop shows");
    assert.ok(!String(event.text).includes(secret), "the secret was kept in the stop message");
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

test("the shift and the desk send word from their stations", async () => {
    const town = await harness();

    await town.meta("1");
    town.handlers.beforeRequest!(
        {
            messages: [
                { role: "user", content: "[night-shift] run the nightly checks", timestamp: 1 },
                { role: "user", content: "[desk] a new ticket came in", timestamp: 2 },
                { role: "user", content: "[shift] Round 2 of 20: tidy up", timestamp: 3 },
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
    // A shift's round since its rename: the same station as the older [night-shift].
    assert.ok(
        messages.some(
            (event) =>
                event.from === "station:night" &&
                event.to === "1" &&
                event.via === "system" &&
                event.text === "[shift] Round 2 of 20: tidy up",
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

// Only the sessions with something in the last 12 hours, and the sietches they hang from.
test("the world shows only the sessions active in the last 12 hours, with their ancestors", async (t) => {
    const town = await harness();
    const start = Date.now();

    await town.meta("1", "Old sietch");
    await town.meta("2", "Quiet sietch");
    // A subagent that 1's own tool call started, then left alone.
    town.handlers.afterTool!(
        { id: "spawn", name: "subagent", arguments: { action: "spawn", name: "scout" } },
        {
            isError: false,
            output: [],
            details: { conversationId: "3", name: "scout", action: "spawn" },
        },
        town.api("1"),
    );
    // A session nobody confirmed, and nothing in it since.
    town.tool("h1", "9", "read", { path: "a.md" });

    // Thirteen hours on, only the subagent works: its sietch 1 shows with it, and 2 and 9 do not.
    t.mock.method(Date, "now", () => start + 13 * 60 * 60_000);
    town.tool("t1", "3", "read", { path: "b.md" });

    const world = town.world();

    assert.deepEqual(Object.keys(world.convs).sort(), ["1", "3"]);
    assert.equal(world.active, 12 * 60 * 60_000);
    assert.deepEqual(world.unknown, []);
    await town.dispose();
});

test("asking for a session's meta again does not make an old session active", async (t) => {
    const town = await harness();

    await town.meta("1", "First look");

    const first = (town.world().convs["1"] as { last: number }).last;

    t.mock.method(Date, "now", () => first + 60_000);
    await town.meta("1", "Asked again");

    assert.equal((town.world().convs["1"] as { last: number }).last, first);

    // A session seen for the first time is new now.
    await town.meta("2");
    assert.equal((town.world().convs["2"] as { last: number }).last, first + 60_000);
    await town.dispose();
});

test("the history keeps tool, done, msg, link, and idle, short and without error text", async (t) => {
    const town = await harness();
    const start = Date.now();
    const long = "x".repeat(400);

    await town.meta("1", "Mine");
    town.tool("t1", "1", "bash", { command: `echo ${long}` });
    town.handlers.afterTool!(
        { id: "t1", name: "bash" },
        { isError: true, output: [{ type: "text", text: "a private error" }] },
        town.api("1"),
    );
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: `[from: Sam] ${long}`, timestamp: 1 }] },
        town.api("1", "task-one"),
        {},
    );
    town.handlers.afterResponse!(
        { content: [{ type: "text", text: long }], provider: "p", model: "m", timestamp: 2 },
        town.api("1", "task-two"),
    );
    town.handlers.onYield!({ content: [] }, town.api("1", "task-three"));
    town.handlers.afterTool!(
        { id: "spawn", name: "subagent", arguments: { action: "spawn", name: "scout" } },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name: "scout", action: "spawn" },
        },
        town.api("1"),
    );

    const answer = town.history(`from=${start - 1000}&to=${start + 10_000}`);
    const kinds = new Set(answer.events.map((each) => each.k));

    for (const kind of ["tool", "done", "msg", "link", "idle"]) {
        assert.ok(kinds.has(kind), `${kind} is in the history`);
    }

    assert.ok(!kinds.has("think"));
    assert.ok(!kinds.has("reply"));

    const tool = answer.events.find((each) => each.k === "tool" && each.n === "bash");
    const done = answer.events.find((each) => each.k === "done" && each.n === "bash");
    const said = answer.events.find((each) => each.k === "msg" && each.via === "human");

    assert.equal(typeof tool?.call, "number", "a call is a number, not a long key");
    assert.equal(tool?.call, tool?.id);
    assert.equal(done?.call, tool?.id, "a done names its tool");
    assert.equal(done?.e, undefined, "no error text goes in");
    assert.equal(String(tool?.l).length, 60, "a label is clipped");
    assert.equal(String(said?.text).length, 80, "a message is clipped");
    assert.ok(!JSON.stringify(answer).includes("a private error"));
    await town.dispose();
});

test("the history route answers only its window, and never an unconfirmed session", async (t) => {
    const town = await harness();
    const start = Date.now();

    await town.meta("1", "Mine");
    town.tool("t1", "1", "read", { path: "a.md" });

    t.mock.method(Date, "now", () => start + 60_000);
    town.tool("t2", "1", "read", { path: "b.md" });
    town.tool("h1", "9", "read", { path: "hidden.md" });

    const early = town.history(`from=${start - 1000}&to=${start + 30_000}`);

    assert.deepEqual(
        early.events.map((each) => each.i),
        ["a.md"],
    );
    assert.deepEqual(Object.keys(early.convs), ["1"]);
    assert.ok(early.convs["1"]?.tools, "a confirmed session comes whole");

    const all = town.history();

    assert.deepEqual(all.events.map((each) => each.i).sort(), ["a.md", "b.md"]);
    assert.ok(!JSON.stringify(all).includes("hidden.md"));
    assert.deepEqual(Object.keys(all.convs), ["1"]);

    // Numbers that are not numbers give the defaults.
    const ask = town.history("from=notanumber&to=");

    assert.equal(ask.from, ask.now - 24 * 60 * 60_000);
    assert.equal(ask.to, ask.now);
    await town.dispose();
});

test("the history file is 0600, keeps an unconfirmed session bare, and comes back after a restart", async (t) => {
    const town = await harness();
    const start = Date.now();

    await town.meta("1", "Mine");
    town.tool("t1", "1", "bash", { command: "echo mine-visible" });
    town.tool("t2", "8", "bash", { command: "echo hidden-words-here" });
    await town.dispose();

    const historyFile = join(dataDir, "dune", "history.json");
    const kept = JSON.parse(await readFile(historyFile, "utf8"));

    assert.equal(kept.v, 1);
    assert.equal((await stat(historyFile)).mode & 0o777, 0o600);
    assert.ok(JSON.stringify(kept).includes("mine-visible"));
    assert.ok(!JSON.stringify(kept).includes("hidden-words-here"));

    const hidden = kept.events.filter((each: { c?: string }) => each.c === "8");

    assert.ok(hidden.length > 0);

    for (const event of hidden) {
        assert.equal(event.l, undefined);
        assert.equal(event.i, undefined);
    }

    // A restart loads it again.
    forgetHandover();

    const reopened = await harness();

    assert.ok(reopened.history().events.some((each) => each.c === "1"));
    await reopened.dispose();

    // A day later it is past its window, and the file gives an empty history.
    t.mock.method(Date, "now", () => start + 25 * 60 * 60_000);
    forgetHandover();

    const later = await harness();

    assert.deepEqual(later.history().events, []);
    await later.dispose();
});

test("the cap keeps the newest events inside the budget", () => {
    assert.equal(capHistory([], 100), 0);
    assert.equal(capHistory([10, 20, 30], 100), 0);
    assert.equal(capHistory([10, 20, 30], 50), 1);
    assert.equal(capHistory([10, 20, 30], 30), 2);
    assert.equal(capHistory([10, 20, 30], 5), 3);
});

test("a reset empties the history, in memory and in its file", async () => {
    const town = await harness();

    await town.meta("1");
    town.tool("t1", "1", "read", { path: "a.md" });
    assert.ok(town.history().events.length > 0);

    await town.routes.get("POST reset")!({});

    const empty = town.history();

    assert.deepEqual(empty.events, []);
    assert.deepEqual(Object.keys(empty.convs), []);

    const kept = JSON.parse(await readFile(join(dataDir, "dune", "history.json"), "utf8"));

    assert.deepEqual(kept.events, []);
    assert.deepEqual(kept.convs, {});
    assert.deepEqual(Object.keys(town.world().convs), []);
    await town.dispose();
});

// A busy night has more calls than a file can hold: they are sampled, so the whole night stays.
test("a burst of tool calls is sampled, and every kept done matches a kept tool", async (t) => {
    const town = await harness();
    const start = Date.now();

    await town.meta("1", "Mine");
    t.mock.method(Date, "now", () => start);

    for (let index = 0; index < 500; index++) {
        town.tool(`c${index}`, "1", "read", { path: `f${index}.md` });
        town.handlers.afterTool!(
            { id: `c${index}`, name: "read" },
            { isError: false, output: [] },
            town.api("1"),
        );
    }

    const answer = town.history();
    const tools = answer.events.filter((each) => each.k === "tool");
    const dones = answer.events.filter((each) => each.k === "done");

    // The bucket starts with 60 tokens, and no time passes here.
    assert.ok(tools.length <= 61, `${tools.length} tool events`);
    assert.equal(tools.length, 60);
    assert.equal(dones.length, tools.length);

    const kept = new Set(tools.map((each) => each.id));

    for (const done of dones) {
        assert.ok(kept.has(done.call as number), "a done names a kept tool");
    }

    await town.dispose();
});

test("the first tool call of a turn is kept even when the bucket is empty", async (t) => {
    const town = await harness();
    const start = Date.now();

    await town.meta("1", "Mine");
    t.mock.method(Date, "now", () => start);

    // Spend the bucket: sixty calls keep, and the next ones are sampled out.
    for (let index = 0; index < 61; index++) {
        town.tool(`d${index}`, "1", "read", { path: `drain${index}.md` });
    }

    town.tool("sampled", "1", "read", { path: "sampled.md" });
    town.handlers.beforeRequest!(
        { messages: [{ role: "user", content: "go on", timestamp: 1 }] },
        town.api("1", "task-turn"),
        {},
    );
    town.tool("after", "1", "read", { path: "after.md" });

    const kept = town
        .history()
        .events.filter((each) => each.k === "tool")
        .map((each) => each.i);

    assert.ok(!kept.includes("sampled.md"), "a call with an empty bucket is sampled out");
    assert.ok(kept.includes("after.md"), "the turn's first call is kept");
    await town.dispose();
});

test("half an hour on, the bucket has room for tool calls again", async (t) => {
    const town = await harness();
    const start = Date.now();
    let now = start;

    await town.meta("1", "Mine");
    t.mock.method(Date, "now", () => now);

    for (let index = 0; index < 61; index++) {
        town.tool(`d${index}`, "1", "read", { path: `drain${index}.md` });
    }

    assert.equal(
        town.history().events.filter((each) => each.k === "tool").length,
        60,
        "the bucket is empty",
    );

    // Ten calls a minute: half an hour fills the bucket again.
    now = start + 30 * 60_000;
    town.tool("later", "1", "read", { path: "later.md" });

    const kept = town
        .history()
        .events.filter((each) => each.k === "tool")
        .map((each) => each.i);

    assert.ok(kept.includes("later.md"), "the bucket fills again");
    await town.dispose();
});

test("a subagent's answer text stays out of the history", async () => {
    const town = await harness();

    await town.meta("1", "Mine");
    town.handlers.afterTool!(
        { id: "spawn", name: "subagent", arguments: { action: "spawn", name: "scout" } },
        {
            isError: false,
            output: [],
            details: { conversationId: "2", name: "scout", action: "spawn" },
        },
        town.api("1"),
    );
    town.handlers.onYield!(
        { content: [{ type: "text", text: "the spice-harvest-secret is safe" }] },
        town.api("2"),
    );

    const answer = town.history();

    assert.ok(
        answer.events.some((each) => each.k === "msg" && each.via === "report"),
        "the report itself shows",
    );
    assert.ok(!JSON.stringify(answer).includes("spice-harvest-secret"));

    await town.dispose();

    const kept = await readFile(join(dataDir, "dune", "history.json"), "utf8");

    assert.ok(!kept.includes("spice-harvest-secret"));
});

test("the history prunes itself while nothing happens, and starts its timer again", async (t) => {
    const start = Date.now();
    let now = start;

    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(Date, "now", () => now);

    const town = await harness();
    const historyFile = join(dataDir, "dune", "history.json");

    /** The history file as it is on disk, or undefined while it is not there yet. */
    const saved = async (): Promise<{ events: unknown[]; convs: object } | undefined> => {
        try {
            return JSON.parse(await readFile(historyFile, "utf8")) as {
                events: unknown[];
                convs: object;
            };
        } catch {
            return undefined;
        }
    };

    await town.meta("1", "Mine");
    town.tool("t1", "1", "read", { path: "a.md" });

    // The first save runs a minute after the event.
    t.mock.timers.tick(60_000);
    await until(async () => (await saved())?.events.length === 1);
    assert.equal((await saved())?.events.length, 1, "the timer wrote the file");

    // Twenty-five hours on, with nothing new: the timer started after that save prunes the window.
    now = start + 25 * 60 * 60_000;
    assert.deepEqual(town.history().events, [], "an old event never leaves the route");

    t.mock.timers.tick(60_000);
    await until(async () => (await saved())?.events.length === 0);

    const kept = await saved();

    assert.deepEqual(kept?.events, []);
    assert.deepEqual(kept?.convs, {});
    await town.dispose();
});

test("a session confirmed after it recorded history keeps its words when the world forgets it", async (t) => {
    const town = await harness();
    const start = Date.now();
    let now = start;

    t.mock.method(Date, "now", () => now);

    // Nobody confirmed it yet: its words are held back.
    town.tool("h1", "5", "read", { path: "spice-ledger.md" });
    assert.ok(!JSON.stringify(town.history()).includes("spice-ledger.md"));

    // The owner opens it: the history learns that it is confirmed.
    await town.meta("5", "The ledger");
    assert.ok(JSON.stringify(town.history()).includes("spice-ledger.md"));

    // The world trims it away, with 400 conversations newer than it.
    now = start + 60_000;

    for (let index = 0; index < 400; index++) {
        town.tool(`g${index}`, `c${index}`, "read", { path: `other${index}.md` });
    }

    assert.equal(town.world().convs["5"], undefined, "the world forgot it");

    const answer = town.history();

    assert.ok(
        answer.events.some((each) => each.c === "5"),
        "the history still shows its events",
    );
    assert.ok(
        answer.events.some((each) => each.c === "5" && each.i === "spice-ledger.md"),
        "with their words",
    );
    assert.ok(answer.convs["5"], "and names it");
    await town.dispose();
});

test("the history file stays inside its byte budget, even with many conversations", async () => {
    setHistoryBudgetForTests(4000);

    try {
        const town = await harness();

        await town.meta("1", "Mine");
        town.tool("t1", "1", "read", { path: "a.md" });

        // Many conversations, each with a long title that counts too.
        for (let index = 0; index < 40; index++) {
            const id = `s${index}`;

            await town.meta(id, `Sietch ${index} of the deep desert ${"x".repeat(60)}`);
            town.tool(`g${index}`, id, "read", { path: `some/long/path/file-${index}.md` });
        }

        await town.dispose();

        const historyFile = join(dataDir, "dune", "history.json");
        const text = await readFile(historyFile, "utf8");

        assert.ok(Buffer.byteLength(text) <= 4000, `${Buffer.byteLength(text)} bytes`);
        assert.ok(JSON.parse(text).events.length > 0, "some events stay");
    } finally {
        setHistoryBudgetForTests();
    }
});

test("a budget too small for a conversation keeps no events and no conversations", async () => {
    setHistoryBudgetForTests(40);

    try {
        const town = await harness();

        await town.meta("1", "Mine");
        town.tool("t1", "1", "read", { path: "a.md" });
        await town.dispose();

        const historyFile = join(dataDir, "dune", "history.json");
        const text = await readFile(historyFile, "utf8");
        const kept = JSON.parse(text);

        assert.ok(Buffer.byteLength(text) <= 40, `${Buffer.byteLength(text)} bytes`);
        assert.deepEqual(kept.events, []);
        assert.deepEqual(kept.convs, {});
    } finally {
        setHistoryBudgetForTests();
    }
});

test("a restart drops the events that expired while it was down", async (t) => {
    const start = Date.now();
    let now = start;
    const town = await harness();

    await town.meta("1", "Mine");
    town.tool("t1", "1", "read", { path: "a.md" });
    await town.dispose();

    // Twenty-five hours on, every event in the file is past its window, and its records are not.
    now = start + 25 * 60 * 60_000;
    t.mock.method(Date, "now", () => now);
    forgetHandover();

    const reopened = await harness();

    assert.deepEqual(reopened.history().events, []);
    await reopened.dispose();

    const kept = JSON.parse(await readFile(join(dataDir, "dune", "history.json"), "utf8"));

    assert.deepEqual(kept.events, []);
    assert.deepEqual(kept.convs, {});
});

test("a hot reload prunes a history whose events expired, with no new activity", async (t) => {
    const start = Date.now();
    let now = start;

    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(Date, "now", () => now);

    const town = await harness();

    await town.meta("1", "Mine");
    town.tool("t1", "1", "read", { path: "a.md" });
    await town.dispose();

    const historyFile = join(dataDir, "dune", "history.json");

    /** The history file as it is on disk, or undefined while it is not there yet. */
    const saved = async (): Promise<{ events: unknown[]; convs: object } | undefined> => {
        try {
            return JSON.parse(await readFile(historyFile, "utf8")) as {
                events: unknown[];
                convs: object;
            };
        } catch {
            return undefined;
        }
    };

    assert.equal((await saved())?.events.length, 1);

    // A new version of the module, handed the state of the one before it, with nothing new.
    const reloaded = await harness();

    now = start + 25 * 60 * 60_000;
    t.mock.timers.tick(60_000);
    await until(async () => (await saved())?.events.length === 0);

    const kept = await saved();

    assert.deepEqual(kept?.events, []);
    assert.deepEqual(kept?.convs, {});
    await reloaded.dispose();
});
