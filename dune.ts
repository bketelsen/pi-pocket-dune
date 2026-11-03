/**
 * Dune: every agent at work as a desert planet seen from above, with the files, shells, sites, models, MCP servers,
 * and messages they share. It watches the tool calls and messages of every session, shows the owner only the sessions
 * that Pi Pocket confirms they may see, and keeps a short history in its own data folder. No network.
 *
 * Sessions are sietches carved into the rock, subagents are fedaykin sent out from them, and linked sessions are
 * allied sietches across the open sand. Every place an agent reaches is an outpost: its people cross the dunes to work
 * there. Models are spice fields, and the spice they yield is counted in tokens and solaris. Messages travel by
 * distrans and ornithopter; the night shift and the desk send word from their own stations. Hooks watch each model
 * request and tool call in every session; the browser module draws them.
 *
 * What it keeps: the last events and some counts, in memory and in `<data>/dune/world.json`, and a compact 24-hour
 * history in `<data>/dune/history.json` that a page replays, so the night can be watched again. Only the owner can
 * open it, and it shows them only sessions that Pi Pocket confirms they may see (so never another person's PiP), or
 * subagents that a confirmed session's own tool call started. Tool arguments and messages are cut short and likely
 * secrets are masked, but they can still hold what a command or a path said. For a session not yet confirmed, the file
 * keeps only counts and tool and model names: no words, paths, titles, or names. The page learns the ids of such
 * sessions, to ask Pi Pocket about them, and nothing else. It changes no call.
 *
 * It reads some internal shapes, which can change in any Pi Pocket release (they fail soft: the desert loses a link
 * or a label, never a call): the arguments and results of the built-in tools and of the owner's team tools
 * (`team_delegate`, `team_message`, `team_memory`, `team_sessions`), and the markers on messages (`[from: …]`,
 * `[subagent …]`, `[scheduled]`, `[via PR watch]`, `[night-shift]`, `[desk]`, and the linked-session wrapper).
 *
 * It needs Pi Pocket 0.19.0 or later (extension API 2).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineExtension, GenerationTask, hook, ToolTask } from "@earendil-works/pi-durable";
import type { Host, Web, WebRequest } from "./_pocket.d.ts";

/** The version of Pi Pocket's extension API this module is written for. */
export const pocketApi = 2;

const MAX_EVENTS = 3000;
const SNAPSHOT_EVENTS = 1500;
const MAX_CONVS = 400;
const MAX_ITEMS = 60;
const MAX_RESOURCES = 120;
const MAX_VISITORS = 40;
const MAX_HELD = 300;
const MAX_HUMANS = 60;
const MAX_SEEN = 5000;
/** How many of the newest "already counted" keys the file keeps, so a replay after a restart counts once. */
const SAVED_SEEN = 2000;
const MAX_PENDING = 200;
/** Events waiting to go to the pages, at most; past it the pages load the world again instead. */
const MAX_OUTBOX = 3000;
/**
 * How long a session counts as active: the page shows a session, and the sietches it hangs from, only when something
 * happened in it in the last 12 hours.
 */
const ACTIVE_MS = 12 * 60 * 60_000;
/** How far back the history reaches: the night and the day around it, from 20:00 to 07:00 and past it. */
const HISTORY_MS = 24 * 60 * 60_000;
/** The event kinds the history keeps: what a replay draws. A thought or an answer is not among them. */
const HISTORY_KINDS = new Set(["tool", "done", "msg", "link", "idle"]);
/** How many events the history keeps, in memory and in its file. */
const HISTORY_MAX = 40_000;
/** The most bytes the history file may take. */
const HISTORY_BYTES = 4_000_000;
/** The bytes of a history file around its records and its events: `{"v":1,"convs":` … `,"events":[` … `]}`. */
const HISTORY_FRAME =
    Buffer.byteLength('{"v":1,"convs":') +
    Buffer.byteLength(',"events":[') +
    Buffer.byteLength("]}");
/**
 * The history file's byte budget: `HISTORY_BYTES`, unless a test lowers it to try the cap. A variable, so a test
 * needs no second copy of the module.
 */
let historyBytes = HISTORY_BYTES;
/** How long a change to the history waits before its file is written: the file is big, and a night is not urgent. */
const HISTORY_SAVE_MS = 60_000;
/** How many call keys the history keeps: the full `taskId:callId` is long, so an event keeps a number instead. */
const HISTORY_CALLS = 5000;
/**
 * Tool calls the history keeps per minute, on average. A busy night has more than any file can hold, so its calls
 * are sampled: an even sample across the whole night, and every call of a quiet night.
 */
const HISTORY_RATE = 10;
/** The bucket's size: a short burst of tool calls all keep, and a long one is sampled. */
const HISTORY_BURST = 60;
/** How many conversations may wait for their turn's first call to be kept; past it the oldest goes. */
const HISTORY_FRESH = 2000;
/**
 * Event fields that the file keeps for a session not yet confirmed: none can hold what someone wrote, a path, a
 * title, or a name. `s` keeps only its kind (`mcp`, not `mcp:server`); `from` and `to` lose a person's name.
 */
const BARE_FIELDS = new Set([
    "id",
    "at",
    "k",
    "c",
    "p",
    "n",
    "s",
    "w",
    "ok",
    "pv",
    "md",
    "tin",
    "tout",
    "cost",
    "calls",
    "stop",
    "m",
    "via",
    "kind",
    "a",
    "call",
    "par",
    "from",
    "to",
]);
const MIN_PROBE = 16;
/** How much of a linked session's message is searched for a task that was sent to it. */
const BODY_CHARS = 12_000;
/** What a `team_delegate` call puts between its preamble and its task. */
const TASK_MARKER = "Task from the source session:\n";
/** One batch stays well under what Pi Pocket sends in one event, and one flush under what it sends in a second. */
const BATCH_BYTES = 120_000;
const FLUSH_BYTES = 200_000;
/**
 * What one version of the module hands the next when its file is edited, so an edit loses nothing: the world, who
 * is confirmed, what waits for that, calls already counted, and the one chain that saves the file.
 */
const STATE = Symbol.for("x.dune.state");
/**
 * The owner's team extension, when it runs: it knows which named agent each session is, even one whose title does not
 * say. Read through `globalThis`, never an import, so this module works the same without it.
 */
const TEAM_API = Symbol.for("pi-pocket-team.team");
/** Keys that would reach an object's prototype: never used as a key from outside. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const FLUSH_MS = 250;
const SAVE_MS = 5000;
const PENDING_MS = 10 * 60_000;
const FROM_PREFIX = /^\[from: ([^\]\n]{1,60})\] /;

type Kind = "session" | "subagent" | "linked";

/** A record keyed by text from outside: no prototype, so no key can reach `Object.prototype`. */
function dict<T>(from?: unknown): Record<string, T> {
    const out = Object.create(null) as Record<string, T>;

    if (from !== null && typeof from === "object") {
        for (const [key, value] of Object.entries(from)) {
            out[safeKey(key)] = value as T;
        }
    }

    return out;
}

/** A key from outside, made safe to use on any object. */
function safeKey(key: string): string {
    return UNSAFE_KEYS.has(key) ? `${key}_` : key;
}

interface Conv {
    id: string;
    kind: Kind;
    parent?: string;
    name?: string;
    title?: string;
    provider?: string;
    model?: string;
    thinking?: string;
    cwd?: string;
    first: number;
    last: number;
    tin: number;
    tout: number;
    cost: number;
    calls: number;
    turns: number;
    errors: number;
    tools: Record<string, number>;
    files: Record<string, { r: number; w: number; last: number }>;
    users?: number;
    /** A subagent that a tool call of its parent started, as that call's result says: seen when its parent is. */
    sure?: boolean;
    /** The team extension's name for the agent this session is, when it has one: "Odrade". */
    persona?: string;
    /** The newest user message seen: its time, and how many messages with that time were seen. */
    cursor?: { t: number; k: number };
}

interface Resource {
    key: string;
    count: number;
    last: number;
    items: Record<string, { n: number; last: number; w?: number }>;
    by: Record<string, number>;
}

interface Human {
    name: string;
    count: number;
    last: number;
}

type Ev = { id: number; at: number; k: string } & Record<string, unknown>;

/** A conversation as the history keeps it: only what names it after its world record is gone. */
interface HConv {
    id: string;
    kind: Kind;
    parent?: string;
    name?: string;
    title?: string;
    persona?: string;
    provider?: string;
    model?: string;
    first: number;
    last: number;
    /** Confirmed when it was recorded: its events stay readable after it is gone. */
    ok?: boolean;
}

/** The compact 24-hour history: what a page replays, its byte sizes, the conversations it names, and its call keys. */
interface History {
    events: Ev[];
    sizes: number[];
    convs: Record<string, HConv>;
    /** A tool event's full `taskId:callId` to the id of the event that started it: the file keeps the number. */
    calls: Map<string, number>;
    dirty: boolean;
    /** Tool calls the bucket still pays for, refilled at `HISTORY_RATE` a minute. In memory only, never saved. */
    tokens: number;
    /** When the bucket was last refilled. */
    filled: number;
    /** Conversations whose next tool call is kept, whatever the bucket says: the first call of a turn. */
    fresh: Set<string>;
}

interface World {
    seq: number;
    /** Conversations the owner's own bound request showed they may see: only these leave the server. */
    ok?: string[];
    convs: Record<string, Conv>;
    res: Record<string, Resource>;
    humans: Record<string, Human>;
    events: Ev[];
    /** The newest "already counted" keys, so a call that runs again after a restart counts once. */
    seen?: string[];
}

interface Pending {
    from: string;
    via: "subagent" | "team";
    action: string;
    name?: string;
    title?: string;
    /** The persona a `team_delegate` call named: the linked session it starts takes that name. */
    agent?: string;
    probe: string;
    at: number;
    delivered?: string;
    callKey: string;
}

/** Text that looks like a secret: API keys, tokens, passwords in assignments, and private keys. */
const SECRETS: [RegExp, string][] = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "•••"],
    [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 •••"],
    [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "$1-•••"],
    [/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g, "$1_•••"],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox•••"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA•••"],
    [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza•••"],
    [
        /\b([A-Za-z0-9_]*(?:key|token|secret|passw(?:or)?d|pwd)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
        "$1$2•••",
    ],
    // JSON: "password": "…", "api_key": "…"
    [
        /("[A-Za-z0-9_-]*(?:key|token|secret|passw(?:or)?d|pwd)[A-Za-z0-9_-]*"\s*:\s*)"[^"]*"/gi,
        '$1"•••"',
    ],
    // Flags: --password x, --token=x
    [
        /(--?(?:password|passwd|pass|pwd|token|secret|api-?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
        "$1•••",
    ],
    // curl -u user:pass, and user:pass@ in an address
    [/(\s-u\s*)([^\s:]+):(\S+)/g, "$1$2:•••"],
    [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi, "$1:•••@"],
];

/** A short one-line form of any text, with what looks like a secret masked. */
function clip(text: unknown, max = 160): string {
    let value = typeof text === "string" ? text : text === undefined ? "" : JSON.stringify(text);

    value = value.slice(0, Math.max(max * 4, 2000));

    for (const [pattern, mask] of SECRETS) {
        value = value.replace(pattern, mask);
    }

    const line = value.replace(/\s+/g, " ").trim();

    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A text as it is matched: spaces and case aside, at most `max` characters. */
function normalize(text: string, max: number): string {
    return text
        .replace(/\s+/g, " ")
        .replace(/[<>&"']/g, "")
        .trim()
        .toLowerCase()
        .slice(0, max);
}

/** What two texts are matched by: their first words, spaces and case aside. */
function probeOf(text: string): string {
    return normalize(text, 80);
}

/**
 * A linked session's message, normalized for matching as a whole. A `team_delegate` call puts a preamble before its
 * task, so the task is found anywhere in it, not only at its start.
 */
function bodyOf(text: string): string {
    return normalize(text.slice(0, BODY_CHARS * 4), BODY_CHARS);
}

function textOf(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .map((part: { type?: string; text?: string }) =>
            part?.type === "text" && typeof part.text === "string" ? part.text : "",
        )
        .join("");
}

function shortPath(path: string, cwd?: string): string {
    let value = path;

    if (cwd !== undefined && value.startsWith(`${cwd}/`)) {
        value = value.slice(cwd.length + 1);
    }

    return value.replace(/^\/home\/[^/]+/, "~");
}

function hostOf(url: unknown): string | undefined {
    if (typeof url !== "string" || url === "") {
        return undefined;
    }

    try {
        return new URL(url.includes("://") ? url : `http://${url}`).host || undefined;
    } catch {
        return clip(url, 40);
    }
}

/** Which place a tool call reaches, what in it, and its words. */
function classify(
    name: string,
    args: Record<string, unknown>,
    cwd?: string,
): { s?: string; i?: string; l: string; w?: boolean } {
    const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");

    switch (name) {
        case "read":
            return {
                s: "files",
                i: shortPath(str("path"), cwd),
                l: `read ${shortPath(str("path"), cwd)}`,
            };
        case "write":
            return {
                s: "files",
                i: shortPath(str("path"), cwd),
                l: `wrote ${shortPath(str("path"), cwd)}`,
                w: true,
            };
        case "edit":
            return {
                s: "files",
                i: shortPath(str("path"), cwd),
                l: `edited ${shortPath(str("path"), cwd)}`,
                w: true,
            };

        case "bash": {
            // "cd <folder> && " says where, not what: the label keeps the command itself.
            const command = str("command")
                .trim()
                .replace(/^(cd\s+\S+\s*&&\s*)+/, "");
            // The program, past any leading `NAME=value` settings (which can hold secrets).
            const words = command.split(/\s+/);

            while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) {
                words.shift();
            }

            const first = clip((words[0] ?? "").replace(/^.*\//, ""), 40);

            if (first === "git" || first === "gh") {
                return {
                    s: "github",
                    i: clip(`${first} ${words[1] ?? ""}`, 40),
                    l: clip(command, 90),
                };
            }

            return { s: "shell", i: first || "sh", l: clip(command, 90) };
        }

        case "browser": {
            const action = str("action") || "browse";
            const where = hostOf(args.url);

            return { s: "web", i: where ?? action, l: where ? `${action} ${where}` : action };
        }

        case "mcp_call":
        case "mcp_call_read_only":
            return {
                s: `mcp:${clip(str("server"), 60) || "?"}`,
                i: str("tool") || "call",
                l: `${str("server")} · ${str("tool")}`,
            };
        case "mcp_tools":
            return {
                s: `mcp:${clip(str("server"), 60) || "all"}`,
                i: "list tools",
                l: `looked up ${str("server") || "MCP"} tools`,
            };
        case "memory":
            return {
                s: "memory",
                i: str("action") || "recall",
                l: `memory ${str("action")}`.trim(),
            };
        case "artifact":
            return {
                s: "artifact",
                i: clip(str("title") || str("id"), 40),
                l: `published ${clip(str("title"), 50)}`,
            };
        case "schedule":
            return {
                s: "schedule",
                i: str("action") || "plan",
                l: `schedule ${clip(str("when") || str("action"), 40)}`,
            };
        case "watch_pr":
            return { s: "github", i: "watch PR", l: `watch PR ${str("pr")}`.trim() };
        case "codemode":
            return { s: "codemode", i: "script", l: "ran a script" };
        case "subagent":
            return { l: `${str("action")} ${str("name")}`.trim() };
        case "team":
            return { l: `team ${str("action")} ${clip(str("title") || str("to"), 40)}`.trim() };
        case "team_delegate":
            return {
                l: `delegate ${str("agent")} ${clip(str("title") || str("task"), 40)}`.trim(),
            };
        case "team_message":
            return { l: `message ${str("to")}`.trim() };
        case "team_memory":
            return { s: "memory", i: "team memory", l: `team memory ${str("action")}`.trim() };
        case "team_sessions":
            return { l: "list team sessions" };
        default:
            if (/search|fetch|web/i.test(name)) {
                return { s: "web", i: name, l: name };
            }

            return { s: "ext", i: name, l: name.replace(/_/g, " ") };
    }
}

function emptyConv(id: string, at: number): Conv {
    return {
        id,
        kind: "session",
        first: at,
        last: at,
        tin: 0,
        tout: 0,
        cost: 0,
        calls: 0,
        turns: 0,
        errors: 0,
        tools: dict(),
        files: dict(),
    };
}

/** Keep the `max` newest keys of a record of `{ last }`. */
function trim<T extends { last: number }>(record: Record<string, T>, max: number): void {
    const keys = Object.keys(record);

    if (keys.length <= max) {
        return;
    }

    keys.sort((a, b) => record[b]!.last - record[a]!.last)
        .slice(max)
        .forEach((key) => delete record[key]);
}

interface Shared {
    world: World;
    verified: Set<string>;
    held: Map<string, (() => void)[]>;
    pending: Pending[];
    seen: Set<string>;
    /** The compact 24-hour history, in its own file. A version loaded after an older one starts without it. */
    history?: History;
    /** The one chain of saves, for every version: a later save never lands before an earlier one. */
    saving: Promise<void>;
    /** Goes up at each reset, so work that started before it does not bring old things back. */
    generation: number;
    /** The number of the last batch sent; a page that misses one loads the world again. */
    batch: number;
    /** What waits to go to the pages, for every version: old hooks still running add to it, the newest sends it. */
    out: {
        changed: { convs: Set<string>; res: Set<string>; humans: Set<string> };
        unknown: Set<string>;
        outbox: Ev[];
        late: Ev[];
    };
    /** Starts the newest version's flush and save timers. */
    kick: () => void;
}

/** The world in the file, or an empty one. Every record keyed by text from outside has no prototype. */
async function load(file: string): Promise<World> {
    const empty: World = { seq: 0, convs: dict(), res: dict(), humans: dict(), events: [] };

    try {
        const saved = JSON.parse(await readFile(file, "utf8")) as World;

        if (!saved || typeof saved !== "object" || !Array.isArray(saved.events)) {
            return empty;
        }

        const convs = dict<Conv>(saved.convs);
        const res = dict<Resource>(saved.res);

        for (const each of Object.values(convs)) {
            each.tools = dict(each.tools);
            each.files = dict(each.files);
        }

        for (const each of Object.values(res)) {
            each.items = dict(each.items);
            each.by = dict(each.by);
        }

        return {
            seq: Number(saved.seq) || 0,
            ok: Array.isArray(saved.ok) ? saved.ok.map(String) : [],
            seen: Array.isArray(saved.seen) ? saved.seen.map(String) : [],
            convs,
            res,
            humans: dict<Human>(saved.humans),
            events: saved.events.slice(-MAX_EVENTS),
        };
    } catch {
        // No world yet: it starts empty.
        return empty;
    }
}

/** The history in its file, or an empty one. A bad file, or none, gives an empty history; old events are dropped. */
async function loadHistory(file: string): Promise<History> {
    const empty: History = {
        events: [],
        sizes: [],
        convs: dict(),
        calls: new Map(),
        dirty: false,
        tokens: HISTORY_BURST,
        filled: Date.now(),
        fresh: new Set(),
    };

    try {
        const saved = JSON.parse(await readFile(file, "utf8")) as {
            v?: unknown;
            convs?: unknown;
            events?: unknown;
        };

        if (!saved || typeof saved !== "object" || !Array.isArray(saved.events)) {
            return empty;
        }

        const since = Date.now() - HISTORY_MS;
        const convs = dict<HConv>(saved.convs);

        for (const [key, each] of Object.entries(convs)) {
            if (each === null || typeof each !== "object" || typeof each.id !== "string") {
                delete convs[key];
            }
        }

        const events = saved.events
            .filter(
                (event: unknown): event is Ev =>
                    event !== null &&
                    typeof event === "object" &&
                    typeof (event as Ev).at === "number" &&
                    (event as Ev).at >= since,
            )
            .slice(-HISTORY_MAX);

        return {
            events,
            sizes: events.map((event) => Buffer.byteLength(JSON.stringify(event))),
            convs,
            calls: new Map(),
            dirty: false,
            // The sampling starts full, as a module that just loaded does: a fresh night keeps its first calls.
            tokens: HISTORY_BURST,
            filled: Date.now(),
            fresh: new Set(),
        };
    } catch {
        // No history yet: it starts empty.
        return empty;
    }
}

/**
 * An event as the history keeps it: only the short fields a replay draws, no error text, and a call as the id of the
 * tool event that made it. `calls` holds the full `taskId:callId` keys, which the file and memory leave out otherwise.
 * A field with no value stays out.
 */
function compact(event: Ev, calls: Map<string, number>): Ev | undefined {
    const out = { id: event.id, at: event.at, k: event.k } as Ev;
    const put = (field: string, value: unknown) => {
        if (value !== undefined) {
            out[field] = value;
        }
    };
    const short = (value: unknown, max: number) =>
        typeof value === "string" || typeof value === "number" ? clip(value, max) : undefined;
    const call = (value: unknown) => (typeof value === "string" ? calls.get(value) : undefined);

    switch (event.k) {
        case "tool":
            put("c", event.c);

            if (typeof event.call === "string") {
                calls.set(event.call, event.id);

                // A Map keeps its order: the oldest key goes first, and its events keep a number only.
                while (calls.size > HISTORY_CALLS) {
                    const oldest = calls.keys().next();

                    if (oldest.done === true) {
                        break;
                    }

                    calls.delete(oldest.value);
                }

                put("call", event.id);
            }

            put("n", event.n);
            put("s", event.s);
            put("i", short(event.i, 48));
            put("l", short(event.l, 60));
            put("w", event.w);
            put("par", call(event.par));
            put("a", event.a);
            put("tn", short(event.tn, 40));
            break;
        case "done": {
            const done = call(event.call);

            // Its tool was sampled out: the result goes too, so a replay never shows a result without its call.
            if (done === undefined) {
                return undefined;
            }

            put("c", event.c);
            put("call", done);

            if (typeof event.call === "string") {
                calls.delete(event.call);
            }

            put("n", event.n);
            put("ok", event.ok);
            break;
        }
        case "msg":
            put("from", event.from);
            put("to", event.to);
            put("via", event.via);
            // A subagent's answer is its report: the history keeps the tool calls and the words people send, not it.
            put("text", event.via === "report" ? undefined : short(event.text, 80));
            put("call", call(event.call));
            break;
        case "link":
            put("c", event.c);
            put("p", event.p);
            put("kind", event.kind);
            put("name", short(event.name, 40));
            break;
        case "idle":
            put("c", event.c);
            break;
        default:
            return undefined;
    }

    return out;
}

/**
 * How many of the oldest events to drop so the rest fit in `budget` bytes: the newest stay. A budget too small for
 * anything drops them all.
 */
export function capHistory(sizes: number[], budget: number): number {
    let total = 0;

    for (let index = sizes.length - 1; index >= 0; index--) {
        total += sizes[index]!;

        if (total > budget) {
            return index + 1;
        }
    }

    return 0;
}

/** Set the history file's byte budget, for a test that tries the cap. No argument gives the real one back. */
export function setHistoryBudgetForTests(n?: number): void {
    historyBytes = n ?? HISTORY_BYTES;
}

export default async function createDune(host: Host, web: Web) {
    const folder = join(host.dataDir, "dune");
    const file = join(folder, "world.json");
    const historyFile = join(folder, "history.json");
    // One state for every version of this module in this process: an edit hands it on whole.
    const shared = (globalThis as Record<symbol, unknown>)[STATE] as Shared | undefined;
    const state: Shared = shared ?? {
        world: await load(file),
        history: await loadHistory(historyFile),
        verified: new Set<string>(),
        held: new Map(),
        pending: [],
        seen: new Set<string>(),
        saving: Promise.resolve(),
        generation: 0,
        batch: 0,
        out: {
            changed: { convs: new Set(), res: new Set(), humans: new Set() },
            unknown: new Set(),
            outbox: [],
            late: [],
        },
        kick: () => {},
    };

    if (shared === undefined) {
        state.world.ok?.forEach((id) => state.verified.add(id));
        state.world.seen?.forEach((key) => state.seen.add(key));
        (globalThis as Record<symbol, unknown>)[STATE] = state;
    }

    // A version of this module loaded after an older one is handed a state made without a history: it loads it now.
    const history = (state.history ??= await loadHistory(historyFile));

    const { world, verified, held, pending, seen } = state;

    // A world file lost or older than the history must not give a new event the id of a kept one.
    world.seq = Math.max(world.seq, Number(history.events.at(-1)?.id) || 0);
    // Tabs reload the world when this changes: a restart or a reset can make ids go back.
    const boot = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Events of a conversation shown just now, from before it was, wait in `out.late`: the page puts them in
    // their place.
    const out = state.out;
    const { changed, unknown } = out;
    let flushTimer: NodeJS.Timeout | undefined;
    let saveTimer: NodeJS.Timeout | undefined;
    let historyTimer: NodeJS.Timeout | undefined;
    let saves = 0;
    let disposed = false;

    // ——— who may see what ———

    /** A conversation the owner sees: checked by their own request, or a subagent of one. */
    function isOk(id: string | undefined, depth = 0): boolean {
        if (id === undefined || depth > 8) {
            return false;
        }

        if (verified.has(id)) {
            return true;
        }

        const found = world.convs[id];

        // A subagent counts only when its parent's own tool call started it; a match of words never does.
        return found?.kind === "subagent" && found.sure === true && isOk(found.parent, depth + 1);
    }

    /**
     * A conversation id. `c` and `p` always hold one; `from` and `to` hold one unless they name a
     * person (`human:`) or a station (`station:`). Fail closed: a forgotten id still counts as one.
     * Pi Pocket makes conversation ids itself, as numbers, so none starts with those prefixes.
     */
    const isConv = (value: unknown): value is string =>
        typeof value === "string" &&
        value !== "" &&
        !value.startsWith("human:") &&
        !value.startsWith("station:");

    /** An event the owner may see: every conversation it names is one they see. */
    function evOk(event: Ev): boolean {
        return [event.c, event.p, event.from, event.to].every(
            (each) => each === undefined || !isConv(each) || isOk(each),
        );
    }

    /** Run now when the owner sees `id`, else when they are shown that they do. */
    function whenOk(id: string, run: () => void) {
        if (isOk(id)) {
            run();

            return;
        }

        const list = held.get(id) ?? [];

        if (list.length < MAX_HELD) {
            list.push(run);
        }

        held.set(id, list);
    }

    /** What was held back for conversations the owner now sees. */
    function release(): string[] {
        const shown: string[] = [];

        for (const [id, list] of held) {
            if (isOk(id)) {
                held.delete(id);
                list.forEach((run) => run());
                shown.push(id);
            }
        }

        return shown;
    }

    function noteSeen(id: string) {
        if (!isOk(id)) {
            unknown.add(id);
        }
    }

    // ——— keeping and sending ———

    /** An event as the file keeps it for a session not yet confirmed: no words, paths, titles, or names. */
    function bare(event: Ev): Ev {
        const out = { id: event.id, at: event.at, k: event.k } as Ev;

        for (const [field, value] of Object.entries(event)) {
            if (!BARE_FIELDS.has(field)) {
                continue;
            }

            if (field === "s" && typeof value === "string") {
                out.s = value.split(":")[0];
            } else if ((field === "from" || field === "to") && typeof value === "string") {
                out[field] = value.startsWith("human:") ? "human:" : value;
            } else {
                out[field] = value;
            }
        }

        return out;
    }

    function save(): Promise<void> {
        saveTimer = undefined;
        // One chain for every version of the module: each save writes the world as it is when its turn comes.
        state.saving = state.saving.then(async () => {
            const convs = dict<Conv>();

            for (const [id, each] of Object.entries(world.convs)) {
                convs[id] = isOk(id)
                    ? each
                    : {
                          ...each,
                          title: undefined,
                          name: undefined,
                          cwd: undefined,
                          persona: undefined,
                          files: dict(),
                      };
            }

            const data: World = {
                ...world,
                ok: [...verified],
                seen: [...seen].slice(-SAVED_SEEN),
                convs,
                events: world.events
                    .slice(-SNAPSHOT_EVENTS)
                    .map((event) => (evOk(event) ? event : bare(event))),
            };
            const temporary = `${file}.${process.pid}.${boot}.${++saves}.tmp`;

            try {
                await mkdir(folder, { recursive: true, mode: 0o700 });
                await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
                await rename(temporary, file);
            } catch (error) {
                console.warn("dune: could not save its world:", error);
            }
        });

        return state.saving;
    }

    // ——— the history a page replays ———

    /** The conversations an event names. */
    function named(event: Ev): string[] {
        return [event.c, event.p, event.from, event.to].filter(isConv);
    }

    /** Whether the history may keep a conversation's words: the owner sees it now, or did when it was recorded. */
    function hOk(id: string): boolean {
        return isOk(id) || history.convs[safeKey(id)]?.ok === true;
    }

    /** Whether the history may show an event: every conversation it names passes `hOk`. */
    function hEventOk(event: Ev): boolean {
        return named(event).every((id) => hOk(id));
    }

    /** Keep what names a conversation later, taken from the world as it is now. */
    function remember(id: string) {
        const found = world.convs[id];

        // Gone from the world: the old record stays, and keeps whatever it already says.
        if (found === undefined) {
            return;
        }

        const old = history.convs[safeKey(id)];

        history.convs[safeKey(id)] = {
            id,
            kind: found.kind,
            ...(found.parent !== undefined ? { parent: found.parent } : {}),
            ...(found.name !== undefined ? { name: found.name } : {}),
            ...(found.title !== undefined ? { title: found.title } : {}),
            ...(found.persona !== undefined ? { persona: found.persona } : {}),
            ...(found.provider !== undefined ? { provider: found.provider } : {}),
            ...(found.model !== undefined ? { model: found.model } : {}),
            first: found.first,
            last: found.last,
            ok: isOk(id) || old?.ok === true,
        };
    }

    /** The next tool call of a conversation is kept, whatever the bucket says. */
    function freshen(id: string) {
        history.fresh.delete(id);
        history.fresh.add(id);

        // A Set keeps its order: past the bound, the oldest conversation goes.
        while (history.fresh.size > HISTORY_FRESH) {
            const oldest = history.fresh.keys().next();

            if (oldest.done === true) {
                break;
            }

            history.fresh.delete(oldest.value);
        }
    }

    /**
     * Whether a tool call is kept: the first of a turn, which costs no token, or one the bucket has room for. The
     * bucket refills at `HISTORY_RATE` a minute, so a busy night keeps an even sample across the whole night, not
     * only its first hours, and a quiet night keeps every call.
     */
    function sample(event: Ev, now: number): boolean {
        history.tokens = Math.min(
            HISTORY_BURST,
            history.tokens + ((now - history.filled) * HISTORY_RATE) / 60_000,
        );
        history.filled = now;

        if (typeof event.c === "string" && history.fresh.delete(event.c)) {
            return true;
        }

        if (history.tokens < 1) {
            return false;
        }

        history.tokens -= 1;

        return true;
    }

    /**
     * Put an event into the history, name the conversations it holds, and drop the oldest at the front. Tool calls
     * are sampled, so a full night still fits: a busy night keeps an even sample of them, and a quiet one keeps all.
     */
    function keep(event: Ev) {
        if (!HISTORY_KINDS.has(event.k)) {
            return;
        }

        const now = Date.now();

        // A message or a finish starts a turn: its first tool call is always kept, so a work still rises for it.
        if (event.k === "msg" && isConv(event.to)) {
            freshen(event.to);
        } else if (event.k === "idle" && isConv(event.c)) {
            freshen(event.c);
        }

        // Sampled out: the event stays out of the history, and its call key stays out of `calls`.
        if (event.k === "tool" && !sample(event, now)) {
            return;
        }

        const short = compact(event, history.calls);

        if (short === undefined) {
            return;
        }

        history.events.push(short);
        history.sizes.push(Buffer.byteLength(JSON.stringify(short)));
        history.dirty = true;

        for (const id of named(event)) {
            remember(id);
        }

        historyTimer ??= setTimeout(saveHistory, HISTORY_SAVE_MS);

        // One splice: what the window has left behind, then what is past the limit.
        const since = Date.now() - HISTORY_MS;
        let drop = 0;

        while (drop < history.events.length && history.events[drop]!.at < since) {
            drop++;
        }

        drop = Math.max(drop, history.events.length - HISTORY_MAX);

        if (drop > 0) {
            history.events.splice(0, drop);
            history.sizes.splice(0, drop);
        }
    }

    /**
     * Write the history, in the same chain as the world's saves: a later save never lands before an earlier one. It
     * writes only when something changed, or after a reset, which saves the empty history.
     */
    function saveHistory(): Promise<void> {
        historyTimer = undefined;

        if (!history.dirty) {
            return state.saving;
        }

        state.saving = state.saving.then(async () => {
            history.dirty = false;

            const since = Date.now() - HISTORY_MS;
            let drop = 0;

            while (drop < history.events.length && history.events[drop]!.at < since) {
                drop++;
            }

            if (drop > 0) {
                history.events.splice(0, drop);
                history.sizes.splice(0, drop);
            }

            // Every record from the world as it is now.
            for (const each of Object.values(history.convs)) {
                remember(each.id);
            }

            const records = history.convs;

            /** The sietches a conversation hangs from, as keys. */
            const sietches = (id: string): string[] => {
                const out: string[] = [];
                let at = world.convs[id]?.parent ?? records[safeKey(id)]?.parent;

                for (let depth = 0; at !== undefined && depth < 16; depth++) {
                    out.push(safeKey(at));
                    at = world.convs[at]?.parent ?? records[safeKey(at)]?.parent;
                }

                return out;
            };

            /** Only the records the remaining events name, with their sietches. */
            const namedConvs = (): Record<string, HConv> => {
                const kept = dict<HConv>();

                for (const event of history.events) {
                    for (const id of named(event)) {
                        for (const key of [safeKey(id), ...sietches(id)]) {
                            const each = records[key];

                            if (each !== undefined) {
                                kept[key] = each;
                            }
                        }
                    }
                }

                return kept;
            };

            /** The records as the file writes them: a session not yet confirmed keeps no title, name, or persona. */
            const fileConvs = (): Record<string, HConv> => {
                const out = dict<HConv>();

                for (const [key, each] of Object.entries(history.convs)) {
                    out[key] =
                        each.ok === true
                            ? each
                            : { ...each, title: undefined, name: undefined, persona: undefined };
                }

                return out;
            };

            const payload = () =>
                JSON.stringify({
                    v: 1,
                    convs: fileConvs(),
                    events: history.events.map((event) => (hEventOk(event) ? event : bare(event))),
                });

            // Fill the file from the newest event back, and count the whole payload: the frame, every record with its
            // comma, and every event with its own. The oldest events that do not fit go, and their records with them.
            let convsSize = 2;
            let convsCount = 0;
            let eventsSize = 0;
            let fit = 0;
            const counted = new Set<string>();

            for (let index = history.events.length - 1; index >= 0; index--) {
                for (const id of named(history.events[index]!)) {
                    for (const key of [safeKey(id), ...sietches(id)]) {
                        const each = records[key];

                        if (each === undefined || counted.has(key)) {
                            continue;
                        }

                        counted.add(key);
                        convsSize += Buffer.byteLength(JSON.stringify(each));
                        convsSize += convsCount > 0 ? 1 : 0;
                        convsCount++;
                    }
                }

                const bytes = history.sizes[index]! + (fit > 0 ? 1 : 0);

                if (HISTORY_FRAME + convsSize + eventsSize + bytes > historyBytes) {
                    break;
                }

                eventsSize += bytes;
                fit++;
            }

            const cut = history.events.length - fit;

            if (cut > 0) {
                history.events.splice(0, cut);
                history.sizes.splice(0, cut);
            }

            // A record no remaining event names goes from memory too: nothing a replay shows needs it.
            history.convs = fit > 0 ? namedConvs() : dict();

            let text = payload();

            // The bytes themselves, not the count above: one record or one event can pass the rest on its own.
            while (Buffer.byteLength(text) > historyBytes && history.events.length > 0) {
                history.events.splice(0, 1);
                history.sizes.splice(0, 1);
                history.convs = namedConvs();
                text = payload();
            }

            const temporary = `${historyFile}.${process.pid}.${boot}.${++saves}.tmp`;

            try {
                await mkdir(folder, { recursive: true, mode: 0o700 });
                await writeFile(temporary, text, { mode: 0o600 });
                await rename(temporary, historyFile);
            } catch (error) {
                console.warn("dune: could not save its history:", error);
            }

            // The history still holds events: look again in a minute, so what expires leaves memory and file even
            // when nothing new happens.
            if (!disposed && history.events.length > 0) {
                historyTimer ??= setTimeout(() => {
                    // A pass with nothing new still prunes: the timer marks the history for a save.
                    history.dirty = true;
                    saveHistory();
                }, HISTORY_SAVE_MS);
            }
        });

        return state.saving;
    }

    function flush() {
        flushTimer = undefined;

        if (disposed) {
            return;
        }

        // Everything new, as parts each well under what one event may carry, and no more in one flush than the
        // app sends in a second. What does not fit waits for the next flush, in order.
        const parts: { kind: "convs" | "res" | "humans"; key: string; value: unknown }[] = [];
        const tables = [
            [
                "convs",
                changed.convs,
                world.convs,
                (key: string) => !(key in world.convs) || isOk(key),
            ],
            ["res", changed.res, world.res, () => true],
            ["humans", changed.humans, world.humans, () => true],
        ] as const;

        for (const [kind, set, table, allow] of tables) {
            for (const key of set) {
                if (allow(key)) {
                    parts.push({
                        kind,
                        key,
                        value: (table as Record<string, unknown>)[key] ?? null,
                    });
                } else {
                    // Not the owner's to see yet: the meta route sends it when Pi Pocket confirms it.
                    set.delete(key);
                }
            }
        }

        const batches: Record<string, unknown>[] = [];
        let batch: Record<string, unknown> | undefined;
        let size = 0;
        let total = 0;

        const room = (bytes: number) => {
            if (batch === undefined || size + bytes > BATCH_BYTES) {
                batch = { boot, events: [] as Ev[] };
                batches.push(batch);
                size = 0;
            }

            size += bytes;
            total += bytes;
        };

        for (const part of parts) {
            // UTF-8 bytes, as they go out. No one record passes BATCH_BYTES: its maps and keys are capped.
            const bytes =
                Buffer.byteLength(JSON.stringify(part.value)) + Buffer.byteLength(part.key) + 8;

            if (total + bytes > FLUSH_BYTES && total > 0) {
                break;
            }

            room(bytes);
            ((batch![part.kind] ??= dict()) as Record<string, unknown>)[part.key] = part.value;
            (part.kind === "convs"
                ? changed.convs
                : part.kind === "res"
                  ? changed.res
                  : changed.humans
            ).delete(part.key);
        }

        // Late events first (they belong before the new ones), then new events: both in the same byte budget.
        // What does not fit stays in its queue, in order, for the next flush.
        const take = (queue: Ev[], field: "late" | "events"): Ev[] => {
            let sent = 0;

            for (const event of queue) {
                if (!evOk(event)) {
                    sent++;
                    continue;
                }

                const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;

                if (total + bytes > FLUSH_BYTES && total > 0) {
                    break;
                }

                room(bytes);
                ((batch![field] ??= []) as Ev[]).push(event);
                sent++;
            }

            return queue.slice(sent);
        };

        out.late = take(out.late, "late");
        out.outbox = take(out.outbox, "events");

        const ask = [...unknown].filter((id) => world.convs[id] !== undefined && !isOk(id));

        unknown.clear();

        if (batches.length === 0) {
            batches.push({ boot, events: [] });
        }

        batches[0]!.unknown = ask;

        for (const each of batches) {
            each.n = ++state.batch;
            web.send("batch", each);
        }

        // Only what the byte limit held back waits for another flush.
        if (
            out.outbox.length + out.late.length > 0 ||
            changed.convs.size + changed.res.size + changed.humans.size > 0
        ) {
            flushTimer = setTimeout(flush, 1000);
        }
    }

    // Whichever version's code asks, the newest version's timers flush and save.
    state.kick = () => {
        if (disposed) {
            return;
        }

        flushTimer ??= setTimeout(flush, FLUSH_MS);
        saveTimer ??= setTimeout(save, SAVE_MS);
    };

    function schedule() {
        state.kick();
    }

    function emit(k: string, data: Record<string, unknown>): Ev {
        const event: Ev = { id: ++world.seq, at: Date.now(), k, ...data };

        world.events.push(event);

        if (world.events.length > MAX_EVENTS) {
            world.events.splice(0, world.events.length - MAX_EVENTS);
        }

        out.outbox.push(event);
        keep(event);

        // Far behind (a burst faster than the pages take): drop the queue and skip a batch number. Each page
        // sees the gap and loads the whole world again, which is cheaper than all of it in parts.
        if (out.outbox.length > MAX_OUTBOX) {
            out.outbox = [];
            out.late = [];
            state.batch++;
        }

        schedule();

        return event;
    }

    /**
     * A conversation. `touch` is false for a question that only asks about one (`meta`): a page that asks again every
     * few minutes must not keep an old session active. A conversation seen first is always new now.
     */
    function conv(id: string, touch = true): Conv {
        let found = world.convs[id];

        if (found === undefined) {
            found = emptyConv(id, Date.now());
            world.convs[id] = found;

            const before = new Set(Object.keys(world.convs));

            trim(world.convs, MAX_CONVS);
            before.forEach((key) => {
                if (world.convs[key] === undefined) {
                    changed.convs.add(key);
                    verified.delete(key);
                    held.delete(key);

                    for (let index = pending.length - 1; index >= 0; index--) {
                        if (pending[index]!.from === key) {
                            pending.splice(index, 1);
                        }
                    }
                }
            });
        }

        if (touch) {
            found.last = Date.now();
        }

        changed.convs.add(id);
        noteSeen(id);

        return found;
    }

    function touch(key: string, item: string | undefined, by: string, write?: boolean) {
        whenOk(by, () => {
            const found = (world.res[safeKey(key)] ??= {
                key,
                count: 0,
                last: 0,
                items: dict(),
                by: dict(),
            });
            const now = Date.now();

            found.count++;
            found.last = now;
            found.by[by] = (found.by[by] ?? 0) + 1;

            const visitors = Object.keys(found.by);

            if (visitors.length > MAX_VISITORS) {
                visitors
                    .sort((a, b) => found.by[b]! - found.by[a]!)
                    .slice(MAX_VISITORS)
                    .forEach((each) => delete found.by[each]);
            }

            if (item) {
                const entry = (found.items[safeKey(item)] ??= { n: 0, last: now });

                entry.n++;
                entry.last = now;

                if (write) {
                    entry.w = (entry.w ?? 0) + 1;
                }

                trim(found.items, MAX_ITEMS);
            }

            changed.res.add(safeKey(key));

            if (Object.keys(world.res).length > MAX_RESOURCES) {
                const before = new Set(Object.keys(world.res));

                trim(world.res, MAX_RESOURCES);
                before.forEach((each) => {
                    if (world.res[each] === undefined) {
                        changed.res.add(each);
                    }
                });
            }

            schedule();
        });
    }

    /**
     * True the first time a key is seen. A restart can run a hook again for the same call or request: its key, kept
     * in the file too, makes the second run count nothing.
     */
    function once(key: string): boolean {
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        if (seen.size > MAX_SEEN) {
            // Sets keep their order: the oldest half goes, the recent keys stay.
            [...seen].slice(0, MAX_SEEN / 2).forEach((each) => seen.delete(each));
        }

        return true;
    }

    function isAncestor(maybe: string, of: string): boolean {
        let at: string | undefined = of;

        for (let depth = 0; at !== undefined && depth < 16; depth++) {
            if (at === maybe) {
                return true;
            }

            at = world.convs[at]?.parent;
        }

        return false;
    }

    /**
     * `child` belongs to `parent`. `sure`: the parent's own tool call says so (its result names the child); only then
     * does a subagent count as seen when its parent is. A match of words places it, but never shows it.
     */
    function relate(
        child: string,
        parent: string,
        kind: Kind,
        name?: string,
        title?: string,
        sure = false,
    ) {
        if (child === parent || isAncestor(child, parent)) {
            return;
        }

        const found = conv(child);
        const was = `${found.kind}:${found.parent ?? ""}`;

        if (found.parent !== parent) {
            found.sure = false;
        }

        const hidden = !isOk(child);

        found.kind = kind;
        found.parent = parent;
        found.sure = found.sure === true || sure;

        // Shown just now (its parent's tool result named it): what it did before goes out too, late.
        if (hidden && isOk(child)) {
            // Not those still waiting to go out as new: each event goes out once.
            const queued = new Set(out.outbox.map((event) => event.id));

            out.late.push(
                ...world.events.filter(
                    (event) => (event.c === child || event.to === child) && !queued.has(event.id),
                ),
            );

            // Too many to send: let the pages load the world again (the gap in the numbers tells them).
            if (out.late.length > MAX_OUTBOX) {
                out.late = [];
                state.batch++;
            }
        }

        if (name) {
            found.name = clip(name, 60);
        }

        if (title && !found.title) {
            found.title = title;
        }

        conv(parent);

        if (was !== `${kind}:${parent}`) {
            emit("link", { c: child, p: parent, kind, name: found.name });
        }

        // A subagent of a session the owner sees is seen too.
        release();
    }

    function prune() {
        const now = Date.now();

        for (let index = pending.length - 1; index >= 0; index--) {
            if (now - pending[index]!.at > PENDING_MS) {
                pending.splice(index, 1);
            }
        }
    }

    function drop(entry: Pending) {
        const at = pending.indexOf(entry);

        if (at >= 0) {
            pending.splice(at, 1);
        }
    }

    /** A new message to Pi in `id`: who sent it, as a comet. `first`: the first time this conversation is seen. */
    function arrived(id: string, raw: string, first: boolean) {
        const here = conv(id);
        const author = FROM_PREFIX.exec(raw);
        const text = author === null ? raw : raw.slice(author[0].length);
        const linked =
            /Message from linked session[^\n]*\n<linked-session-message>\n([\s\S]*?)\n?<\/linked-session-message>/.exec(
                text,
            );

        prune();

        // A subagent's first message starts with what it was sent; a linked session's holds it somewhere (a
        // `team_delegate` call puts a preamble first), so it is searched as a whole.
        const match = (via: Pending["via"], body: string) => {
            const probe = via === "team" ? bodyOf(body) : probeOf(body);
            const fits =
                via === "team"
                    ? (each: Pending) => probe.includes(each.probe.slice(0, 60))
                    : (each: Pending) => probe.startsWith(each.probe.slice(0, 60));

            return pending.find(
                (each) =>
                    each.via === via &&
                    each.from !== id &&
                    each.probe.length >= MIN_PROBE &&
                    fits(each),
            );
        };

        if (linked !== null) {
            const body = linked[1]!;
            const found = match("team", body);

            if (found !== undefined) {
                drop(found);

                if (
                    found.action === "start" &&
                    first &&
                    here.kind === "session" &&
                    here.parent === undefined
                ) {
                    relate(id, found.from, "linked", found.agent, found.title);
                }
            }

            // A `team_delegate` preamble is the persona's boilerplate: the words worth showing are the task after it.
            const marker = body.indexOf(TASK_MARKER);
            const shown = marker >= 0 ? body.slice(marker + TASK_MARKER.length) : body;

            emit("msg", { from: found?.from, to: id, via: "team", text: clip(shown, 200) });

            return;
        }

        if (text.startsWith("[subagent ")) {
            // A report, already shown when the subagent answered.
            return;
        }

        if (text.startsWith("[scheduled]")) {
            emit("msg", { from: "station:schedule", to: id, via: "system", text: clip(text, 200) });

            return;
        }

        if (text.startsWith("[via PR watch]")) {
            emit("msg", { from: "station:github", to: id, via: "system", text: clip(text, 200) });

            return;
        }

        if (text.startsWith("[night-shift]")) {
            emit("msg", { from: "station:night", to: id, via: "system", text: clip(text, 200) });

            return;
        }

        if (text.startsWith("[desk]")) {
            emit("msg", { from: "station:desk", to: id, via: "system", text: clip(text, 200) });

            return;
        }

        if (here.kind === "subagent") {
            // Its work comes from its parent, shown when the parent's call returned.
            return;
        }

        // A conversation seen first with the words a subagent was just sent is that subagent.
        const forChild = first ? match("subagent", text) : undefined;

        if (forChild !== undefined) {
            forChild.delivered = id;
            relate(id, forChild.from, "subagent", forChild.name);
            emit("msg", {
                from: forChild.from,
                to: id,
                via: "subagent",
                text: clip(text, 200),
                call: forChild.callKey,
            });

            return;
        }

        const name = safeKey(author?.[1] ?? "You");

        whenOk(id, () => {
            const person = (world.humans[name] ??= { name, count: 0, last: 0 });

            person.count++;
            person.last = Date.now();
            changed.humans.add(name);

            if (Object.keys(world.humans).length > MAX_HUMANS) {
                const before = Object.keys(world.humans);

                trim(world.humans, MAX_HUMANS);
                before.forEach((each) => {
                    if (world.humans[each] === undefined) {
                        changed.humans.add(each);
                    }
                });
            }

            schedule();
        });

        if (!here.title && here.kind === "session") {
            here.title = clip(text.split("\n")[0], 60);
        }

        emit("msg", { from: `human:${name}`, to: id, via: "human", text: clip(text, 200) });
    }

    const tools = hook(ToolTask, {
        beforeTool: (call, api) => {
            try {
                const key = `${api.taskId}:${call.id}`;

                if (!once(`b:${key}`)) {
                    return undefined;
                }

                const id = String(api.conversationId);
                const here = conv(id);
                const args = (call.arguments ?? {}) as Record<string, unknown>;
                const what = classify(call.name, args, here.cwd);

                here.calls++;
                here.tools[safeKey(call.name)] = (here.tools[safeKey(call.name)] ?? 0) + 1;

                // Keys are cut short too: a path of 5000 characters stays out of the world.
                if (what.i !== undefined) {
                    what.i = clip(what.i, 160);
                }

                if (what.s === "files" && what.i) {
                    const entry = (here.files[safeKey(what.i)] ??= { r: 0, w: 0, last: 0 });

                    entry[what.w ? "w" : "r"]++;
                    entry.last = Date.now();
                    trim(here.files, MAX_ITEMS);
                }

                if (what.s) {
                    touch(what.s, what.i, id, what.w);
                }

                const message = typeof args.message === "string" ? args.message : "";
                const agent = typeof args.agent === "string" ? args.agent : undefined;
                const task = typeof args.task === "string" ? args.task : "";
                const expect = (entry: Omit<Pending, "from" | "at" | "callKey">) => {
                    prune();

                    if (pending.length >= MAX_PENDING) {
                        pending.shift();
                    }

                    pending.push({ ...entry, from: id, at: Date.now(), callKey: key });
                };

                if (
                    (call.name === "subagent" || call.name === "team") &&
                    ["spawn", "send", "start"].includes(String(args.action)) &&
                    probeOf(message).length >= MIN_PROBE
                ) {
                    expect({
                        via: call.name as Pending["via"],
                        action: String(args.action),
                        name: typeof args.name === "string" ? args.name : undefined,
                        title: typeof args.title === "string" ? clip(args.title, 60) : undefined,
                        probe: probeOf(message),
                    });
                } else if (call.name === "team_delegate" && probeOf(task).length >= MIN_PROBE) {
                    // The owner's team tool: it starts a linked session for a persona, with the task after a
                    // preamble.
                    expect({
                        via: "team",
                        action: "start",
                        name: agent,
                        agent,
                        title: clip(
                            typeof args.title === "string" ? args.title : task.split("\n")[0],
                            60,
                        ),
                        probe: probeOf(task),
                    });
                } else if (call.name === "team_message" && probeOf(message).length >= MIN_PROBE) {
                    expect({
                        via: "team",
                        action: "send",
                        name: typeof args.to === "string" ? args.to : undefined,
                        probe: probeOf(message),
                    });
                }

                const parent =
                    call.parent === undefined
                        ? undefined
                        : `${call.parent.taskId}:${call.parent.callId}`;

                emit("tool", {
                    c: id,
                    call: key,
                    n: call.name,
                    ...(what.s ? { s: what.s } : {}),
                    ...(what.i ? { i: clip(what.i, 80) } : {}),
                    l: clip(what.l, 100),
                    ...(what.w ? { w: 1 } : {}),
                    ...(parent ? { par: parent } : {}),
                    ...(call.name === "subagent" || call.name === "team"
                        ? { a: clip(args.action, 12), tn: clip(args.name ?? args.to, 40) }
                        : {}),
                    ...(call.name === "team_delegate"
                        ? { a: "start", tn: clip(args.agent, 40) }
                        : {}),
                    ...(call.name === "team_message" ? { a: "send", tn: clip(args.to, 40) } : {}),
                });
            } catch (error) {
                console.warn("dune: beforeTool", error);
            }

            return undefined;
        },
        afterTool: (call, result, api) => {
            try {
                const key = `${api.taskId}:${call.id}`;

                if (!once(`a:${key}`)) {
                    return undefined;
                }

                const id = String(api.conversationId);
                const here = conv(id);
                const failed = result.isError === true;
                const args = (call.arguments ?? {}) as Record<string, unknown>;
                const mine = pending.find((each) => each.callKey === key);

                if (failed) {
                    here.errors++;
                }

                const details = result.details as
                    { conversationId?: unknown; name?: unknown; action?: unknown } | undefined;

                if (
                    call.name === "subagent" &&
                    details !== undefined &&
                    details !== null &&
                    typeof details === "object" &&
                    details.conversationId !== undefined &&
                    typeof details.name === "string"
                ) {
                    const child = String(details.conversationId);

                    relate(child, id, "subagent", details.name, undefined, true);

                    if (details.action === "stop") {
                        emit("msg", {
                            from: id,
                            to: child,
                            via: "stop",
                            text: `stop ${details.name}`,
                        });
                    } else if (mine?.delivered === undefined && typeof args.message === "string") {
                        emit("msg", {
                            from: id,
                            to: child,
                            via: "subagent",
                            text: clip(args.message, 200),
                            call: key,
                        });
                    }
                }

                // A subagent's work is shown by now; a team message waits for its session unless it failed.
                if (mine !== undefined && (call.name === "subagent" || failed)) {
                    drop(mine);
                }

                emit("done", {
                    c: id,
                    call: key,
                    n: call.name,
                    ok: failed ? 0 : 1,
                    ...(failed ? { e: clip(textOf(result.output), 140) } : {}),
                });
            } catch (error) {
                console.warn("dune: afterTool", error);
            }

            return undefined;
        },
    });

    const generation = hook(GenerationTask, {
        beforeRequest: (request, api) => {
            try {
                // A request is tried again after a failure or a restart, with the same messages: count it once.
                const lastAt = request.messages.at(-1)?.timestamp ?? "";

                if (!once(`q:${api.taskId}:${request.messages.length}:${lastAt}`)) {
                    return undefined;
                }

                const id = String(api.conversationId);
                const here = conv(id);
                const users = request.messages.filter((each) => each.role === "user");
                // Where it got to, kept with the conversation: the newest user message's time, and how many with
                // that same time it has seen (several can share one). Only what lies past it is new, so a replay,
                // a compaction, or any history that comes back is never new again.
                const stamp = (each: (typeof users)[number]) =>
                    "timestamp" in each && typeof each.timestamp === "number" ? each.timestamp : 0;
                let cursor = here.cursor;

                if (cursor === undefined) {
                    // First sight: only the messages this request answers (after the last of Pi's) are new.
                    let trailing = 0;

                    for (let index = request.messages.length - 1; index >= 0; index--) {
                        if (request.messages[index]!.role !== "user") {
                            break;
                        }

                        trailing++;
                    }

                    const old = users.slice(0, users.length - trailing);
                    const last = old.at(-1);

                    cursor = last
                        ? {
                              t: stamp(last),
                              k: old.filter((each) => stamp(each) === stamp(last)).length,
                          }
                        : { t: -1, k: 0 };
                }

                const first = here.cursor === undefined;
                let same = 0;

                for (const each of users) {
                    const time = stamp(each);

                    // Older than the cursor, or one of the messages at its time it already saw: not new.
                    if (time < cursor.t || (time === cursor.t && ++same <= cursor.k)) {
                        continue;
                    }

                    arrived(id, textOf(each.content), first);
                }

                const last = users.at(-1);

                here.cursor = last
                    ? {
                          t: stamp(last),
                          k: users.filter((each) => stamp(each) === stamp(last)).length,
                      }
                    : cursor;
                here.users = users.length;
                emit("think", {
                    c: id,
                    m: request.messages.length,
                    ...(here.provider ? { pv: here.provider, md: here.model } : {}),
                });
            } catch (error) {
                console.warn("dune: beforeRequest", error);
            }

            return undefined;
        },
        afterResponse: (message, api) => {
            try {
                if (!once(`r:${api.taskId}:${message.timestamp}`)) {
                    return;
                }

                const id = String(api.conversationId);
                const here = conv(id);
                const usage = message.usage;
                const text = message.content
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("");
                const thought = message.content
                    .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
                    .join("");
                const calls = message.content.filter((part) => part.type === "toolCall").length;
                const tin =
                    (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
                const tout = usage?.output ?? 0;
                const cost = usage?.cost?.total ?? 0;

                here.provider = message.provider;
                here.model = message.model;
                here.turns++;
                here.tin += tin;
                here.tout += tout;
                here.cost += cost;

                if (message.thinkingLevel) {
                    here.thinking = message.thinkingLevel;
                }

                if (message.stopReason === "error") {
                    here.errors++;
                }

                touch(`model:${message.provider}`, message.model, id);
                emit("reply", {
                    c: id,
                    pv: message.provider,
                    md: message.model,
                    tin,
                    tout,
                    cost,
                    calls,
                    stop: message.stopReason,
                    ...(text ? { text: clip(text, 220) } : {}),
                    ...(thought ? { th: clip(thought.slice(-400), 160) } : {}),
                    ...(message.errorMessage ? { e: clip(message.errorMessage, 140) } : {}),
                });
            } catch (error) {
                console.warn("dune: afterResponse", error);
            }
        },
        onYield: (answer, api) => {
            try {
                if (!once(`y:${api.taskId}:${answer.timestamp}`)) {
                    return undefined;
                }

                const id = String(api.conversationId);
                const here = conv(id);
                const text = answer.content
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("");

                emit("idle", { c: id });

                if (here.kind === "subagent" && here.parent !== undefined) {
                    emit("msg", {
                        from: id,
                        to: here.parent,
                        via: "report",
                        text: clip(text, 200),
                    });
                }
            } catch (error) {
                console.warn("dune: onYield", error);
            }

            return undefined;
        },
    });

    /**
     * What the owner may see of the world: the conversations active in the last 12 hours, the sietches they hang from,
     * and events of only those.
     */
    function visible() {
        const convs = dict<Conv>();
        const now = Date.now();
        const since = now - ACTIVE_MS;
        const show = new Set<string>();

        for (const [id, each] of Object.entries(world.convs)) {
            if (isOk(id) && each.last >= since) {
                show.add(id);
            }
        }

        // An ancestor shows too, so an active subagent or linked session still hangs from its sietch.
        for (const id of [...show]) {
            let at = world.convs[id]?.parent;

            for (let depth = 0; at !== undefined && depth < 16; depth++) {
                if (isOk(at)) {
                    show.add(at);
                }

                at = world.convs[at]?.parent;
            }
        }

        for (const id of show) {
            convs[id] = world.convs[id]!;
        }

        return {
            boot,
            // The last batch this already holds: a page takes later ones, and loads again if one goes missing.
            batch: state.batch,
            now,
            // How long a session counts as active, so the page can say why a sietch is not there.
            active: ACTIVE_MS,
            convs,
            res: world.res,
            humans: world.humans,
            events: world.events.filter(evOk).slice(-SNAPSHOT_EVENTS),
            unknown: Object.keys(world.convs).filter(
                (id) => !isOk(id) && (world.convs[id]?.last ?? 0) >= since,
            ),
        };
    }

    // The world as it is now, for a page that opens; then the page listens to "batch".
    web.route("GET", "world", () => visible());

    // The night as it was: the compact events in a window, and the conversations they name, for a page that replays
    // it. A conversation the owner may no longer see keeps only what it was: its events go, and its words with them.
    web.route("GET", "history", (request) => {
        const now = Date.now();
        const span = (text: string | null, fallback: number): number => {
            if (text === null || text.trim() === "") {
                return fallback;
            }

            const value = Number(text);

            return Number.isFinite(value) ? value : fallback;
        };
        const since = now - HISTORY_MS;
        // Nothing older than the window leaves, whatever the page asks for.
        const from = Math.max(span(request.query.get("from"), since), since);
        const to = span(request.query.get("to"), now);
        const events = history.events.filter(
            (event) => event.at >= since && event.at >= from && event.at <= to && hEventOk(event),
        );
        const convs = dict<Conv>();
        const shown = new Set<string>();

        const show = (id: string) => {
            if (shown.has(id) || !hOk(id)) {
                return;
            }

            shown.add(id);

            const here = world.convs[id];
            const kept = history.convs[safeKey(id)];

            if (here !== undefined && isOk(id)) {
                convs[id] = here;

                return;
            }

            if (kept === undefined) {
                return;
            }

            // Only what names it, and no counts: the page draws the session as it was.
            convs[id] = {
                id,
                kind: kept.kind,
                ...(kept.parent !== undefined ? { parent: kept.parent } : {}),
                ...(kept.name !== undefined ? { name: kept.name } : {}),
                ...(kept.title !== undefined ? { title: kept.title } : {}),
                ...(kept.persona !== undefined ? { persona: kept.persona } : {}),
                ...(kept.provider !== undefined ? { provider: kept.provider } : {}),
                ...(kept.model !== undefined ? { model: kept.model } : {}),
                first: kept.first,
                last: kept.last,
                tin: 0,
                tout: 0,
                cost: 0,
                calls: 0,
                turns: 0,
                errors: 0,
                tools: dict(),
                files: dict(),
            };
        };

        for (const event of events) {
            for (const id of named(event)) {
                show(id);

                let at = world.convs[id]?.parent ?? history.convs[safeKey(id)]?.parent;

                for (let depth = 0; at !== undefined && depth < 16; depth++) {
                    show(at);
                    at = world.convs[at]?.parent ?? history.convs[safeKey(at)]?.parent;
                }
            }
        }

        return { from, to, now, convs, events };
    });

    /**
     * Who the team extension says a session is, read as the owner's own request: the persona's name, or undefined
     * when there is no team extension, no persona, or the question fails.
     */
    async function personaOf(request: {
        snapshot: WebRequest["snapshot"];
        context: WebRequest["context"];
        conversation: { id: unknown };
    }): Promise<string | undefined> {
        const team = (globalThis as Record<symbol, unknown>)[TEAM_API] as
            | {
                  persona?: (
                      read: { snapshot: WebRequest["snapshot"] },
                      conversationId: unknown,
                      context: unknown,
                  ) => Promise<{ name?: unknown } | undefined>;
              }
            | undefined;

        if (typeof team?.persona !== "function") {
            return undefined;
        }

        try {
            const found = await team.persona(
                { snapshot: request.snapshot.bind(request) },
                request.conversation.id,
                request.context,
            );

            return typeof found?.name === "string" && found.name !== ""
                ? clip(found.name, 60)
                : undefined;
        } catch {
            return undefined;
        }
    }

    // A session's title, folder, and model. Pi Pocket answers it only when the owner may see that session, so a
    // conversation is shown to them only after it answers here. It also changes this module's own memory: from now
    // on the session counts as confirmed, and what was held back for it is released.
    web.conversationRoute(
        "GET",
        "meta/:source",
        async (request) => {
            const generation = state.generation;
            const [linked, persona] = await Promise.all([
                request.linkedSessions.list().catch(() => []),
                personaOf(request),
            ]);

            // A reset while this waited: tell nothing from before it.
            if (generation !== state.generation || disposed) {
                return { conv: null, convs: {}, events: [], res: {}, humans: {} };
            }

            const id = String(request.conversation.id);
            const wasOk = isOk(id);
            // No touch: asking again about an old session must not make it look active.
            const here = conv(id, false);

            verified.add(id);
            here.title = request.conversation.title || here.title;
            here.cwd = request.conversation.cwd || here.cwd;

            if (request.conversation.model) {
                here.provider = request.conversation.model.provider;
                here.model = request.conversation.model.modelId;
            }

            here.thinking = request.conversation.thinkingLevel;

            if (persona !== undefined) {
                here.persona = persona;
            }

            // The list runs both ways and does not say which session started which: it gives titles only.
            for (const each of linked) {
                const other = world.convs[String(each.conversationId)];

                if (other !== undefined && each.title) {
                    other.title = each.title;
                    changed.convs.add(other.id);
                }
            }

            const shown = new Set([...release(), ...(wasOk ? [] : [id])]);

            const reveal = dict<Conv>();

            for (const [key, each] of Object.entries(world.convs)) {
                if (
                    isOk(key) &&
                    (shown.has(key) || (each.parent !== undefined && shown.has(each.parent)))
                ) {
                    reveal[key] = each;
                    shown.add(key);
                }
            }

            // Confirmed now, with every subagent this confirms too: the history's records say so at once, so the
            // events it keeps keep their words even after the world forgets the session.
            for (const each of Object.values(history.convs)) {
                if (each.ok !== true && isOk(each.id)) {
                    remember(each.id);
                }
            }

            schedule();

            return {
                conv: here,
                convs: reveal,
                events:
                    shown.size === 0
                        ? []
                        : world.events.filter(
                              (event) =>
                                  evOk(event) &&
                                  [event.c, event.p, event.from, event.to].some(
                                      (each) => isConv(each) && shown.has(each),
                                  ),
                          ),
                res: world.res,
                humans: world.humans,
            };
        },
        { conversation: "source" },
    );

    // Forget what it saw.
    web.route("POST", "reset", async () => {
        state.generation++;
        world.convs = dict();
        world.res = dict();
        world.humans = dict();
        world.events = [];
        history.events = [];
        history.sizes = [];
        history.convs = dict();
        history.calls.clear();
        history.tokens = HISTORY_BURST;
        history.filled = Date.now();
        history.fresh.clear();
        pending.length = 0;
        held.clear();
        seen.clear();
        verified.clear();
        // Nothing from before goes out after the reset, not even what waited to be sent.
        out.outbox = [];
        out.late = [];
        changed.convs.clear();
        changed.res.clear();
        changed.humans.clear();
        unknown.clear();
        schedule();
        web.send("reset", { boot });

        // The history's file holds nothing either: it is written empty, not left behind.
        clearTimeout(historyTimer);
        history.dirty = true;
        await saveHistory();

        return { ok: true };
    });

    web.client("dune");

    web.onDispose(async () => {
        disposed = true;
        clearTimeout(flushTimer);
        clearTimeout(saveTimer);
        clearTimeout(historyTimer);
        await save();
        await saveHistory();
    });

    return defineExtension({ name: "dune", hooks: [tools, generation] });
}
