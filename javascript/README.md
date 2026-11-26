# atelier-bench-corpus / javascript lane

Accuracy-bench corpus for agent/tool evaluation over a real JavaScript application graph.
Same repair-atelier domain as the `php/`, `rust/`, `typescript/`, `python/` and `go/` lanes (customers, devices,
repair orders, parts, technicians), with deliberate **JavaScript** edges for
definition/reference/resolution tasks.

This lane is **not** the typescript lane with the types deleted. Its value is the resolution
problem TypeScript hides: no declared types, CommonJS/ESM interop, prototype chains,
`module.exports` shapes, dynamic `require`, string-keyed events, and JSDoc as the only type
surface.

## Stack

| Piece | Pin / constraint |
| --- | --- |
| Node | `>= 22.12` (`require(esm)` must be available: the CommonJS bench package requires the ESM core); `bench/lsp-check.mjs` needs `>= 22.22.2`, the engines range of `typescript-language-server` 6.1.0 |
| Layout | npm workspaces, 4 packages + 1 dependency-free verifier |
| Dependencies | `express@5` (runtime, the main app); `packages/routes` exact-pins one framework per route parser: `hono` 4.13.22, `fastify` 5.12.8, `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` 12.6.3 (+ `reflect-metadata` 0.2.2, `rxjs` 7.8.2), `@remix-run/node` 2.17.5, `@sveltejs/kit` 2.70.4 (+ its peers `vite`, `svelte`, `@sveltejs/vite-plugin-svelte`), `h3` 1.15.11; dev: `supertest`, plus exact-pinned `typescript`, `@types/node`, `@types/express` for the checkJs gate (`typescript`'s parser also drives `bench/tests/specifiers.test.mjs`; no TypeScript sources, no `.d.ts`) and `typescript-language-server` for the E.5 run |
| Test runner | `node --test` (`node:test` + `node:assert/strict`), zero test-runner dependencies |
| Build step | none: everything runs from source with `node` |
| Dataset | `Dataset.seeded()` — fixed rows, **no randomness** in the corpus seed path |
| Language server | the TypeScript language service of the pinned `typescript` 5.7.3, started by the exact-pinned devDependency `typescript-language-server` 6.1.0; its project is `jsconfig.json`, which includes `packages/*/src` only, so tests are outside it. `node bench/lsp-check.mjs` runs it over every hover, document_symbol, call_hierarchy and implementation key and writes `bench/lsp-check.md` (see Language server, below) |
| ORM / schema / serialization | none: the tool surface lists no ORM, schema or serialization integration for JavaScript (`bench/TOOL-SURFACE.md`, ruling R2), and the lane has none, a deliberate gap (see Integrations, below) |

Install from the **committed** `package-lock.json` only (`npm ci`). Do not freestyle `npm update`
on a bench machine if you need bit-stable ground truth.

## Packages

| Package | Module system | Role | Files |
| --- | --- | --- | --- |
| `packages/core` | ESM (`"type": "module"`, `.js`) | Domain: models, prototypes, mixins, container bindings, money, errors, events | 37 |
| `packages/bench` | CommonJS (`.cjs`) | Breadth subsystem: 10 contracts, 8 concerns, 8 bases, 124 implementors | 131 |
| `packages/app` | ESM, imports the CommonJS package | Application surface: express router, console commands, jobs | 12 |
| `packages/routes` | ESM | One route module per JavaScript route parser the tool surface lists, each in its framework's own convention (see Route parsers, below); lane-only | 13 |
| `bench/verify-tasks` | ESM (`.mjs`) | Ground-truth self-check; **zero third-party dependencies** | 1 |
| `bench/tests` | ESM (`.mjs`) | Lane-wide guard tests run by `npm test`: module specifiers, source loading, answer-key needles, the language-server report | 4 |
| `bench/lsp-check.mjs` | ESM (`.mjs`) | Runs the pinned language server over the keys (E.5) | 1 |

## Coverage map

| JS-specific edge | Where |
| --- | --- |
| Mixed module systems | `packages/core` is ESM, `packages/bench` is CommonJS, `packages/app` is ESM importing the CJS package |
| Default-import interop (ESM ← CJS) | `packages/app/src/state.js`: `import bench from "@atelier/bench"`, destructured after the fact |
| `require(esm)` (CJS → ESM) | `packages/bench/src/dataset.cjs`: `require("@atelier/core")` |
| `createRequire` (two sites) | `packages/app/src/commands/exportReport.js`: exporter module picked by format at call time; `packages/app/src/reportsIndex.js` (below) |
| `module.exports = { ... }` object | `packages/bench/src/contracts/reportContract.cjs` |
| `exports.name =` assignments | `packages/bench/src/contracts/metricContract.cjs` |
| `module.exports = class` | all 24 `packages/bench/src/reports/<slug>.cjs` and 24 `packages/bench/src/rules/<key>.cjs` |
| `module.exports = require('./x')` re-export | `packages/bench/src/reportContract.cjs` |
| Prototype-based model | `packages/core/src/models/device.js`: `function Device(...)` + `Device.prototype.label = ...` |
| `Object.create` inheritance + parent `.call` | same file: `Laptop.prototype = Object.create(Device.prototype)`; `Device.call(this, ...)` as the parent constructor, `Device.prototype.label.call(this)` from the override, `Laptop.prototype.label` shadowing the parent, `isWarrantyEligible` inherited (`core/tests/prototype.test.js`) |
| Prototype property installed at run time | `packages/core/src/concerns/hasReference.js`: `withReference` assigns `Target.prototype.referencePrefix`, which no class or mixin declares |
| `Object.assign` source order | `packages/bench/src/support/abstractNotifier.cjs`: the third source restores the class's `validate` over the mixin's |
| `module.exports = class` / `module.exports.X =` | `packages/bench/src/reports/gross-profit.cjs` (bound by `require` in `index.cjs`); `packages/bench/src/rules/index.cjs` (`RuleRegistry`, read in `app/src/seed.js`) |
| require(esm) | `packages/bench/src/dataset.cjs`: `require("@atelier/core")` from CommonJS |
| Module picked by a runtime string | `packages/app/src/commands/exportReport.js`: `EXPORTER_MODULES[format]` through `createRequire`, the class read off `module.exports` by position |
| JSDoc-only declarations and edges | `@callback RecalculateCallback` (`app/src/jobs.js`), `@import { AppState }` (`app/src/commands/exportReport.js`), `@import { Formatter as BillingFormatter }` (`core/tests/shadowPair.test.js`), `@this {SlotBoard}` (`core/src/support/slotBoard.js`), the `AppState` `@typedef` referenced only from comments |
| Route modules, one per route parser | `packages/routes` (see Route parsers) |
| `Object.assign(Target.prototype, mixin)` | `packages/core/src/concerns/hasReference.js` — `reference()` has no declaration in `customer.js` or `repairOrder.js` |
| `Proxy` forwarding | `packages/core/src/concerns/forwardsToSchedule.js`: `technician.nextSlot()` is undeclared on the owner |
| `#private` fields, getters/setters, static blocks | `packages/core/src/money.js` (private field + `get cents`, static block builds `Money.ZERO`), `packages/core/src/support/schedule.js` (private `#booked`, `capacity` getter/setter) |
| `Symbol.iterator` + generator | `packages/bench/src/dataset.cjs`: `for (const order of data)`, plus the `ordersOf` generator |
| `EventEmitter` with string event names | `packages/core/src/events.js`: `dispatcher.on('repair.completed', ...)` — a name-only edge |
| One operation in three styles | `packages/app/src/jobs.js`: `recalculateInventory(cb)`, `recalculateInventoryPromise()`, `recalculateInventoryAsync()` |
| Dynamic registry | `packages/bench/src/index.cjs`: `require(\`./reports/${slug}.cjs\`)`, with the static `REPORTS` array kept alongside |
| JSDoc as the only type surface | everywhere: `@typedef`, `@template` (`core/src/support/pick.js`), `@param`, `@returns`, `@type {import('./x.js').Y}`; `jsconfig.json` sets `checkJs` and `--lint` enforces the allowlist |
| createRequire + dynamic import() | `app/src/reportsIndex.js`: synchronous `require` of the CJS bench package from ESM, and `await import("@atelier/core/reporting")` with a static specifier |
| `this` rebinding | `packages/bench/src/support/abstractNotifier.cjs`: arrow vs function declaration inside one method, `.call`, and `.bind` in `boundSender()` |
| Same-name shadow pair | `packages/core/src/billing/formatter.js` vs `packages/core/src/reporting/formatter.js`; aliased in ESM (`Formatter as MoneyFormatter`, `packages/app/src/state.js`) and in CJS (`const { Formatter: StatusFormatter } = require(...)`, `packages/bench/tests/interop.test.cjs`) |
| Barrel that declares nothing + subpath exports | `packages/core/src/index.js` and the `exports` map in `packages/core/package.json` |
| Sibling pair, one imported | `packages/core/src/support/pair.js` (`Left` / `Right`); `packages/app/src/http/api.js` imports `Left` only |
| Self-referential type | `packages/core/src/support/treeNode.js` (`children`, `parent`) |
| Three parents / one extends + two mixins | `packages/bench/src/contracts/compositeContract.cjs`, `packages/bench/src/support/abstractCompositeReport.cjs` |
| One contract, 48 implementors | `packages/bench/src/rules/`: 24 classes + 24 object literals in `structural.cjs`, registered in `RuleRegistry.RULES` |
| Wide contract implementation | 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services |
| Declarations with no method syntax | `packages/core/src/support/slotBoard.js`: a computed method key (`[BOARD_REFRESH]`), a class field holding an arrow (`describe`), and a prototype getter installed by `Object.defineProperty` (`load`) |
| Default export, symbol key, tagged template, glob re-export | `packages/core/src/support/slotWindow.js` (`export default`, `[Symbol.toPrimitive]`), `referenceTag.js` (`refTag\`...\``), `helpersGlob.js` (`export *`), all consumed by `boardSummary.js`, which also holds the lane's only `import * as` |
| Enum as a frozen object | `packages/core/src/support/status.js`, `packages/core/src/support/priority.js`: the members (`RepairStatus.Completed`, `Priority.Rush`) and the behaviour over them (`label`, `transitionsTo`, `surchargeBp`) are sibling properties of one `Object.freeze({ ... })` declaration |
| Contract with no `implements` keyword | `packages/core/src/contracts/invoiceCalculator.js`, `packages/bench/src/contracts/reportContract.cjs`, `packages/bench/src/contracts/notifierContract.cjs`: each contract is a JSDoc `@typedef` with no runtime declaration, so its 2 / 24 / 8 implementors satisfy it structurally through the prototype chain |
| Deterministic seed | `packages/bench/src/dataset.cjs`: revenue `58325`c, part cost `46300`c, gross profit `12025`c |
| Tests (incl. request-level) | 139 tests: domain lifecycle, prototypes, Proxy forwarding, shadow pair, breadth registry, rules, CJS/ESM interop, express routes, console commands, the three job styles, slot board and day summary; every exporter, notifier, repository and service against a hand-derived table (`packages/bench/tests/components.test.cjs`); every source module loaded and the CLI entry run (`bench/tests/load.test.mjs`); every module specifier resolved (`bench/tests/specifiers.test.mjs`); every answer-key needle resolved (`bench/tests/sites.test.mjs`); every route module driven (`packages/routes/tests`); the language-server report pinned (`bench/tests/lsp-check.test.mjs`) |
| Broken-syntax fixtures | `fixtures/broken-syntax`, **DO NOT FIX** (negative cases; nothing imports them): an unclosed class, an unbalanced CommonJS destructuring, and TypeScript-only syntax in a `.js` file |
| Document-symbol + call-hierarchy | `packages/core/src/models/repairOrder.js` (9 named symbols) and `packages/bench/src/index.cjs` (6) for the symbol listing; `complete` → `transitionTo`, three callers of `transitionTo`, and `@atelier/app` `recalculateInventory` → `@atelier/core` `SendCompletionNotice.subscribe` for the call graph |

## Consumption (runner)

1. Check out the pinned SHA.
2. `npm ci` in `javascript/` (no unlock, no update).
3. No remote artifacts beyond the npm registry, no SSH private remotes, no secrets.

Local use:

```bash
npm ci
npm test                             # node --test, 139 tests
npm run verify                       # 117 ground-truth tasks
npm run verify:lint                  # node --check over packages/ + broken-fixture guard + checkJs allowlist gate
npm run typecheck                    # the pinned tsc on jsconfig.json, raw output (exits 2: the 60 allowlisted diagnostics)
node packages/app/src/main.js serve 8080
node packages/app/src/main.js seed
node packages/app/src/main.js export-report gross-profit json
node packages/app/src/main.js recalculate-inventory
node packages/app/src/main.js report gross-profit
node packages/app/src/main.js recalculate
```

HTTP surface: `GET /report/:reference` (e.g. `AT-2026-000001`), `GET /api/orders`,
`GET /api/reports/:slug`, `POST /api/orders/:id/notes`, `GET /health`.

Console commands: `export-report [slug] [csv|json|md]` and `recalculate-inventory` are the
command names of the corpus-wide shared set. Lane-only extras: `report [slug]` (the same export,
csv only) and `recalculate` (the same job), this lane's original spellings, kept beside the shared
names; `serve [port]` and `seed`. All six are dispatched in `packages/app/src/main.js` and run by
`bench/tests/load.test.mjs`.

## The JSDoc typecheck is a hard gate with an allowlist

`jsconfig.json` sets `checkJs: true`; `verify.mjs --lint` runs `node_modules/.bin/tsc -p jsconfig.json`
(typescript, `@types/node` and `@types/express` are exact-pinned devDependencies, so `npm ci` always
provides it) and compares the diagnostics, normalised to `<file>: error TS<code>: <message>` (line and
column stripped), against `bench/checkjs-allowlist.txt`. The gate fails on any diagnostic that is not
allowlisted AND on any allowlisted diagnostic that no longer occurs; regenerate the file with
`node bench/verify-tasks/verify.mjs --lint --write-allowlist` and review the diff like code.

A fixed set of diagnostics is expected, because the edges this lane exists for — `Object.assign`
mixins, `Proxy` forwarding, prototype assignment, CJS `require` of ESM-typed files — are precisely
what `checkJs` cannot model: `order.reference()` reported as missing on `RepairOrder` is the lane
working as designed. At the pinned versions the allowlist holds **60 diagnostics** (TS1542/TS1479
CJS-imports-ESM-types, TS2339 on mixin-injected members, TS2769/TS2345/TS2322 on Proxy/generic
variance). What the gate catches is anything NEW: an earlier head shipped 8 extra `TS2307` from a real
gap — `@atelier/core/contracts/repository.js` was missing from the core `exports` map, so a specifier
used only inside JSDoc `import(...)` types was unresolvable while every test, `node --check` and the
needle verifier stayed green. `packages/bench/tests/interop.test.cjs` also resolves every `@atelier/*`
specifier in the lane, and `bench/tests/specifiers.test.mjs` resolves every module specifier of any
kind (relative, bare and `node:`, in code, type-only and docblock `import("...")` or `@import` tags alike, tests and
fixtures included), so that class of defect fails a test as well as the gate.

## Route parsers (E.1)

The tool surface lists eight JavaScript route parsers (`bench/TOOL-SURFACE.md`, ruling R2): Express, NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt, Expo. Each has one route task, keyed the way `def-route-to-handler` is and shared by id with the typescript lane (ruling R12). Every module in `packages/routes` serves `GET /api/reports/:slug` from the seeded registry through `src/reportPayload.js`, and its test asserts the gross-profit cents (58325, 46300, 12025) and a 404 for an unknown slug. These route modules are lane-only extras: none of them is part of the shared route set, which `packages/app` serves.

| Parser | Task | Module (framework convention) | from line | Test drives it with |
| --- | --- | --- | --- | --- |
| Express | `def-route-to-handler` | `packages/app/src/index.js` (`app.get`) | registration | supertest |
| Express (variant) | `def-route-express-router` | `routes/src/express/reportsRouter.js` (a `Router` mounted at `/api/reports`) | registration | supertest |
| NestJS | `def-route-nestjs` | `routes/src/nestjs/reports.controller.js` (`Controller` / `Get` / `Param` applied as calls: Node has no decorator syntax) | the request-level test line | `NestFactory` + supertest |
| Hono | `def-route-hono` | `routes/src/hono/app.js` | registration | `app.request`, no listener |
| Fastify | `def-route-fastify` | `routes/src/fastify/server.js` | registration | `inject`, no listener |
| Remix | `def-route-remix` | `routes/src/remix/app/routes/api.reports.$slug.js` (`loader`) | `reports.latest.js`, a `redirect` to the URL | direct calls |
| SvelteKit | `def-route-sveltekit` | `routes/src/sveltekit/src/routes/api/reports/[slug]/+server.js` (`GET`) | `reports/[slug]/+page.js`, a `fetch` of the URL | direct calls |
| Nuxt | `def-route-nuxt` | `routes/src/nuxt/server/api/reports/[slug].get.js` (default `defineEventHandler`, from `h3`) | `server/routes/reports/latest.get.js`, a `sendRedirect` to the URL | an h3 router built from the two file names, no listener |
| Expo Router | `def-route-expo` | `routes/src/expo/app/api/reports/[slug]+api.js` (`GET`) | `lib/reports.js`, a client `fetch` of the URL | direct calls |

Where code registers the route (Express, Hono, Fastify), the `from` is the registration line and its symbol the handler. Where nothing in code names the handler (NestJS, and the four file-convention frameworks), the task is a string-keyed link: the `from` is a committed consumer that addresses the route by URL, `from.symbol` is the path token, and the framework's convention binds the path to the handler (lane notes).

Two framework choices, stated plainly. SvelteKit is pinned at 2.70.4, the current 2.x, because 3.4.1 declares an optional `typescript ^6` peer that makes npm nest a second TypeScript beside the lane's pinned 5.7.3. **The Expo fixture is convention-only** (ruling R15, a declared deviation from "the framework is a pinned dependency"): the module follows the Expo Router `+api` convention with web-standard `Request` / `Response` and imports nothing, and no Expo package is installed. `expo-router` brings `expo` and `react-native` (not measured; far past the lane's ~300 MB install budget, which the seven other frameworks use 104 MB of: `node_modules` 33 MB before, 137 MB after), and `expo-server` 58.1.0, the only small Expo package for API routes, does not load under plain Node: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/expo-server/build/mjs/runtime/api' imported from .../node_modules/expo-server/build/mjs/index.js` (its ESM build uses extensionless internal imports, for Metro).

## Integrations (E.2)

No ORM, schema or serialization integration is listed for JavaScript, and the lane carries none: a deliberate gap, there is nothing of that kind to score. No "other" extractor (an HTTP client, a template engine) is listed for JavaScript either (`bench/TOOL-SURFACE.md`).

## Known-hard resolution classes (E.3)

| Class | Tasks |
| --- | --- |
| Dynamic dispatch | `def-trait-method-through-binding`, `resolution-calculate-through-binding`, `def-proxy-forwarded-method`, `resolution-prototype-override`, `resolution-mixin-source-order` |
| String-keyed lookup | `refs-string-event-name`, `def-dynamic-require`, `def-string-key-require`, and the five URL-keyed route links (`def-route-nestjs`, `-remix`, `-sveltekit`, `-nuxt`, `-expo`) |
| Alias divergence | `resolution-shadow-alias-cjs`, `resolution-jsdoc-import-alias`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting`, `def-import-alias` |
| Re-export chain | `def-cjs-reexport`, `def-module-exports-member`, `imp-barrel-no-fanout`, `imp-glob-import` |
| Generated code | none: the lane has no build or code-generation step, so JavaScript here has no generated source to resolve into |
| Conditional compilation | none: JavaScript has no conditional compilation |

## Lane-local ids (D.2)

Sorted under rulings R10 and R13. Language-specific (30, counted toward the floor): the CommonJS, prototype, JSDoc and runtime-only tasks, each `note` ending in a "Language-specific mechanism" sentence. Common candidates (18, kept unchanged and not counted, for a follow-up lane that gives each one id across javascript and typescript): `def-static-block-init`, `def-getter-private-field`, `def-class-field-arrow`, `def-computed-method-name`, `def-symbol-keyed-method`, `def-tagged-template`, `def-default-export`, `def-event-emitter-subclass`, `def-promise-style`, `def-setter-accessor`, `hover-setter-clamp`, `def-generator-iterator`, `def-dynamic-import`, `resolution-this-rebinding`, `resolution-calculate-through-binding`, `refs-format-reference`, `refs-with-reference`, `parse-negative-bad-destructure`. The eight `def-route-*` ids are shared with typescript (R12) and counted toward neither.

## Language server (E.5)

`typescript-language-server` 6.1.0 (exact-pinned devDependency) starting the TypeScript language service of the pinned `typescript` 5.7.3 over `jsconfig.json`. `node bench/lsp-check.mjs` asks it every hover, document_symbol, call_hierarchy and implementation key and writes `bench/lsp-check.md`: 15 tasks, 7 agree, 6 disagree, 2 get no answer (asked twice: the first pass, before the project has loaded, answers three tasks differently, and the report lists them). Each disagreement is read against the tree there; no key was changed to match the server.

## Ground truth

| Artifact | Role |
| --- | --- |
| `bench/tasks.json` | 117 needle-based accuracy tasks (`from` → `expect` file/needle pairs). Surfaces: definition 60, resolution 16, references 10, import-precision 5, implementation 5, hover 5, direction 4, call_hierarchy 3, parse-negative 3, cardinality 2, multi-parent 2, document_symbol 2. Every canonical id carried by three or more lanes is carried here. |
| `bench/lsp-check.md` | One run of the pinned language server over the 15 hover, document_symbol, call_hierarchy and implementation keys, each disagreement read against the tree (regenerate with `node bench/lsp-check.mjs`) |
| `bench/checkjs-allowlist.txt` | The exact `tsc -p jsconfig.json` diagnostics the gate accepts (60 at the pinned versions); regenerate with `--lint --write-allowlist` |
| `bench/verify-tasks/verify.mjs` | Self-check that every task needle still resolves to exactly one line |
| `bench/tests/sites.test.mjs` | Resolves every `{file, needle}` in `tasks.json` under any key, including `optional_sites` (exactly one line) and `repeated_sites` (exactly `lines` lines), which the verifier does not read |

```bash
node bench/verify-tasks/verify.mjs           # resolve every file+needle pair
node bench/verify-tasks/verify.mjs --lint    # node --check + broken-fixture guard + checkJs allowlist gate
node bench/verify-tasks/verify.mjs --root .  # verify another lane-shaped directory
```

The verifier uses **node built-ins only**, so it also runs on a machine that has never installed
this lane's dependencies (verified against a copy of `bench/ packages/ fixtures/` with no
`node_modules` present).

Task `file` paths are relative to this lane root (`javascript/`), not to the repository root.
Task IDs shared with the other lanes (`card-*`, `dir-*`, `imp-*`, `lane-local-*`, `parents-*`) ask
the same question in every language, so a harness can line the lanes up.

**Regenerate discipline:** any edit under `packages/` or `fixtures/` must leave
`node bench/verify-tasks/verify.mjs` at **exit 0**. If needles move, update `bench/tasks.json` in
the same change.

## License

MIT. Corpus content is clean-room for bench use.
