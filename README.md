# atelier-bench-corpus

[![corpus](https://github.com/skylence-org/atelier-bench-corpus/actions/workflows/corpus.yml/badge.svg?branch=main)](https://github.com/skylence-org/atelier-bench-corpus/actions/workflows/corpus.yml)

Purpose-built **accuracy-bench corpora** for agent/tool evaluation over real application graphs.
One directory per language lane; each lane is self-contained and carries its own ground truth.

## Lanes

| Lane | Stack | Domain | Ground truth | Self-check |
| --- | --- | --- | --- | --- |
| `php/` | PHP 8.3+ · Laravel 13.20 · Filament 5.6 | repair atelier | `php/bench/tasks.json` | `php bench/verify_tasks.php` |
| `rust/` | Rust 2024 edition · cargo workspace | repair atelier (same domain) | `rust/bench/tasks.json` | `cargo run -p bench-verify` |
| `typescript/` | Node 22 · TypeScript 5.7 · npm workspaces · express 5, plus route fixtures for NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt (nitropack) and Expo (convention-only) | repair atelier (same domain) | `typescript/bench/tasks.json` | `npm run verify` |
| `javascript/` | Node 22 · mixed CJS/ESM · npm workspaces · JSDoc-only typing | repair atelier (same domain) | `javascript/bench/tasks.json` | `npm run verify` |
| `python/` | Python 3.12+ · Flask 3.1 · three packages, no build step · type hints + mypy allowlist gate | repair atelier (same domain) | `python/bench/tasks.json` | `python3 bench/verify_tasks.py` |
| `go/` | Go 1.23 · one module, stdlib only · `net/http` · embedding, generics, build tags | repair atelier (same domain) | `go/bench/tasks.json` | `go run ./bench/verify` |

All lanes model the **same** domain (customers, devices, repair orders, parts, technicians) so a
harness can compare tool accuracy across languages on structurally equivalent questions.

## Shared contract

Every lane ships the same three artifacts:

| Artifact | Role |
| --- | --- |
| `<lane>/bench/tasks.json` | Needle-based accuracy tasks (`from` → `expect` file/needle pairs), schema `version: 1` |
| `<lane>/bench/` verifier | Zero-third-party-dependency self-check: every needle must resolve to exactly **one** line |
| `<lane>/README.md` | Coverage map: which language/framework edge lives in which file |

Needles are strings, never line numbers, so the manifest survives edits. Any change under a lane's
task-target paths must leave that lane's verifier at **exit 0**, in the same commit.

Task `file` paths inside a lane's `tasks.json` are relative to that **lane root** (`php/`, `rust/`, `typescript/`, `javascript/`, `python/`, `go/`),
not to the repository root.

## Consumption (runner)

Consumers pin this tree via `corpora.lock.json`:

```json
{ "type": "git", "sha": "<commit>" }
```

1. Check out the pinned SHA.
2. Install per lane from the **committed** lockfile — `composer install` in `php/`, `cargo build --locked` in `rust/`, `npm ci` in `typescript/` and `javascript/`, `pip install -r requirements-dev.txt` in `python/`. `go/` needs no install step: its single dependency is an in-tree `replace`. No unlock, no update.
3. No remote artifacts, no SSH private remotes, no vault/secrets required for install or seed.

## Corpus-wide check

```
node bench/check-matrix.mjs
```

One command answers "is the whole corpus green at this SHA?": it runs every lane's verifier,
cross-checks every task id against `bench/matrix.json`'s canonical map so a task cannot vanish
from a lane without check-matrix failing, and diffs every lane verifier's output against
`bench/conformance/expected.txt` byte for byte so the three independent verifier implementations
(php, rust, node) are proven to agree on every branch of the verifier contract, not just on
"exit 0". `bench/matrix.json` is generated, never hand-edited: run
`node bench/check-matrix.mjs --write` to regenerate it after adding or renaming a task id, then
review the diff like code. `node bench/check-matrix.mjs --write --matrix-only` writes the same file
from the lanes' `tasks.json` after the static checks alone, without running any lane verifier or
the conformance diff, so nothing compiles (the rust verifier is `cargo run`); it does not replace
the default check, which is the full run. Any other argument is refused. CI runs the default
(read-only) mode. Before any verifier runs it also checks, from files alone, that
`bench/conformance/src/crlf.txt` still ends every line in CRLF and that git still keeps it out of
line-ending normalisation (`-text`), that every task id (in each lane and in `bench/conformance/`)
is lower-case kebab-case and unique there, that every hover task states a `contains` string,
present in its lane's source and the same in every lane sharing the hover id, and that a list task
stating a count lists exactly that many implementations; a cardinality or multi-parent id shared
by several lanes must state the same `exact_count` in every lane that carries it; and
[`bench/TOOL-SURFACE.md`](bench/TOOL-SURFACE.md), the tool surface checklist section E is graded
against, may name only task ids and README text its lanes have, so a lane that renames or retires
such an id updates its row there.

## Scoring a tool

```
node bench/score/score.mjs --lane go --answers go.answers.json
```

`bench/score/` compares one tool's answers for one lane with that lane's `bench/tasks.json` and
reports a verdict per task. It is tool-agnostic: an adapter writes the tool's replies in the answer
format, and the scorer only reads that file and the answer key. The format, the verdicts and the
rules this version scores are in [`bench/score/README.md`](bench/score/README.md). The scorer's own
checks run in the `score` workflow, which is separate from the corpus checks above.

## Negative cases

Each lane carries a `fixtures/broken-syntax/` directory of intentionally invalid source.
**Do not fix it** — those files are parser/indexer negative cases and are excluded from builds and linting.

## License

MIT. Corpus content is clean-room for bench use.
