# atelier-bench-corpus / typescript lane

Accuracy-bench corpus for agent/tool evaluation over a real TypeScript application graph.
Same repair-atelier domain as the `php/` and `rust/` lanes (customers, devices, repair orders,
parts, technicians), with deliberate **TypeScript** language edges for definition/reference/resolution
tasks.

## Stack

| Piece | Pin / constraint |
| --- | --- |
| Node | `>=22` (`package.json` `engines`) |
| TypeScript | `^5.7.2`, `strict`, `verbatimModuleSyntax` + `isolatedModules` on, `moduleResolution: bundler` |
| Modules | ESM everywhere (`"type": "module"`), relative imports without extensions |
| Layout | npm workspaces: 4 packages + 1 dependency-free verifier |
| Tests | vitest `^2.1.8` (`npm test`), request-level tests through supertest |
| Language server | typescript-language-server `6.1.0` (exact devDependency, pinned in `package-lock.json`) over the lane's own TypeScript 5.9.3; `bench/lsp-check.mjs` starts it as `node node_modules/typescript-language-server/lib/cli.mjs --stdio` with `initializationOptions.tsserver.path` = `node_modules/typescript/lib/tsserver.js` |
| Dataset | `Dataset.seeded()` — fixed rows, **no randomness** in the corpus seed path |
| Vendor breadth | express 5, zod, date-fns, uuid, supertest — real dependencies the app, services and tests import, typed from `node_modules`; no task asks for a definition inside `node_modules` (the one task that names it, `def-ambient-module-declaration`, excludes it) |

Install from the **committed** `package-lock.json` only (`npm ci`). Do not freestyle `npm update`
on a bench machine if you need bit-stable ground truth.

## Packages

| Package | Role | .ts/.tsx files |
| --- | --- | --- |
| `packages/core` (`@atelier/core`) | Domain: models, enum/namespace merges, mixin + Proxy concerns, contracts, container binding, money, errors, events, policy, sibling pair, self-referential tree, type guard/assertion function, an import type | 33 src + 8 test |
| `packages/bench` (`@atelier/bench`) | Breadth subsystem: 8 contracts, 8 concerns, 7 abstract bases, 76 implementors, 48 RuleContract implementors (cardinality), a three-parent contract, 30 language-breadth fixtures, module augmentation, frozen dataset | 181 src + 8 test |
| `packages/app` (`@atelier/app`) | Application surface: express router (plus a mounted order Router), console commands, jobs, shadow-pair aliases, TSX views, ambient declarations | 22 src + 8 test |
| `packages/routes` (`@atelier/routes`) | Lane-only route fixtures: one route module per framework route parser (NestJS, Hono, Fastify, Remix, SvelteKit, Nuxt, Expo), each in its framework's own convention, and a client that addresses them by URL | 12 src + 2 test |
| `bench/verify-tasks` | Ground-truth self-check; **zero third-party dependencies** (Node built-ins only) | 1 `.mjs` |

## Coverage map

| Surface | Where |
| --- | --- |
| Enum + namespace declaration merge | `packages/core/src/support/{status,priority}.ts` — `RepairStatus.label(...)` is a namespace function, `RepairStatus.Completed` an enum member |
| Class + namespace declaration merge | `packages/core/src/money.ts` — `Money.ZERO` is the namespace const, `new Money(1)` the class |
| Free function with overloads | `packages/core/src/support/helpers.ts` (`atelierFormatReference`: two overload signatures + one implementation) |
| Module const + static class const | `helpers.ts` `ATELIER_REF_PREFIX`; `support/reference.ts` `Reference.PREFIX_SEPARATOR` |
| Mixin ("trait") method | `packages/core/src/concerns/hasReference.ts` — `withReference(Base)`; `Customer` and `RepairOrder` extend the returned class, so `reference()` has no declaration in either model file |
| Proxy method forwarding | `packages/core/src/concerns/forwardsToSchedule.ts` — `technician.nextSlot()` has no declaration on `Technician`; it resolves into `support/schedule.ts` |
| Type alias over an intersection | `packages/core/src/models/technician.ts` (`Technician = TechnicianBase & ScheduleForwarded`) |
| Interface + 2 impls + container binding | `contracts/invoiceCalculator.ts`, `services/{standard,rush}InvoiceCalculator.ts`, `container.ts` |
| Same-name shadow pair (aliases) | `billing/formatter.ts` vs `reporting/formatter.ts`, reached through the `@atelier/core/billing` and `@atelier/core/reporting` subpath exports, aliased in `packages/app/src/state.ts`, called in `http/report.ts` |
| Barrel re-export | `packages/core/src/index.ts` declares nothing; a definition must land on the declaring module |
| Subpath `exports` map | `packages/core/package.json` `./billing`, `./reporting` |
| Module augmentation | `packages/bench/src/augmentations.ts` — `debugLabel()` added to `@atelier/core/billing` `Formatter` via `declare module` |
| Inferred type from a value | `packages/app/src/http/api.ts` — `StoreNote = z.infer<typeof storeNoteSchema>` |
| Discriminated union narrowing | `packages/core/src/events.ts` (`DomainEvent`, `event.kind === "repair_completed"`), `policy.ts` (`Actor`), `packages/app/src/commands/index.ts` (`Command`) |
| Structural concern (no `implements`) | `packages/bench/src/concerns/hasFormatting.ts` — `formatting` satisfies `HasFormatting` structurally |
| Type-only import | `import type { Container }` in `packages/core/src/models/repairOrder.ts` — no runtime edge |
| Generic interface pinned per implementor | `packages/core/src/contracts/repository.ts` (`Repository<Id, Rec>`), 8 implementors in `packages/bench/src/repositories/` |
| Abstract base fan-out | `packages/bench/src/support/abstractReport.ts` — 21 direct subclasses + `AbstractPeriodicReport` + 3 through it = 24 concrete reports |
| Trait-object registry fan-in | `packages/bench/src/index.ts` `REPORTS` (24 entries) / `METRICS` (16) |
| Error hierarchy | `packages/core/src/errors.ts` (`AtelierError` → `NotFoundError`, `IllegalTransitionError`, `ValidationError`); HTTP mapping in `packages/app/src/http/errors.ts` |
| Events / listener / observer / policy / job | `events.ts`, `observers.ts`, `policy.ts`, `packages/app/src/jobs.ts` |
| HTTP surface (express 5) | `packages/app/src/index.ts` router; handlers in `http/{report,api}.ts` |
| Wide contract implementation | 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services |
| Deterministic seed | `packages/bench/src/dataset.ts` `Dataset.seeded()` — revenue `58325`c, part cost `46300`c, gross profit `12025`c |
| Tests (incl. request-level) | 133 vitest tests in 26 files: lifecycle, money, shadow pair, Proxy forwarding, breadth registry and every breadth component (exporters, notifiers, repositories, services, concerns), augmentation, express routes, every framework route fixture, console commands and the `main.ts` entrypoint, TSX views, async loaders, ambient declarations (type-checked), issue-#9 surfaces and a use of every lane-only fixture; plus the key and graph guards below |
| TSX + JSX factory | `packages/app/src/views/{h.ts,reportCard.tsx,reportPage.tsx}`: `jsxFactory: "h"` (no framework), component + intrinsic elements + fragment |
| Ambient declarations | `packages/app/src/types/jsx.d.ts` (global `JSX` namespace), `packages/app/src/types/legacy-formatting.d.ts` (`declare module "atelier-legacy-formatting"`, type-only consumer in `http/legacy.ts`) |
| `paths` alias | `tsconfig.base.json` maps `@app/*` → `packages/app/src/*`; type-only import in `http/reportLoader.ts` |
| async / generators | `http/reportLoader.ts`: `async function`, `function*`, `async function*`, `for await` |
| Broken-syntax fixtures | `fixtures/broken-syntax`, **DO NOT FIX** (negative cases; excluded by `tsconfig.json`, so `tsc` never sees them) |
| Cardinality (nominal/structural split) | `packages/bench/src/contracts/ruleContract.ts` + `rules/` — 48 implementors: 24 nominal classes (`implements`), 24 structural object literals (16 typed `: RuleContract`, 8 via `satisfies RuleContract`) |
| Direction (parent/child/self/merge) | `dir-contract-parent`, `dir-implementor-child` over `ReportContract`/`AbstractReport`/`CashFlowReport`; `dir-self-reference` — new `packages/core/src/support/treeNode.ts`; `dir-declaration-merge-not-inheritance` — the existing `RepairStatus` enum/namespace merge, framed as a non-inheritance edge |
| Import precision | `packages/core/src/support/pair.ts` (`Left`/`Right`, one imported); type-only vs value import of `Container`; namespace import `import * as Rules from "./rules"`; barrel no-fanout on `Customer` |
| Collision (lane-local) | 6 tasks pinning `Money`, `Customer`, `Dataset`, `ATELIER_REF_PREFIX`, `InvoiceCalculator.calculate`, the billing `Formatter` as this lane's own declarations |
| Multi-parent | `packages/bench/src/contracts/compositeContract.ts` (`CompositeContract extends` 3 interfaces); `packages/bench/src/reports/dailyRevenueReport.ts` (1 `extends` + 2 `implements` on an existing report, so `ReportContract` stays at 24 implementors) |
| Breadth (language-feature fixtures) | `packages/bench/src/support/{unwrap,flags,slug,rulesConfig,logged,arrayAugmentation,uniqueKey,severity,adhoc,keyedLookup,worker}.ts`, `packages/core/src/support/orderGuards.ts`, an overloaded `Money.plus`, and `export * as Rules from "./rules"` — conditional/mapped/template-literal types, `satisfies`, a standard TC39 decorator, global augmentation, type guard + assertion function, `unique symbol`, `const enum`, class expression, `keyof typeof`, class method overload, class/interface declaration merging, `export * as` |
| TypeScript-only fixtures (wave 3, issue #223 D.2) | `packages/bench/src/support/{priceRule,thisParameter,orderFields,loadedOrder,workshopHours,elementOf,partLabel,thisTypeMarker,traceHeaders,rushTicket,eventFilters,partCode,intakeStage,benchEvents,lazyFields}.ts`, `packages/core/src/support/calculatorRef.ts`, `packages/app/src/{lane.ts,types/lane.d.ts}` and `RushOrder` in `core/src/support/orderGuards.ts` — a class implementing a type alias, a `this` parameter, indexed access / `Partial` / `keyof`-argument lookups, `ReturnType` + `Awaited`, an import-equals namespace alias, an `infer` variable, interface merging, an import type, a global `declare const` the build defines, an interface extending a class, assertion narrowing; after bounce 1: `ThisType`, a template literal index signature, a `this is` method predicate, `Extract` over a union, function + namespace and enum + enum merging, an event map indexed by a generic key, a `typeof import(...)` member (the one-lane sort under rulings R18 and R19 is in PR #237); used by `bench/tests/typescriptOnly.test.ts`, `core/tests/{calculatorRef,orderGuards}.test.ts`, `app/tests/lane.test.ts` |
| Route parsers (lane-only extras, checklist E.1) | Express: `packages/app/src/http/orderRouter.ts` (a Router mounted at `/api/orders`). `packages/routes/src/`: `hono/app.ts`, `fastify/app.ts`, `nest/orders.controller.ts` (decorators; `nest/tsconfig.json` turns on legacy decorators), `remix/app/routes/api.remix.orders.$reference.ts`, `sveltekit/src/routes/api/sveltekit/orders/[reference]/+server.ts`, `nuxt/server/api/nuxt/orders/[reference].get.ts`, `expo/app/api/expo/orders/[reference]+api.ts`; `client.ts` addresses the convention routes by URL. Pinned in `package-lock.json`: hono 4.13, fastify 5.12, @nestjs/common + core + platform-fastify 12.6 (+ reflect-metadata, rxjs), @remix-run/node 2.17, @sveltejs/kit 2.70.4 (kit 3 peers TypeScript 6) with svelte 5 and @sveltejs/vite-plugin-svelte 4 (for the vite 5 vitest brings), nitropack 2.14.0 exact (Nitro, the server engine Nuxt runs on, which owns the `server/` file convention: the Nuxt test builds its routes with Nitro's own `createNitro` + `scanHandlers` over `nuxt/server/` and serves them on h3 1.15, the version nitropack depends on; the `nuxt` package itself, with Vue and its build, is not installed). Expo is convention-only, a declared deviation (ruling R15): measured here, `expo-server` 58.1.0 (760K) installs but does not load under Node 22.23: `import("expo-server")` fails with `ERR_MODULE_NOT_FOUND`, "Cannot find module .../expo-server/build/mjs/runtime/api" (an extensionless import in its ESM build); `expo-router` 58.0.33 lists react-native, react-native-screens, react-native-reanimated and expo among its peer dependencies (`npm view expo-router peerDependencies`), so it was not installed (the javascript lane, PR #234, reports the same). The API route uses web Request / Response and no Expo package is installed. Installing the others took `node_modules` from 89M to 161M, nitropack from 163M to 232M (`du -sh node_modules`). Tests: `packages/routes/tests/{routes,nest}.test.ts`, `packages/app/tests/http.test.ts` |
| Document-symbol + call-hierarchy | `packages/core/src/models/repairOrder.ts` (27 named symbols) and `packages/bench/src/index.ts` (4) for the symbol listing; `complete` → `transitionTo`, three callers of `transitionTo`, and `@atelier/app` `recalculateInventory` → `@atelier/core` `Dispatcher.register` for the call graph |
| String-keyed events (name-only resolution) | `packages/core/src/events.ts`: `StringBus` plus the `REPAIR_COMPLETED` / `STATUS_CHANGED` / `STOCK_DEPLETED` literals, subscribed in `SendCompletionNotice.subscribe` and exercised by `packages/core/tests/events.test.ts`; nothing declares the string as a symbol |
| Same name in two modules | `packages/app/src/jobs.ts` (callback job) and `packages/app/src/commands/recalculateInventory.ts` (console command) both export `recalculateInventory`; `main.ts` picks the command by module path |

## Consumption (runner)

1. Check out the pinned SHA.
2. `npm ci` (no unlock, no update): it installs every framework the route fixtures use, from the committed lockfile alone.
3. No remote artifacts beyond the npm registry, no SSH private remotes, no secrets.

Local use:

```bash
npm run typecheck               # tsc over tsconfig.json, then over packages/routes/src/nest/tsconfig.json (legacy decorators)
npm test                        # 133 tests in 26 files
node bench/lsp-check.mjs        # rewrites bench/lsp-check.md (language-server check, E.5)
```

The console entrypoint is `packages/app/src/main.ts` (`serve [port]`, `seed`, `export-report [slug]`,
`recalculate-inventory`); `packages/app/tests/entrypoint.test.ts` imports it under vitest with each
command but `serve`, and the request-level tests in `packages/app/tests/http.test.ts` drive the router,
so no runtime loader is pinned. `export-report` and `recalculate-inventory` are the command names the
lanes share; the lane-only extras `report [slug]` and `recalculate` are this lane's earlier spellings of
the same two commands, kept as aliases (`packages/app/src/commands/index.ts`), and both spellings are
run by `entrypoint.test.ts`.

HTTP surface: `GET /report/:reference` (e.g. `AT-2026-000001`), `GET /api/orders`,
`GET /api/orders/:reference` (the mounted order Router, a lane-only extra), `GET /api/reports/:slug`,
`POST /api/orders/:id/notes`, `GET /health`. The shared set writes the
notes route as `POST /api/orders/{key}/notes`; this lane binds the order by its numeric id, in
express `:id` syntax, as the rust, javascript, python and go lanes do (php binds by reference).

## Ground truth

| Artifact | Role |
| --- | --- |
| `bench/tasks.json` | 128 needle-based accuracy tasks (`from` → `expect` file/needle pairs): 44 original + 34 failure-mode surfaces (issue #9) + 9 TSX/ambient/paths/async edges + 5 document-symbol/call-hierarchy surfaces + 7 shared-id parity and depth-floor tasks + 13 TypeScript-only one-lane tasks and 8 route tasks (issue #223, wave 3) + 8 TypeScript-only one-lane tasks (bounce 1, rulings R18 and R19) |
| `bench/verify-tasks/verify.mjs` | Self-check that every task needle still resolves to exactly one line |

**One-lane ids (checklist D, ruling R20).** (a) 53 ids in `bench/tasks.json` are carried by this lane
alone in `bench/matrix.json` (the 8 R12 route ids are two-lane since javascript's PR #234 merged). (b) 42 of those 53 sit on a construct only TypeScript has (type-level and
declaration-level syntax: conditional, mapped, template-literal and indexed-access types, `infer`,
`keyof` / `typeof` in type positions, type predicates, `satisfies`, `ThisType`, pattern index
signatures, declaration merging, ambient declarations, `paths`, import types); the 11 common
candidates are left out, and no id duplicates another. Two of the 42 are close: `def-type-guard`
and `def-this-predicate-method`, whose type predicates Python's TypeGuard / TypeIs imitate natively.
(c) 33 of the 42 also pass the R19 trace (a resolver that ignores the mechanism does not land on the
expect line): the review's 24 plus the 9 added in bounce 1; 27 when the six bounce-1 ids that R19's
second clause makes close calls are left out. The PR body lists every id per number. Box D.2 stays
open while the 11 common candidates wait for their follow-up lane.

```bash
npm run verify                              # resolve every file+needle pair
npm run verify:lint                         # tsc over the lane + broken-fixture guard
node bench/verify-tasks/verify.mjs          # same as npm run verify; needs no node_modules
node bench/verify-tasks/verify.mjs --root <dir>   # verify another lane-shaped directory
```

The verifier uses **Node built-ins only** (`node:fs`, `node:path`, `node:url`, `node:child_process`,
`node:process`), so it also runs on a machine that has never run `npm ci`. Only `--lint` needs
`node_modules` (it shells out to `npx tsc`).

Task `file` paths are relative to this lane root (`typescript/`), not to the repository root.

**Regenerate discipline:** any edit under `packages/` or `fixtures/` must leave
`npm run verify` at **exit 0** and `npm test` green. If needles move, update `bench/tasks.json` in
the same change; if a reference site or a document symbol is added or removed, update the key's
count and list in the same change.

**Key and graph guards (run by `npm test`):** `packages/bench/tests/referenceCounts.test.ts`
recounts every `references` task and `packages/bench/tests/documentSymbols.test.ts` every
`document_symbol` task under the counting rules in the `notes` of `bench/tasks.json`;
`packages/bench/tests/moduleSpecifiers.test.ts` resolves every module specifier written in the lane
(type-only, type-level, docblock `{@link import(...)}` ones and quoted `./` or `../` paths written in
comments included) and fails when a file under `packages/*/src` is reached by no test, or holds runtime
code and is reached only through `import type` edges.

**Language server (checklist E.5):** the server this lane's stack starts is typescript-language-server
6.1.0 over TypeScript 5.9.3 (Stack table). `node bench/lsp-check.mjs` (after `npm ci`) asks it every
`hover`, `document_symbol`, `call_hierarchy` and `implementation` task and writes
`bench/lsp-check.md`: one line per task, agrees / disagrees / server has no answer, with what it
returned and, where it disagrees, what the tree shows. Document symbols are compared as a multiset
of names, with every line the server gives, so a name listed twice is an extra even when the key
holds it once. Each tree reading in the script records the exact difference it was written for, and
the script exits 1 when the server's answer differs from it. At the committed run it agrees on 8 of
15 and no key was wrong: the 7 others are server-side (an anonymous callback, a local or an
object-literal key listed as a symbol; a registry array, a type alias or a typed array returned as
an implementor; a caller or implementor in another package missed). A key is never changed to match
the server.

A language server used as a second opinion on these keys should run against the root
`tsconfig.json`, or have the consuming package's files opened first (the script opens every file
under `packages/*/src` and `packages/*/tests`): each `packages/*/tsconfig.json` includes only its own
package, so a server that answers from the core project misses every site in `bench` and `app` (for
example 6 of the 57 `refs-money-class` lines, all in `bench/src/dataset.ts`). Opening the files fixes
references; it does not fix implementation or incoming calls across packages (`impl-repository-generic`,
`hierarchy-incoming-transition` in the report).

## Indexer surfaces (checklist section E)

The list of what the tools under test ship for TypeScript is `bench/TOOL-SURFACE.md` (ruling R2 of
issue #223: the published skybox 0.9.0 README, "Framework extractors"): Express, NestJS, Hono,
Fastify, Remix, SvelteKit, Nuxt, Expo. All eight are route parsers.

### ORM, schema and serialization integrations (E.2)

No ORM, schema or serialization integration is listed for TypeScript, and no other extractor is:
every TypeScript entry of the list is a route parser (E.1 below). So no deliberate gap is owed here.
zod is a vendor dependency of the app, not a listed integration: `def-inferred-type` scores it as a
TypeScript question (a type inferred through `typeof` from the schema value in `http/api.ts`), not as
the output of a schema extractor.

### Known-hard resolution classes (E.3)

| Class | Tasks |
| --- | --- |
| Dynamic dispatch | `lane-local-calculate`, `def-trait-method-through-binding` (the container binding), `def-proxy-forwarded-method` (a Proxy) |
| String-keyed lookup | `refs-string-event-name`, `resolution-indexed-access-type`, `resolution-keyof-argument`, and the five `route_url` route tasks (a URL string to its handler) |
| Alias divergence | `def-shadow-alias-billing`, `def-shadow-alias-reporting`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting`, `def-import-equals-alias` |
| Re-export chain | `def-through-barrel`, `imp-barrel-no-fanout`, `imp-glob-import`, `def-export-star-as` |
| Generated code | Not a class TypeScript has: the language generates no code of its own. Framework build steps do (SvelteKit's `./$types`), and the SvelteKit fixture imports its types from the package instead so that it loads without that step. |
| Conditional compilation | Not a class TypeScript has: there is no `#if` or `cfg`; `declare` and `.d.ts` files describe code, they do not select it. |
| TypeScript's own | declaration merging (`resolution-class-interface-merge`, `resolution-namespace-vs-enum`, `resolution-interface-merge`, `dir-declaration-merge-not-inheritance`), structural typing (`resolution-structural-concern`, `card-rule-contract`), control-flow narrowing (`resolution-discriminated-union`, `resolution-assertion-narrowing`), computed types (`resolution-utility-return-type`, `resolution-mapped-utility-member`) |

## License

MIT. Corpus content is clean-room for bench use.
