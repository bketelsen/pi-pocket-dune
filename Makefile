# The gate (frostyard/core ADR-0044): make verify, make check and make ci.
# npm run check and npm test use Pi Pocket's packages: node_modules is a link to a Pi Pocket checkout's
# (README.md, "Develop"). Node is pinned in mise.toml and mise.lock.
NODE_MAJOR := $(shell node -p "process.versions.node.split('.')[0]" 2>/dev/null)

.PHONY: verify verify-template check ci

## verify-template: the template gate: agent surfaces, docs index, risk paths, corrections, vendored copies, and its tests
verify-template:
	@if ! command -v node >/dev/null 2>&1; then echo "FAIL: make verify requires Node.js 22 or later (run: mise install)"; exit 1; fi
	@if [ "$(NODE_MAJOR)" = "" ] || [ "$(NODE_MAJOR)" -lt 22 ]; then echo "FAIL: make verify requires Node.js 22 or later (found: $$(node --version 2>/dev/null || echo missing)); run: mise install"; exit 1; fi
	node scripts/check-template.mjs
	node --test test/*.test.mjs

## verify: the non-mutating gate: the template gate, then the type and syntax check, the tests and the format check
verify: verify-template
	npm run check
	npm test
	npm run format:check

## check: the developer gate: the same as verify (the repository has no format command)
check: verify

## ci: the gate CI runs: verify, then, with BASE set, the check of .memory/corrections/ against the base
ci: verify
	@if [ -n "$(BASE)" ]; then node scripts/check-corrections.mjs --base "$(BASE)"; fi
