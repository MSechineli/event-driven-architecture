# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

This workspace runs inside a dev container (Node.js 20) with Claude Code pre-installed. The container enforces strict network isolation via `iptables`/`ipset` — only the following outbound destinations are permitted:

- GitHub (all IP ranges from `api.github.com/meta`)
- NPM registry (`registry.npmjs.org`)
- Anthropic API (`api.anthropic.com`, `statsig.anthropic.com`, `statsig.com`)
- Sentry (`sentry.io`)
- VS Code services (`marketplace.visualstudio.com`, etc.)
- DNS (port 53), SSH (port 22), localhost

Attempts to reach other domains (e.g., `example.com`) will be blocked. The firewall is re-applied on each container start via `.devcontainer/init-firewall.sh`.

## Dev Container

The container configuration lives in `.devcontainer/`:

- **`devcontainer.json`** — VS Code extension setup, volume mounts, environment variables, and post-start hook
- **`Dockerfile`** — installs dev tools (zsh, fzf, gh CLI, git-delta, jq, vim) and Claude Code globally
- **`init-firewall.sh`** — network isolation script run at container start

Key environment variables set in the container:

- `NODE_OPTIONS=--max-old-space-size=4096`
- `CLAUDE_CONFIG_DIR=/home/node/.claude`

## Project

EDA Studies — a test-first educational repository covering Event Sourcing, CQRS, Message Broker, Saga, and Outbox patterns. See `README.md` for the full overview.

### Stack

- Node.js 20 + TypeScript (strict), Jest + ts-jest
- All implementations are in-memory — no Docker or external services needed

### Running tests

```bash
npm test                        # all tests
npm run test:01                 # pattern 01 only (same for 02–05)
npx jest tests/01-event-sourcing/01-basics.test.ts  # single file
```

### Key conventions

- Each `describe` block creates fresh `EventBus` and `EventStore` instances in `beforeEach` — never shared at module scope.
- `EventBus.publish()` is synchronous (used by CQRS projections); `publishAsync()` returns `Promise.all` (used by broker/outbox tests).
- Saga compensation runs in LIFO order — tests in `04-saga/02-compensation.test.ts` verify the exact sequence.
- `tests/05-outbox/03-dual-write-problem.test.ts` is an intentional counter-example documenting the bug, not the solution.
