# Tool surface (checklist section E)

Section E of [`S-PLUS-CHECKLIST.md`](S-PLUS-CHECKLIST.md) asks each lane to score what the tools
under test implement for its language. This file is the list it is graded against, decided in the
wave-3 rulings of issue #223
([R1 to R9](https://github.com/Skybox-Code-Repository-Knowledge-Graph/atelier-bench-corpus/issues/223#issuecomment-7202099270)).
It is a capability list only: no tool's answer to any task was read to build it, and none may be
read to fill it.

`node bench/check-matrix.mjs` (and `--write --matrix-only`) reads this file: every task id in a
"Scored by" cell must exist in that lane's `bench/tasks.json`, every quote must be text of that
lane's README, the quoted list below and each lane's rows must equal the list `check-matrix.mjs`
pins for the version (`SKYBOX_EXTRACTORS`), and the pinned version must equal the one
`score-tools.yml` installs. A lane that renames or retires a task id named here updates its row in
the same pull request. Each lane edits only its own section, so the lanes' pull requests do not
conflict here.

## Scope (ruling R1)

The tool under test for section E is skybox, the npm package `@skylence-ai/skybox`, at the version
`.github/workflows/score-tools.yml` installs by default
(`SKYBOX_VERSION: ${{ inputs.skybox_version || '0.9.0' }}`):

Pinned version: `0.9.0`

The codebase-memory-mcp adapter stays in the repository, but its parser list does not drive section
E. Section E is therefore ticked under ruling R1, not literally.

## Framework extractors (ruling R2)

Source, run on 2026-11-26:

```
npm view @skylence-ai/skybox@0.9.0 readme
```

Section "Supported languages", column "Framework extractors", the six rows for the languages this
corpus has a lane in, quoted as printed:

| Language | Framework extractors |
| --- | --- |
| Rust | Axum routes, Reqwest HTTP |
| PHP | Laravel routes, Eloquent, Guzzle, Inertia (PHP side), Blade |
| TypeScript | Express, NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt, Expo |
| JavaScript | Express, NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt, Expo |
| Python | FastAPI, Flask, Django, SQLAlchemy, Pydantic |
| Go | net/http, gorilla/mux, chi, gin, echo, fiber, resty |

The command's output matches the ruling's table row for row. The same printed table has rows for
Vue SFC, Svelte SFC (whose only extractor is "SvelteKit routes"), Astro SFC, Java, C#, Kotlin, Ruby
and Dart; no lane is written in those languages, so they are outside section E.

## Classes (ruling R3)

The repository's reading of ruling R3: the column read literally, then one step stricter.

| Class | Extractors | What it obliges the lane to carry |
| --- | --- | --- |
| Route parser (E.1) | Rust: Axum routes. PHP: Laravel routes. TypeScript and JavaScript: Express, NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt, Expo. Python: FastAPI, Flask, Django. Go: net/http, gorilla/mux, chi, gin, echo, fiber | A route task for EVERY route parser listed for the language: `def-route-to-handler` on the lane's main framework, plus one route task per further parser (lane-local, or for javascript and typescript the two-lane `def-route-*` id of ruling R12), on a real, loadable, tested route file written in that framework's own convention. The key is which handler the tree says serves the route, never what a tool returns. A route parser cannot be a deliberate gap |
| ORM, schema or serialization (E.2) | PHP: Eloquent. Python: SQLAlchemy, Pydantic | At least one task scores it, or the lane README names its absence as a deliberate gap |
| Other | Rust: Reqwest HTTP. PHP: Guzzle, Inertia (PHP side), Blade. Go: resty | E.2's wording does not cover these; ruling R3 does, with E.2's obligation: at least one task scores it, or the lane README names it as a deliberate gap |

## What counts as scoring an extractor (ruling R16)

A task scores an extractor when its `from` or `expect` sits on the construct that extractor reads,
on a surface that asks about that construct. A broken-fixture `parse-negative` task does not score
an extractor.

## Per-lane coverage

First filled at main `7e67f55` (this file's base snapshot) from each lane's `bench/tasks.json` and
README only (no tool output, adapter notes, grades or score reports were read). Each lane keeps
its own section current from then on.

Each lane has one section with one row per extractor of its language, in the order quoted above.
Exactly one of the last three cells is filled: "Scored by" holds backticked task ids separated by
commas; "Deliberate gap" holds text of the lane README, quoted in double quotes (a `|` written
`\|`), of five words or more, that names the extractor; "Not yet" holds `not yet`. The section
ends with the lane's language-server line (E.5, below).

### rust

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| Axum routes | route parser | `def-route-to-handler`, `def-async-handler` | | |
| Reqwest HTTP | other | | | not yet |

Language server (E.5): not pinned yet

### php

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| Laravel routes | route parser | `def-route-to-handler`, `def-named-route-api`, `resolution-route-model-binding`, `def-middleware-alias`, `lw-fullpage-route` | | |
| Eloquent | ORM, schema or serialization | `rel-hasonethrough`, `rel-hasmanythrough`, `rel-ofmany-builder`, `rel-morphedbymany`, `def-relation-name`, `def-relation-property`, `def-query-scope`, `def-accessor-attribute`, `def-enum-method`, `lane-local-money`, `refs-money-class` | | |
| Guzzle | other | | "Deliberate gap: the lane's own code makes no outgoing HTTP call (no `Http::` client and no Guzzle client anywhere" | |
| Inertia (PHP side) | other | | "Deliberate gap: Inertia (PHP side) goes unscored because Inertia is not installed" | |
| Blade | other | `def-blade-model-method`, `def-livewire-computed`, `def-accessor-attribute`, `def-view-name`, `def-blade-component-tag`, `def-anonymous-component`, `lw-sfc-computed`, `lw-wireclick-method`, `lw-form-object-magic`, `lw-embed-tag`, `int-folio-filename-binding`, `int-volt-functional-prop` | | |

Language server (E.5): phpactor 2026.11.22.0; source "Pinned: **phpactor 2026.11.22.0**, the release phar"

### typescript

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| Express | route parser | `def-route-to-handler` | | |
| NestJS | route parser | | | not yet |
| Hono | route parser | | | not yet |
| Fastify | route parser | | | not yet |
| Remix | route parser | | | not yet |
| SvelteKit | route parser | | | not yet |
| Nuxt | route parser | | | not yet |
| Expo | route parser | | | not yet |

Language server (E.5): not pinned yet

`typescript/README.md` asks that a second-opinion server run against the root `tsconfig.json`, but
names no server or version.

### javascript

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| Express | route parser | `def-route-to-handler` | | |
| NestJS | route parser | | | not yet |
| Hono | route parser | | | not yet |
| Fastify | route parser | | | not yet |
| Remix | route parser | | | not yet |
| SvelteKit | route parser | | | not yet |
| Nuxt | route parser | | | not yet |
| Expo | route parser | | | not yet |

`javascript/README.md` already has a row "ORM / schema / serialization" that reads "none,
deliberately"; no JavaScript extractor in the quoted list is in that class, so it fills no row.

Language server (E.5): the TypeScript language service of `typescript` 5.7.3, through `typescript-language-server` 6.1.0; source "the TypeScript language service of the pinned `typescript` 5.7.3 (graded through `typescript-language-server` 6.1.0)"

### python

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| FastAPI | route parser | | | not yet |
| Flask | route parser | `def-route-to-handler` | | |
| Django | route parser | | | not yet |
| SQLAlchemy | ORM, schema or serialization | | | not yet |
| Pydantic | ORM, schema or serialization | | | not yet |

Language server (E.5): not pinned yet

### go

| Extractor | Class | Scored by (task ids) | Deliberate gap (README line) | Not yet |
| --- | --- | --- | --- | --- |
| net/http | route parser | `def-route-to-handler`, `def-route-default-mux`, `def-closure-handler` | | |
| gorilla/mux | route parser | | | not yet |
| chi | route parser | | | not yet |
| gin | route parser | | | not yet |
| echo | route parser | | | not yet |
| fiber | route parser | | | not yet |
| resty | other | | | not yet |

Language server (E.5): not pinned yet

## Language servers (E.5)

E.5 scores the language-server surfaces (`hover`, `document_symbol`, `call_hierarchy`,
`implementation`) against the server the lane's stack starts. Ruling R5: each lane README pins that
server with its version. Each lane section above ends with one line,
`Language server (E.5): ...`. It names a server and its version only where the lane README already
pins one, followed by `; source "<the README text that pins it>"`: five words or more of that
README, carrying every version the line names. Otherwise it reads `not pinned yet`.
