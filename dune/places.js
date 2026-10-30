// The places of Arrakis: where each tool call goes, and what each is called.

import { hue } from "./cast.js";

/** The places every desert has, by the server's key for them. */
export const PLACES = {
    files: {
        label: "Archives of Chapterhouse",
        short: "Archives",
        icon: "book",
        what: "read, write, and edit: every file an agent touches",
        draw: "archives",
    },
    shell: {
        label: "Ixian Foundry",
        short: "Foundry",
        icon: "gear",
        what: "shell commands, run on the machines of Ix",
        draw: "foundry",
    },
    github: {
        label: "Guild Heighliner Port",
        short: "Guild Port",
        icon: "fold",
        what: "git, gh, and PR watches; a git push folds space",
        draw: "port",
    },
    web: {
        label: "Seer's Spire",
        short: "Spire",
        icon: "eye",
        what: "the browser, and tools that search, fetch, or reach the web: prescience",
        draw: "spire",
    },
    codemode: {
        label: "Axlotl Tanks",
        short: "Tanks",
        icon: "spiral",
        what: "codemode scripts: grown, not built",
        draw: "tanks",
    },
    memory: {
        label: "Vault of Other Memory",
        short: "Memory",
        icon: "rune",
        what: "the memory tool: all the lives before",
        draw: "vault",
    },
    artifact: {
        label: "Mural Cave",
        short: "Murals",
        icon: "hand",
        what: "artifacts, painted on the cave wall",
        draw: "murals",
    },
    schedule: {
        label: "Moon Dial",
        short: "Moon Dial",
        icon: "moon",
        what: "scheduled messages, by the two moons",
        draw: "dial",
    },
    ext: {
        label: "Landsraad Hall",
        short: "Landsraad",
        icon: "seal",
        what: "any other tool, from extensions",
        draw: "hall",
    },
};

/** Places shown even before anyone goes there. */
export const CORE = ["files", "shell", "github", "web", "ext"];

/** Each station that sends messages, and the place it sends them from. */
export const STATIONS = {
    schedule: "schedule",
    night: "schedule",
    github: "github",
    desk: "citadel",
};

const PROVIDER = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    "github-copilot": "Copilot",
    google: "Gemini",
    deepseek: "DeepSeek",
    xai: "xAI",
    mistral: "Mistral",
    openrouter: "OpenRouter",
    groq: "Groq",
    ollama: "Ollama",
};

const title = (text) =>
    String(text)
        .split(/[-_ .]+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");

/** A provider's name as people say it. */
export function providerName(provider) {
    return PROVIDER[provider] ?? title(provider ?? "Unknown");
}

/** What a place key stands for: its names, picture, and colour. */
export function placeDef(key) {
    if (PLACES[key]) {
        return { key, ...PLACES[key] };
    }

    if (key.startsWith("model:")) {
        const provider = key.slice(6);
        const name = providerName(provider);

        return {
            key,
            label: `Spice Fields of ${name}`,
            short: `${name} Fields`,
            icon: "spice",
            what: `model requests to ${name}: melange flows back as tokens`,
            draw: "spice",
            provider,
            color: hue(provider),
        };
    }

    if (key.startsWith("mcp:")) {
        const server = key.slice(4) || "?";
        const house = title(server);

        return {
            key,
            label: `Embassy of House ${house}`,
            short: `House ${house}`,
            icon: "banner",
            what: `MCP calls to the ${server} server`,
            draw: "embassy",
            server,
            color: hue(server, true),
        };
    }

    return { key, label: title(key), short: title(key), icon: "seal", what: key, draw: "hall" };
}

/** The Citadel: where the people who write to the agents live. */
export const CITADEL = {
    key: "citadel",
    label: "Arrakeen Citadel",
    short: "Citadel",
    icon: "crown",
    what: "the people who write to the agents, and the Desk",
    draw: "citadel",
};
