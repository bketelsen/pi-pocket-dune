# Arrakis: a Dune desert of agents for Pi Pocket

Every agent at work, as Arrakis. Sessions are sietches carved into the rocks, subagents are fedaykin in stilltents
beside them, and linked sessions are allied sietches out on the trails. Each tool call is a walk across the dunes
to a place (the Archives, the Ixian Foundry, the Guild Heighliner Port), model providers are spice fields that
stream melange to an agent while it thinks, messages fly by ornithopter, and every task raises a work of its own
beside its agent's sietch. Sandworms pass. A Coriolis storm rises when the calls keep failing. A day lasts 8 minutes,
and at night the cave mouths glow and the Fremen's eyes shine blue.

![The demo desert: Odrade's order at work around the Arrakeen Citadel, with the Chronicle beside it](docs/desert.webp)

Name your agents after the people of the books, and they arrive as themselves. A session titled
`Duncan Idaho: pilothouse CI fixes` is a swordmaster of House Atreides with a blade at his side; `Odrade: …` is
Mother Superior of the Bene Gesserit, in black with a crown of office; `Sheeana: …` is the worm-rider, carrying her
maker hook, and leaves rings in the sand where she walks. Any other name becomes a Fremen of the deep desert, with a
cloak dyed from their name.

<table>
<tr>
<td width="50%"><img src="docs/sietch.webp" alt="Duncan Idaho's sietch, with the works his tasks raised and a fedaykin's stilltent" /><br /><sub>Duncan's sietch: each task a work, his fedaykin in a stilltent</sub></td>
<td width="50%"><img src="docs/dossier.webp" alt="Odrade's dossier: Mother Superior of the Bene Gesserit" /><br /><sub>A dossier: Odrade, Mother Superior</sub></td>
</tr>
<tr>
<td><img src="docs/shai-hulud.webp" alt="Shai-Hulud rises beside the Arrakeen Citadel" /><br /><sub>Shai-Hulud rises to honour a great work</sub></td>
<td><img src="docs/night.webp" alt="The desert at night: glowing cave mouths and moonlight" /><br /><sub>Night of two moons</sub></td>
</tr>
</table>

It is inspired by, and its server half forked from,
[Agent Civilization](https://github.com/TannerMidd/pi-pocket-agent-civilization) by Tanner Middleton (MIT). The
desert, its engine, the cast, and the demo are new.

It needs **Pi Pocket 0.19.0** or later (extension API **2**). It needs no network, no outside service, no model calls
of its own, and no setting.

## Install

Copy these into the `extensions/` folder of Pi Pocket's data folder (by default `~/.pi-pocket/extensions/`), then
turn it on in Menu → Extensions:

```text
extensions/
  dune.ts
  dune/
    index.js  world.js  model.js  cast.js  places.js  demo.js  sound.js  style.css
```

Do not copy `test/`, `dev/`, `docs/`, `package.json`, or `_pocket.d.ts`.

## Use

Open **Arrakis** in the rail (or "Open Arrakis" in the launcher, Ctrl+K / ⌘K). With no agents seen yet, it opens on
the **Demo**: Odrade's order at work (Teg on the fleet, Duncan on CI, Moneo on the NAS, and the rest), which gives way
as soon as a real agent appears. Press **Demo** to see it again at any time.

- **Only the last 12 hours:** the desert shows the sessions with activity in the last 12 hours, and the sessions they
  came from. A session that goes quiet leaves the map; it comes back when it works again.
- **This sietch / All Arrakis:** the session you came from with its family, or every session you can see.
- **See all:** the whole desert in view. Drag to pan; scroll or pinch to zoom.
- **Tap anyone** for their dossier: their title, faction, and a line of their own; what they do now; their spice
  field (model), thinking level, tool calls, melange (tokens), Solaris (spend), and stumbles (errors); their tools,
  the works they raised, their fedaykin and allies, and the scrolls (files) they touched.
- **Tap a place** for who comes there and what they sought. **Tap a work** for its story: what was asked and by whom,
  who built it, how long it took, its parts, and each call that built it.
- **Replay:** the day again as a time-lapse. **Night:** the last night again, from 20:00 to 07:00, in about 3
  minutes and under the two moons, from the 24-hour history (before 07:00, the night so far). **☾☀:** follow the
  day, or keep it day or night. **♪:** the sound of the desert (a drone and the wind, made in the browser).
  **Chronicle:** the log. **Glossary:** the manual.

### What you see

| On Arrakis                               | In Pi Pocket                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| A sietch in the rocks                    | A session; its banner is its faction, the words under it its task                 |
| An allied sietch on a trail              | A linked session (team delegations), on the road from the session that started it |
| A stilltent                              | A subagent, by its parent's sietch                                                |
| The Arrakeen Citadel                     | The people who write to the agents, and the Desk                                  |
| Spice Fields (one for each provider)     | Model requests: a halo of melange while an agent thinks, spice back as tokens     |
| Archives of Chapterhouse                 | `read`, `write`, `edit`                                                           |
| Ixian Foundry                            | Shell commands                                                                    |
| Guild Heighliner Port                    | `git`, `gh`, PR watches; a `git push` launches a heighliner that folds space      |
| Seer's Spire                             | The browser, and tools with "search", "fetch", or "web" in their names            |
| Axlotl Tanks                             | Codemode scripts                                                                  |
| Vault of Other Memory                    | The memory tool, and `team_memory`                                                |
| Mural Cave                               | Artifacts                                                                         |
| Moon Dial                                | Scheduled messages, and night shifts                                              |
| Embassy of House … (one for each server) | MCP calls, under that server's banner                                             |
| Landsraad Hall                           | Any other tool, from extensions                                                   |
| An ornithopter                           | A message, a delegated task, or a report                                          |
| A drop of water / a broken blade         | A tool call that worked / failed                                                  |
| A Coriolis storm                         | 3 or more failed tool calls in the last 45 seconds, and most calls failing        |
| Shai-Hulud                               | Passes now and then; rises from the sand to honour a work of 8 calls or more      |

### Every task is a work

A message to an agent (from a person, a delegation, a schedule, or a night shift) opens a site beside its sietch.
Each tool call that finishes adds a part, and a brick flies to the site from the place where the call ran; a
subagent's calls build its parent's site. When the agent answers, the scaffolding comes down and the work takes the
style of what weighed most: a **Library Spire** (reading), **Windtrap** (edits), **Ixian Engine** (commands),
**Watchtower** (the web), **Guild Beacon** (git), **Council Tent** (helpers), **Caravanserai** (MCP), **Mural Arch**
(artifacts), **Memory Shrine** (memory), or a **Palace** (a bit of everything). A task where most calls failed is a
**Buried Ruin**. A message answered with no tool call builds nothing. Each sietch keeps its newest 6 works.

### The cast

The cast (`dune/cast.js`) knows the people of all six books, with their faction and a title: the order of
Chapterhouse (Odrade, Bellonda, Tamalane, Lucilla, Sheeana, Murbella, Miles Teg, Duncan Idaho, and the Clerk), and
Paul, Chani, Stilgar, Jessica, Alia, Leto II, Gurney, Thufir, Moneo, Irulan, the Harkonnens, the Corrinos, the Guild,
the Tleilaxu, Ix, and more. A name is found in the words before a colon in a session's title, in a subagent's name,
or in the title itself. Each faction dresses its own: Bene Gesserit black, Fremen stillsuits with nose tubes and blue
eyes, Atreides green, Harkonnen black and bald, Corrino gold crowns, Guild orange. Gifts show too: a mentat's red
lips, a swordmaster's blade, a navigator's tank of orange gas.

## What it reads, keeps, and sends

The same as Agent Civilization, whose server half this is:

- **Reads**, through its hooks, every tool call and model request in **every** session: the tool's name and its
  arguments, the model, token counts and cost, the start of each message and answer, the end of the model's
  reasoning, and the text of failed tool calls and model errors, all cut short. It reads no files, settings, sign-ins,
  or environment variables, and no session documents.
- **Masks** what looks like a secret before it keeps any text: API keys and tokens, `NAME=value` settings whose name
  says key, token, secret, or password, and private keys. Masking is a best effort.
- **Shows** what it reads only to the owner (its routes and page are owner-only), and only for sessions that Pi Pocket
  confirms the owner may see (through its `conversationRoute`), or subagents that such a session's own tool call
  started.
- **Keeps** the last 3000 events and some counts in memory, and saves the last 1500 every few seconds to
  `<data folder>/dune/world.json` (file mode 0600). It also keeps a compact history of the last 24 hours, for the
  Night replay: only the tool calls and their results, messages, links, and the ends of turns, with labels cut to 60
  characters and messages to 80, no error text, no thoughts, and no answers. It keeps at most 40,000 such events, and
  saves them once a minute to `<data folder>/dune/history.json` (file mode 0600, 4 MB at most: the oldest go first).
  For a session not yet confirmed, both files keep no words, paths, titles, or names. **Glossary → Forget all
  history** clears it all. After you uninstall it, delete the `dune` folder in the data folder too.
- **Sends** nothing over the network: only the town, to the owner's open Pi Pocket tabs (`web.send`). In the browser
  it keeps a few view choices in `localStorage`, under `x.dune.*`.
- **Changes** nothing: each hook only records, catches its own errors, returns `undefined`, and never waits.

### What can change under it

It reads some shapes that are internal to Pi Pocket or to other extensions, and that can change in any release: the
arguments and results of the built-in tools, the markers Pi Pocket puts on messages (`[from: …]`, `[subagent …]`,
`[scheduled]`, `[via PR watch]`, the linked-session wrapper), and the team extension's tools (`team_delegate`,
`team_message`, its "Task from the source session:" preamble) and markers (`[night-shift]`, `[desk]`). If one
changes, the desert fails soft: it loses a link, a label, or a work, never a call.

## How it is built

- `dune.ts`: the server module. Hooks `beforeTool`, `afterTool`, `beforeRequest`, `afterResponse`, and `onYield`
  turn what they see into small events (`tool`, `done`, `think`, `reply`, `msg`, `link`, `idle`) and running counts.
  Routes: `GET world` (the sessions active in the last 12 hours), `GET history?from=&to=` (the compact history in a
  window, for the Night replay), `GET meta/:source` (a `conversationRoute`), and `POST reset`.
- `dune/index.js`: the page (Preact and htm from Pi Pocket): status bar, Chronicle, dossiers, glossary, and splash.
- `dune/world.js`: the engine. It lays the desert out, paints the dunes once from a height field, walks the agents,
  flies the ornithopters, raises the works, and draws day, night, worms, and storms on a canvas.
- `dune/model.js`: what the events mean, with no drawing: tasks and their works, and the Chronicle.
- `dune/cast.js` and `dune/places.js`: who is who, and what each place is called.
- `dune/demo.js`: Odrade's order at work, in the server's event format.
- `dune/sound.js`: a drone, the wind, and effects, made with Web Audio; no sound files. Off until you turn it on.

## Develop

The checks use Pi Pocket's packages. With a Pi Pocket checkout beside this folder:

```sh
ln -s ../pi-pocket/node_modules node_modules
npm run check    # TypeScript, and a syntax check of the browser module
npm test         # the server module, the cast, and the model
make verify      # all of the above checks, the format check, and the template gate (CI runs make ci)
npm run preview  # then open http://127.0.0.1:8765/dev/preview.html: the page, on its demo, with no server
```

`_pocket.d.ts` is a copy of `types/pocket.d.ts` from Pi Pocket, for types only.

## License

MIT, in [LICENSE](LICENSE). The server module is adapted from Agent Civilization, © Tanner Middleton, under the MIT
License. Dune and its characters belong to the estate of Frank Herbert; this is an unofficial fan work.
