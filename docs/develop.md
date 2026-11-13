# Develop Arrakis

How to set up a checkout, run each check, and preview the page. The rules for a change are in
[AGENTS.md](../AGENTS.md).

## Set up

The checks use Pi Pocket's packages: `node_modules` is a link to a Pi Pocket checkout's. Put a Pi Pocket checkout
beside this folder, install its dependencies there (`npm ci`), then link them and install the pinned Node:

```sh
ln -s ../pi-pocket/node_modules node_modules
mise install     # Node, pinned in mise.toml and mise.lock (run mise trust once in a new checkout)
```

## Checks

```sh
make verify                # the template gate and its tests, npm run check, npm test, npm run format:check
make ci BASE=origin/main   # verify, then the check of the records in .memory/corrections/ against the base
```

- `npm run check`: TypeScript (`tsc --noEmit`), and `node --check` of each `dune/*.js`.
- `npm test`: the server module, the cast, and the model (`test/*.test.ts`).
- `npm run format:check`: Prettier on `dune.ts`, `dune/*.js`, `dune/style.css`, `test/*.ts`, `README.md` and
  `package.json`.
- `node scripts/check-template.mjs`: the agent surfaces, the docs index, the risk paths, the corrections and the
  vendored copies.

## Preview

```sh
npm run preview   # then open http://127.0.0.1:8765/dev/preview.html
```

The page runs on its demo, with no server (`dev/pocket-shim.js` stands in for Pi Pocket).

## CI

The job `Check` in `.github/workflows/ci.yml` clones the fork bketelsen/pi-pocket at tag `v0.28.1-bk.1` (the server's
release), checks that the clone is the tag's pinned commit, runs `npm ci` there, links its
`node_modules`, and runs `make ci` with the PR base.
