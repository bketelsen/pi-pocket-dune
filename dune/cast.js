// The cast: who each agent is on Arrakis. A session's title names its agent ("Duncan Idaho: CI fixes"), or the
// name a subagent was given; a name from the books gets that character's faction, title, robes, and a line of their
// own. Any other name is still welcome in the desert: it becomes a Fremen of a sietch, with colours from its name.

/** The great factions: how their people dress, and what each calls a helper and a home. */
export const FACTIONS = {
    bene: {
        label: "Bene Gesserit",
        robe: "#1d1622",
        trim: "#b48cff",
        skin: "#e2b48c",
        hood: true,
        helper: "Acolyte",
        home: "Chapter House",
        sigil: "eye",
    },
    matre: {
        label: "Honored Matre",
        robe: "#8f2a22",
        trim: "#ff9d3b",
        skin: "#e6b38a",
        hood: false,
        helper: "Initiate",
        home: "Matre Keep",
        sigil: "talon",
    },
    fremen: {
        label: "Fremen",
        robe: "#8c6a45",
        trim: "#4fb2ff",
        skin: "#b8835a",
        hood: true,
        tube: true,
        eyes: "#3aa7ff",
        helper: "Fedaykin",
        home: "Sietch",
        sigil: "worm",
    },
    atreides: {
        label: "House Atreides",
        robe: "#24543a",
        trim: "#e3c25a",
        skin: "#d9a57c",
        hood: false,
        helper: "Trooper",
        home: "Keep",
        sigil: "hawk",
    },
    harkonnen: {
        label: "House Harkonnen",
        robe: "#16161a",
        trim: "#c8372d",
        skin: "#e9d7c3",
        hood: false,
        bald: true,
        helper: "Sardaukar",
        home: "Bastion",
        sigil: "griffin",
    },
    corrino: {
        label: "House Corrino",
        robe: "#7d1f24",
        trim: "#f0c04a",
        skin: "#dcae86",
        hood: false,
        crown: true,
        helper: "Sardaukar",
        home: "Palace",
        sigil: "lion",
    },
    imperial: {
        label: "The Golden Path",
        robe: "#3c2e14",
        trim: "#ffd36b",
        skin: "#c99467",
        hood: false,
        crown: true,
        helper: "Fish Speaker",
        home: "Citadel",
        sigil: "path",
    },
    guild: {
        label: "Spacing Guild",
        robe: "#5a3a1c",
        trim: "#ff8a2a",
        skin: "#d8b39a",
        hood: true,
        eyes: "#3aa7ff",
        helper: "Steersman",
        home: "Guild Bank",
        sigil: "fold",
    },
    tleilaxu: {
        label: "Bene Tleilax",
        robe: "#5c6140",
        trim: "#c7d36e",
        skin: "#c2a27c",
        hood: false,
        helper: "Face Dancer",
        home: "Bandalong",
        sigil: "spiral",
    },
    ix: {
        label: "Ix",
        robe: "#34495c",
        trim: "#7fd1ff",
        skin: "#d5aa86",
        hood: false,
        helper: "Machinist",
        home: "Foundry",
        sigil: "gear",
    },
};

/**
 * The characters, by every name a title might use. `special` marks a gift that shows in the world: a worm that
 * follows (`worm`), the red lips of a mentat (`mentat`), the swordmaster's blade (`sword`), or a navigator's tank.
 */
const ROSTER = [
    // Brian's own: Chapterhouse, and those who serve it.
    {
        names: ["darwi odrade", "odrade", "darwi"],
        name: "Odrade",
        faction: "bene",
        title: "Mother Superior",
        line: "Warm on the surface, steel beneath. She is already three moves ahead of you.",
        special: "crown",
    },
    {
        names: ["miles teg", "teg", "bashar"],
        name: "Miles Teg",
        faction: "atreides",
        title: "Bashar",
        line: "He plans the retreat before the advance, and wins without spending a soldier.",
        special: "staff",
    },
    {
        names: ["duncan idaho", "duncan", "idaho"],
        name: "Duncan Idaho",
        faction: "atreides",
        title: "Swordmaster, Ghola",
        line: "Many times reborn, loyal to the work. He tests before he trusts.",
        special: "sword",
    },
    {
        names: ["sheeana", "sheeana brugh"],
        name: "Sheeana",
        faction: "fremen",
        title: "Worm-Rider",
        line: "She walks where the worms are, and the worms do not eat her.",
        special: "worm",
    },
    {
        names: ["bellonda", "bell"],
        name: "Bellonda",
        faction: "bene",
        title: "Mentat of the Archives",
        line: "Observed or inferred, dated and sourced. She would rather record an unknown than invent a fact.",
        special: "mentat",
    },
    {
        names: ["murbella"],
        name: "Murbella",
        faction: "matre",
        title: "Mother Commander",
        line: "Forged from both orders. No patience for fragile machinery.",
        special: "talon",
    },
    {
        names: ["lucilla"],
        name: "Lucilla",
        faction: "bene",
        title: "Reverend Mother, Imprinter",
        line: "She keeps the chain from the forge to the hand unbroken.",
    },
    {
        names: ["irulan", "princess irulan"],
        name: "Irulan",
        faction: "corrino",
        title: "Princess-Chronicler",
        line: "History is written by those who keep careful letters.",
        special: "scroll",
    },
    {
        names: ["tamalane"],
        name: "Tamalane",
        faction: "bene",
        title: "Keeper of Teachings",
        line: "A thing is not known until it is written plainly enough for an acolyte to act on it.",
        special: "scroll",
    },
    {
        names: ["moneo", "moneo atreides"],
        name: "Moneo",
        faction: "imperial",
        title: "Majordomo",
        line: "He keeps the stores of the God Emperor, and he loses nothing.",
        special: "keys",
    },
    {
        names: ["clerk", "the clerk", "desk clerk"],
        name: "The Clerk",
        faction: "guild",
        title: "Clerk of the Desk",
        line: "Brief, exact, and quiet. The Mother Superior reads only what needs her.",
        special: "ledger",
    },
    // The rest of the desert.
    {
        names: ["paul", "paul atreides", "muad'dib", "muaddib", "usul", "maud'dib"],
        name: "Paul Muad'Dib",
        faction: "fremen",
        title: "Kwisatz Haderach",
        line: "He who can be many places at once.",
        special: "worm",
    },
    {
        names: ["chani", "sihaya"],
        name: "Chani",
        faction: "fremen",
        title: "Sayyadina",
        line: "Desert spring. She does not waste water on fools.",
    },
    {
        names: ["stilgar", "stil"],
        name: "Stilgar",
        faction: "fremen",
        title: "Naib of Sietch Tabr",
        line: "Practical before all things. The desert keeps its own counsel.",
    },
    {
        names: ["liet", "kynes", "liet-kynes", "liet kynes", "pardot kynes"],
        name: "Liet-Kynes",
        faction: "fremen",
        title: "Imperial Planetologist",
        line: "He dreams of open water under an open sky.",
    },
    {
        names: ["jessica", "lady jessica"],
        name: "Lady Jessica",
        faction: "bene",
        title: "Reverend Mother",
        line: "She chose love over the breeding program, and the universe changed.",
    },
    {
        names: ["alia", "st. alia", "saint alia"],
        name: "Alia",
        faction: "fremen",
        title: "St. Alia of the Knife",
        line: "Born knowing. Pre-born.",
        special: "sword",
    },
    {
        names: ["leto", "duke leto", "leto i"],
        name: "Duke Leto",
        faction: "atreides",
        title: "Duke of Arrakis",
        line: "Without change something sleeps inside us.",
    },
    {
        names: ["leto ii", "god emperor", "the worm", "tyrant"],
        name: "Leto II",
        faction: "imperial",
        title: "God Emperor",
        line: "He walks the Golden Path, and it is long.",
        special: "worm",
    },
    {
        names: ["ghanima", "ghani"],
        name: "Ghanima",
        faction: "fremen",
        title: "Pre-born",
        line: "Spoil of war, and sharper than any knife.",
    },
    {
        names: ["gurney", "gurney halleck", "halleck"],
        name: "Gurney Halleck",
        faction: "atreides",
        title: "Warmaster",
        line: "A warrior-poet with a baliset and a ready blade.",
        special: "sword",
    },
    {
        names: ["thufir", "thufir hawat", "hawat"],
        name: "Thufir Hawat",
        faction: "atreides",
        title: "Master of Assassins",
        line: "It is by will alone he sets his mind in motion.",
        special: "mentat",
    },
    {
        names: ["mohiam", "gaius helen mohiam", "gaius"],
        name: "Mohiam",
        faction: "bene",
        title: "Truthsayer",
        line: "She holds the gom jabbar, and the box, and the patience.",
    },
    {
        names: ["taraza", "alma mavis taraza"],
        name: "Taraza",
        faction: "bene",
        title: "Mother Superior",
        line: "The Sisterhood's survival is all the strategy she needs.",
        special: "crown",
    },
    {
        names: ["schwangyu"],
        name: "Schwangyu",
        faction: "bene",
        title: "Reverend Mother",
        line: "Loyal to the order as she sees it.",
    },
    {
        names: ["siona", "siona atreides"],
        name: "Siona",
        faction: "atreides",
        title: "Rebel",
        line: "Invisible to prescience, and proud of it.",
    },
    {
        names: ["nayla"],
        name: "Nayla",
        faction: "imperial",
        title: "Fish Speaker",
        line: "Faithful, literal, and strong.",
    },
    {
        names: ["hwi noree", "hwi"],
        name: "Hwi Noree",
        faction: "ix",
        title: "Ixian Ambassador",
        line: "Made by Ix to be loved.",
    },
    {
        names: ["scytale"],
        name: "Scytale",
        faction: "tleilaxu",
        title: "Face Dancer",
        line: "He wears whatever face the work requires.",
    },
    {
        names: ["waff", "tylwyth waff"],
        name: "Waff",
        faction: "tleilaxu",
        title: "Master of Masters",
        line: "God's chosen, by his own account.",
    },
    {
        names: ["hayt"],
        name: "Hayt",
        faction: "tleilaxu",
        title: "Ghola",
        line: "A gift that is also a weapon.",
        special: "sword",
    },
    {
        names: ["edric"],
        name: "Edric",
        faction: "guild",
        title: "Guild Navigator",
        line: "He sees a safe path through folded space, in a tank of orange gas.",
        special: "tank",
    },
    {
        names: ["feyd", "feyd-rautha", "feyd rautha"],
        name: "Feyd-Rautha",
        faction: "harkonnen",
        title: "na-Baron",
        line: "Graceful, cruel, and very sure of himself.",
        special: "sword",
    },
    {
        names: ["baron", "vladimir", "vladimir harkonnen", "baron harkonnen"],
        name: "Baron Harkonnen",
        faction: "harkonnen",
        title: "Siridar-Baron",
        line: "Plans within plans within plans.",
    },
    {
        names: ["rabban", "glossu rabban", "beast"],
        name: "Rabban",
        faction: "harkonnen",
        title: "The Beast",
        line: "He squeezes. That is the whole plan.",
    },
    {
        names: ["piter", "piter de vries"],
        name: "Piter de Vries",
        faction: "harkonnen",
        title: "Twisted Mentat",
        line: "Brilliant, and he knows it.",
        special: "mentat",
    },
    {
        names: ["shaddam", "shaddam iv", "padishah emperor"],
        name: "Shaddam IV",
        faction: "corrino",
        title: "Padishah Emperor",
        line: "The throne is comfortable. Change is not.",
        special: "crown",
    },
    {
        names: ["fenring", "count fenring", "hasimir fenring"],
        name: "Count Fenring",
        faction: "corrino",
        title: "Genetic Dead-End",
        line: "Hmm-ah. A killer who hums.",
    },
    {
        names: ["farad'n", "faradn"],
        name: "Farad'n",
        faction: "corrino",
        title: "Prince",
        line: "A scholar who learned what the throne costs.",
    },
    {
        names: ["jamis"],
        name: "Jamis",
        faction: "fremen",
        title: "Fedaykin",
        line: "His water belongs to the tribe now.",
    },
    {
        names: ["harah"],
        name: "Harah",
        faction: "fremen",
        title: "Keeper of the Sietch",
        line: "Wise in the ways of the warren.",
    },
    {
        names: ["korba"],
        name: "Korba",
        faction: "fremen",
        title: "Fedaykin Commander",
        line: "Loud in the faith, quiet in the plot.",
    },
    {
        names: ["otheym"],
        name: "Otheym",
        faction: "fremen",
        title: "Fedaykin",
        line: "He remembers the old days, and their names.",
    },
    {
        names: ["tuek", "esmar tuek", "staban tuek"],
        name: "Tuek",
        faction: "ix",
        title: "Smuggler",
        line: "Trade finds a way, even across the deep desert.",
    },
    {
        names: ["yueh", "wellington yueh", "dr. yueh"],
        name: "Dr. Yueh",
        faction: "atreides",
        title: "Suk Doctor",
        line: "Conditioned, and yet.",
    },
    {
        names: ["rhombur", "rhombur vernius"],
        name: "Rhombur",
        faction: "ix",
        title: "Prince of Ix",
        line: "Half machine, all heart.",
    },
];

/** Every name a title might use, to its character. */
const BY_NAME = new Map();

for (const each of ROSTER) {
    for (const name of each.names) {
        BY_NAME.set(name, each);
    }
}

/** Names for an agent whose title names no one: minor Fremen of the deep desert. */
const FREMEN = [
    "Shishakli",
    "Farok",
    "Turok",
    "Ramallo",
    "Geurney",
    "Tharthar",
    "Shoab",
    "Mapes",
    "Kaleff",
    "Orlop",
    "Muriz",
    "Javid",
    "Shadout",
    "Hoh",
    "Aliet",
    "Usgar",
    "Ziarenko",
    "Abumojandis",
    "Nafla",
    "Rashid",
    "Lalla",
    "Ishim",
    "Tabr",
    "Sihaya",
];

/** Words an agent is called by its kind, when its faction has none. */
export const KIND_WORD = { session: "Naib", subagent: "Fedaykin", linked: "Envoy" };

/** A whole number from text, the same every time. */
export function hash(text) {
    let value = 2166136261;

    for (let index = 0; index < text.length; index++) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 16777619);
    }

    return value >>> 0;
}

/** A colour from text: a hue on the desert's side of the wheel, or any hue with `wide`. */
export function hue(text, wide = false) {
    const h = hash(text);
    const angle = wide ? h % 360 : (h % 80) + 10;

    return `hsl(${angle} ${55 + (h % 25)}% ${48 + ((h >> 8) % 12)}%)`;
}

/** The name a session's title gives its agent: the words before a colon, when they look like a name. */
export function titleName(title) {
    if (typeof title !== "string") {
        return undefined;
    }

    const match = /^\s*([A-Za-z][A-Za-z.' -]{1,30}?)\s*:/.exec(title);

    if (!match) {
        return undefined;
    }

    const words = match[1].trim().split(/\s+/);

    return words.length <= 3 ? match[1].trim() : undefined;
}

/** A character from the books for a name, when there is one: by the whole name, then by each word of it. */
export function lookup(name) {
    if (typeof name !== "string" || name.trim() === "") {
        return undefined;
    }

    const clean = name
        .toLowerCase()
        .replace(/[^a-z' .-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (BY_NAME.has(clean)) {
        return BY_NAME.get(clean);
    }

    for (const word of clean.split(/[ .-]+/)) {
        if (word.length >= 3 && BY_NAME.has(word)) {
            return BY_NAME.get(word);
        }
    }

    return undefined;
}

/**
 * Who a conversation is: its name, faction, title, robes, and gift. A known name from its title, its subagent name,
 * or its first words; else a Fremen named from its id, so the same session keeps the same face.
 */
export function castOf(conv) {
    const kind = conv?.kind ?? "session";
    const fromTitle = titleName(conv?.title);
    // Who the team extension says it is comes first: it knows even when the title does not say.
    const candidates = [conv?.persona, fromTitle, conv?.name, conv?.title];
    let known;

    for (const each of candidates) {
        known = lookup(each);

        if (known) {
            break;
        }
    }

    const seed = String(conv?.id ?? "?");

    if (known) {
        const faction = FACTIONS[known.faction];

        return {
            known: true,
            name: known.name,
            title: known.title,
            line: known.line,
            special: known.special,
            factionKey: known.faction,
            faction,
            robe: faction.robe,
            trim: faction.trim,
            skin: faction.skin,
            accent: faction.trim,
        };
    }

    const name =
        (kind === "subagent" && conv?.name) ||
        conv?.persona ||
        fromTitle ||
        FREMEN[hash(seed) % FREMEN.length];
    // A stranger: a Fremen in a cloak dyed from their name.
    const faction = FACTIONS.fremen;
    const robe = `hsl(${(hash(name) % 40) + 18} ${30 + (hash(name) % 20)}% ${26 + (hash(seed) % 12)}%)`;

    return {
        known: false,
        name: String(name).slice(0, 28),
        title: KIND_WORD[kind] ?? "Fremen",
        line:
            kind === "subagent"
                ? "Sworn to the work it was given, until it is done."
                : "One of the desert's own. The sand remembers every step.",
        special: undefined,
        factionKey: "fremen",
        faction,
        robe,
        trim: hue(name, true),
        skin: faction.skin,
        accent: hue(name, true),
    };
}

/** What a home is called, for an agent of this faction and kind. */
export function homeWord(cast, kind) {
    if (kind === "subagent") {
        return "Stilltent";
    }

    return cast.faction?.home ?? "Sietch";
}

/** What a helper of this agent is called. */
export function helperWord(cast) {
    return cast.faction?.helper ?? "Fedaykin";
}

/** Sayings for the splash and the idle desert: in the manner of the books, not from them. */
export const SAYINGS = [
    "The spice must flow.",
    "A task begun in the cool of the morning is half done by the heat of noon.",
    "Walk without rhythm, and the worm will not come.",
    "Every tool call is a footprint. The sand keeps them all, for a while.",
    "The sleeper must awaken.",
    "Water is precious. So are tokens.",
    "A Mentat never guesses. A Mentat computes, then guesses.",
    "Plans within plans within plans.",
    "When the storm is high, read the error twice.",
    "The Fremen say: test before you trust.",
    "He who controls the spice controls the context window.",
    "The mystery of a codebase is not a problem to solve, but a reality to experience.",
];
