# Language-server check (E.5)

Server: `typescript-language-server` 6.1.0 (exact-pinned devDependency) driving the TypeScript language service of `typescript` 5.7.3 (`node_modules/typescript/lib/tsserver.js`, exact-pinned); project `jsconfig.json` (`packages/*/src` only, so test files are outside it).

Command: `node bench/lsp-check.mjs`, run from `javascript/` after `npm ci`; it rewrites the table below and keeps the hand-written part. Each task is asked at its `from` position (hover, prepareCallHierarchy + outgoing/incoming calls, implementation) or on its file (documentSymbol).

15 tasks: 6 agrees, 5 disagrees, 4 server has no answer.

| task | surface | verdict | what the server returned |
| --- | --- | --- | --- |
| `hover-frozen-seed` | hover | agrees | hover holds "Changing these rows changes bench ground truth" |
| `hover-proxy-forwarding` | hover | agrees | hover holds "forward to its Schedule" |
| `hover-free-function` | hover | disagrees | hover without the key string: "```typescript import atelierFormatReference ```" |
| `impl-invoice-calculator` | implementation | server has no answer | no locations |
| `impl-notifier-contract` | implementation | server has no answer | no locations |
| `impl-report-contract` | implementation | server has no answer | no locations |
| `docsym-repair-order` | document_symbol | disagrees | 18 distinct names against the key's 9; missing 0; extra 9 (partId, quantity, sku, unitPrice, parts.map() callback, order, changedBy, from, to) |
| `docsym-report-registry` | document_symbol | disagrees | 61 distinct names against the key's 6; missing 0; extra 55 (<unknown>, Cadence, CompositeContract, Dataset, isRuleContract, MetricUnit, NotifyError, reportRow, rowFromCents, RuleRegistry, RULES, suffix, ...) |
| `hierarchy-complete-chain` | call_hierarchy | agrees | 2 callees, every keyed one among them |
| `hierarchy-incoming-transition` | call_hierarchy | disagrees | 8 call lines (packages/core/src/models/repairOrder.js:79, packages/bench/src/dataset.cjs:80, packages/bench/src/dataset.cjs:81, packages/bench/src/dataset.cjs:82, packages/bench/src/dataset.cjs:87, packages/bench/src/dataset.cjs:88, ...); missing packages/core/tests/lifecycle.test.js:19 |
| `hierarchy-cross-package` | call_hierarchy | agrees | 4 callees, every keyed one among them |
| `impl-repository-generic` | implementation | disagrees | 8 locations against the key's 8; missing 8; extra 8 (packages/bench/src/repositories/customerRepository.cjs:9, packages/bench/src/repositories/inventoryRepository.cjs:17, packages/bench/src/repositories/invoiceRepository.cjs:9, packages/bench/src/repositories/orderRepository.cjs:9, packages/bench/src/repositories/partRepository.cjs:9, packages/bench/src/repositories/paymentRepository.cjs:17, ...) |
| `impl-exporter-contract` | implementation | server has no answer | no locations |
| `hover-setter-clamp` | hover | agrees | hover holds "never drops an already booked slot" |
| `hover-prototype-method` | hover | agrees | hover holds "Human label such as `Framework 13 (SER-0001)`." |

<!-- Everything below this line is written by hand and kept by reruns. -->

## Disagreements, read against the tree

No key was changed because of this run. Each disagreement and each empty answer was read against the source; in every case the key holds, for the reason given.

| task | the server | the tree, and why the key stands |
| --- | --- | --- |
| `hover-free-function` | asked at the call in `packages/core/src/concerns/hasReference.js`, hovers the import binding (`import atelierFormatReference`) and shows no doc text | the function's own JSDoc in `packages/core/src/support/helpers.js` holds the key string; the hover stops at the import alias instead of following it to the declaration |
| `impl-invoice-calculator`, `impl-notifier-contract`, `impl-report-contract`, `impl-exporter-contract` | no locations | each contract is a JSDoc `@typedef` with no runtime declaration, satisfied structurally through the prototype chain (lane notes); the listed classes each define the contract's members, read file by file, and the service does not search structural satisfiers of a `@typedef` |
| `impl-repository-generic` | 8 locations, each the `@type {import(...).Repository<...>}` annotation line inside a repository file | the annotation is where each repository claims the typedef; the key lists the 8 class declarations those annotations sit in, the declarations an implementation answer names; same 8 files, each class line just below its annotation comment |
| `docsym-repair-order`, `docsym-report-registry` | every key name, plus object-literal keys, callback and parameter names, and require bindings | the lane's document_symbol rule (notes) counts declarations and leaves those out; recorded as issue #208, where the scorer marks both tasks UNSCORABLE for this server |
| `hierarchy-incoming-transition` | 8 call lines in `packages/*/src`, without `packages/core/tests/lifecycle.test.js:19` | `jsconfig.json` includes `packages/*/src` only, so the service never opens the test that calls `transitionTo`; the call is in the tree and the key's caller list is right |
