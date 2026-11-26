# atelier-bench-corpus / go lane

Accuracy-bench corpus for agent/tool evaluation over a real Go application graph.
Same repair-atelier domain as the other five lanes (customers, devices, repair orders, parts,
technicians), with deliberate **Go** language edges for definition/reference/resolution tasks:
the resolution problems Go creates that the other lanes cannot — method promotion through embedded
structs (one, two and four levels deep), interface satisfaction with no `implements` keyword,
pointer versus value receivers, method values and method expressions, generics with constraints,
`init()` registration with blank imports, build tags, `go:generate` and `go:embed`, a package whose
import path disagrees with its declared name, and a package that shadows a standard-library one.

## Stack

| Piece | Pin / constraint |
| --- | --- |
| Go | `go 1.23.0` with `toolchain go1.23.4` in `go.mod` (CI pins the same; `iter.Seq` and method-prefixed `ServeMux` patterns are used) |
| Layout | one module, `atelier.example/lane`, packages under `core/`, `atelier/`, `app/`, `cmd/`, `internal/`, `tools/`, and the lane-only route modules under `frameworks/`; run every command from the lane root (`go/`) |
| Dependencies | the in-tree module `atelier.example/yamlish.v2`, resolved by a `replace` to `./third_party/yamlish.v2`, and the five router frameworks the lane-only route modules under `frameworks/` are written against, each pinned in `go.mod` and locked with its transitive modules in `go.sum`: `github.com/gorilla/mux v1.8.1`, `github.com/go-chi/chi/v5 v5.3.2`, `github.com/gin-gonic/gin v1.10.1`, `github.com/labstack/echo/v4 v4.13.4`, `github.com/gofiber/fiber/v2 v2.52.16` (each at a release whose module graph keeps `go 1.23.0` / `toolchain go1.23.4`: chi v5.4 and echo v4.14 already declare go 1.24). Install step: `go mod download` (fetches exactly the `go.sum` versions from the module proxy; `go build` does the same on first use) |
| Test runner | `go test ./...` (stdlib `testing`): 81 tests, 47 in `tests/`, in-package tests for the `main` packages (`bench/verify` 11, `bench/lspcheck` 7, `cmd/atelier` 4, `tools/statusgen` 1) and 2 per route module under `frameworks/` (10) |
| Dataset | `dataset.Seeded()` — fixed rows, **no randomness**; revenue `58325c`, part cost `46300c`, gross profit `12025c` |

## Packages

| Package | Role | .go files |
| --- | --- | --- |
| `core/` | Domain: models, money, iota enums, interfaces, container, events, policy, failures, both `Formatter` halves | 32 |
| `atelier/` | Breadth subsystem: 13 contract interfaces, 8 concerns, 8 embeddable bases and the generic `Registry`, 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services, 48 rules, dataset, registries | 134 |
| `app/` | Application surface: `net/http` routes, console commands, jobs (callback / channel / goroutine) | 9 |
| `cmd/atelier/` | Console entry point; blank-imports `internal/audit` for its `init()` | 2 |
| `internal/` | Internal-only audit sink, `go:embed`ded banner, a build-tag pair | 3 |
| `tools/statusgen/` | The `go:generate` generator behind `core/support/status_labels_gen.go`, and the test that regenerates it byte for byte | 2 |
| `tests/` | 47 tests incl. request-level (`net/http/httptest`) | 12 |
| `bench/` | `tasks.json`, `verify/` (stdlib only) and its test, `lspcheck/` (the language-server check) and its test, and `lsp-check.md`, that check's committed report | 8 |
| `third_party/yamlish.v2/` | In-tree module whose import path last segment (`yamlish.v2`) differs from its package name (`yamlish`) | 1 |
| `fixtures/broken-syntax/` | Intentionally invalid Go, **DO NOT FIX** (build-tag gated) | 3 |
| `frameworks/` | Lane-only route modules, one per Go route parser beyond `net/http`, each in its framework's own convention and driven by its own request-level test with no listener: `muxroutes/` (gorilla/mux), `chiroutes/` (chi), `ginroutes/` (gin), `echoroutes/` (echo), `fiberroutes/` (fiber, through `App.Test`); `orderview/` is the payload they share | 11 |

## Coverage map

| Surface | Where |
| --- | --- |
| Method promotion, one level (embedded pointer) | `core/models/technician.go` embeds `*support.Schedule`; `t.BookedCount()` resolves to `core/support/schedule.go` (`def-proxy-forwarded-method`, `refs-promoted-method-call`, `hierarchy-promoted-callee`) |
| Method promotion, two levels | `Technician` embeds `Staff`, `Staff` embeds `concerns.HasReference`; `technician.ShortReference()` is declared on neither (`def-mixin-method`) |
| Method promotion, four levels | `reports.CashFlowReport` → `support.CompositeReport` → `PeriodicReport` → `BaseReport` → `concerns.HasCache`; `cashFlow.CacheKey()` on the concrete `*reports.CashFlowReport` (`tests/promotion_test.go`, `def-embedded-promotion-four-levels`) |
| Embedded field name | `core/services/rush.go`: `c.StandardInvoiceCalculator` names the embedded FIELD, whose implicit name is its type's (`resolution-embedded-field-name`) |
| Methods on a function type | `app/http/router.go` `Handler`, used as the result type of every handler factory and as the `ServeHTTP` receiver (`def-func-type-implements-interface`, `refs-func-type-handler`) |
| Named result set by a deferred closure | `app/jobs.go` `SafeRun`'s `err` (`def-named-result-deferred`, `def-defer-recover`) |
| Many functions named `init` | `atelier/reports/`: 24 `init` functions, one per report file (`hierarchy-init-outgoing`, `def-init-registration`) |
| Route parsers | `net/http` in `app/http/router.go` (`def-route-to-handler`, `def-route-default-mux`); gorilla/mux, chi, gin, echo, fiber under `frameworks/` (`def-route-gorilla-mux`, `def-route-chi`, `def-route-gin`, `def-route-echo`, `def-route-fiber`) |
| Shadowing a promoted method | `core/services/rush.go`: `Calculate` overrides the promoted one and calls it back as `c.StandardInvoiceCalculator.Calculate(order)` |
| Interface satisfaction without `implements` | every nominal implementor carries a `var _ Contract = (*Type)(nil)` assertion (`cash_flow.go` three, one per contract it satisfies); the 24 ad-hoc rules in `atelier/rules/adhoc/` carry none at all, and `contracts.RuleLike`, the structural twin of `RuleContract`, is asserted nowhere: it is used only as the constraint of `contracts.SatisfiedBy` |
| Pointer vs value receivers | `core/money/money.go` is value-receiver throughout; `core/models/repairorder.go` is pointer-receiver throughout; `atelier/rules/*.go` assert on the value type |
| Method value / method expression | `core/support/schedule.go`: `book := s.BookSlot` and `booker := (*Schedule).BookSlot` |
| Generics | `core/support/helpers.go` (constraint union `~int | ~int64 | ~float64`), `pair.go` (two parameters, plus a free function for the third), `atelier/support/registry.go` (`Registry[T]` instantiated five times), `core/contracts/repository.go` (`Repository[T]` with eight instantiations) |
| `init()` registration + registries | each of the 24 reports / 16 metrics / 8 exporters / 8 notifiers / 24 rules registers itself; `atelier/*/registry.go` sorts every listing because Go randomises map order; the 12 services hold no registration state and are built by `atelier/services.All()` |
| Blank import for side effects | `cmd/atelier/main.go` blank-imports `internal/audit`, whose `init()` registers the event sink |
| Internal package boundary | `internal/audit/` is importable only from `atelier.example/lane/...` |
| Build tags | `internal/audit/platform_darwin.go` (`//go:build darwin`) and `platform_other.go` (`//go:build !darwin`) both declare `platformLabel` |
| `go:generate` + committed generated file | `core/support/status.go` holds the directive, `status_labels_gen.go` is the output, `tools/statusgen/` is the generator |
| `go:embed` | `internal/audit/audit.go` embeds `banner.txt` into a package variable |
| Import path vs package name | `app/commands/export_report.go` imports `atelier.example/yamlish.v2` and calls `yamlish.Marshal` |
| Package shadowing the standard library | `app/http/` is itself named `http`, imports `net/http`, and declares its own `NewServeMux` (the application mux), which calls the standard library's `http.NewServeMux()`; callers alias the package (`apphttp`) |
| Same-name packages under different paths | `core/support` vs `atelier/support`, `core/contracts` vs `atelier/contracts`, `core/services` vs `atelier/services`; consumers alias one (`coresupport`) |
| Shadow pair (same type name) | `core/billing/formatter.go` vs `core/reporting/formatter.go`, aliased in `app/state.go` as `moneyfmt` / `statusfmt` |
| Function type implementing an interface | `app/http/router.go` `Handler` (the `http.HandlerFunc` pattern) and `core/contracts/invoicecalculator.go` `CalculatorFunc` |
| Closures, `defer`/`recover` | every HTTP handler is a closure over state; `app/jobs.go` `SafeRun` recovers a panic into a named return |
| Channels, goroutines, `select` | `app/jobs.go`: the callback / channel / goroutine trio, with a `select` timeout arm |
| Range-over-func iterator (Go 1.23) | `atelier/dataset/dataset.go` `Iterate() iter.Seq[*models.RepairOrder]`, driven by `atelier/services/backlog_service.go` |
| Error wrapping | `core/failure/errors.go`: two sentinels, two wrapping types with `Unwrap`, `errors.Is` / `errors.As` helpers |
| Type switch, anonymous struct | `core/support/pick.go`: `DescribeChoice` and `AnonymousSummary` |
| String-keyed dispatch | `atelier/services/order_volume_service.go` `By(scope)`, `core/policy/policy.go` `Allows(ability)`, `core/container/container.go` `Make(key)`, `atelier/exporters` by extension |
| Same name, command vs job | `app/commands.RecalculateInventory` (console line) vs `app.RecalculateInventory` (job) |
| Package-boundary call edge | `app/commands/recalculate_inventory.go` subscribes `core/events.StockWatch` and dispatches one `stock.depleted` event per depleted part: the lane's one outgoing edge from `app/` into `core/events` |
| HTTP routes | `app/http/router.go`: `GET /report/{reference}`, `GET /api/orders`, `POST /api/orders/{id}/notes`, `GET /api/reports/{slug}`, `GET /health`; `RegisterDefault` also registers `/health` on the default mux |
| Parameter groups vs arity | `core/models/part.go` `NewPart` takes six parameters in four groups |
| Parse negatives | `fixtures/broken-syntax/` — two invalid files behind the `brokenfixtures` build tag, **DO NOT FIX** |
| Shared ids carried under the shared name | `parse-negative-unclosed-class` (Go has no classes; the task asks the same question, a type body left open, of `fixtures/broken-syntax/unclosed_struct.go`; it was the lane-local `parse-negative-unclosed-struct` until ruling R11 of issue #223) |
| Shared-id mapping: `def-async-function` | Go has no async functions; the nearest question is lane-local `def-channel-job`, a function whose result arrives on the receive-only channel it returns, received with `<-app.RunWithChannel(data)` where the other lanes `await` |

## Consumption (runner)

```
cd go
go mod download                # the pinned framework modules of go.sum (go build fetches them too)
go build ./...
go test ./...
go run ./bench/verify          # 112 tasks, exit 0
go run ./bench/verify --lint   # build + broken-fixture guard (each file must fail to parse) + go vet + module specifiers + gofmt
go run ./cmd/atelier seed      # seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c, then one line per metric, the rule tally and one line per service row
go run ./cmd/atelier export-report cash-flow [json|csv|md|...]   # the shared command; json unless a format is named
go run ./cmd/atelier recalculate-inventory                       # the shared command: recalculate-inventory: 2 part(s) below reorder level, ...
```

The only network access is the module download: `go.mod` pins every framework module and `go.sum`
locks its hashes, so `go mod download` (or the first `go build`) fetches exactly those versions
from the module proxy and nothing else; the yamlish module is an in-tree `replace`.
`go generate ./core/support` must reproduce
`core/support/status_labels_gen.go` byte for byte; `tools/statusgen`'s test checks it.

`--lint` also resolves every module specifier written anywhere in the lane, whatever the build
constraint: import specs (broken fixtures and the darwin half of the build-tag pair included), the
package of each `//go:generate go run` directive, each `//go:embed` pattern, lane module paths and
doc links in comments, `go.mod`'s require and replace directives (single-line or in blocks; a
require resolves through `go list -m`, or, for a module the platform build never downloads, through
the `go.sum` line that locks its version's `go.mod`), and the package path of each
`resolution` key in `bench/tasks.json`.

## Ground truth

`bench/tasks.json` carries 112 needle-based tasks. `bench/verify` resolves every `file` + `needle`
pair to exactly one line, checks that each `repeated_sites` needle matches exactly its `lines`
lines, and prints one `<id>: OK (from <file>:<line> -> <n> expect needles resolved)` line per task;
its stdout contract is byte-identical to the other five lanes' verifiers, which
`node bench/check-matrix.mjs` proves against `bench/conformance/expected.txt` and
`bench/verify`'s own test checks in this lane's CI job.

Lane-only extras:

- `go run ./cmd/atelier seed` prints 16 `service <name>: <label> = <value>` rows (one or more per
  service, 12 services) after the rule tally; no other lane's seed command prints service rows.
- Console verbs beside the shared `export-report` and `recalculate-inventory`: `report <slug>`
  (the same operation as `export-report`, always markdown), `recalculate` (the same operation as
  `recalculate-inventory`; both verbs share one case clause in `cmd/atelier/main.go`) and `export`
  (the run manifest through `atelier.example/yamlish.v2`).
- `go run ./cmd/atelier jobs`: the application caller of the callback, channel and goroutine job
  shapes in `app/jobs.go` (the last under `SafeRun`): `job callback: 4 handled`,
  `job channel: 1 handled`, `job goroutines x3: 12 handled`.
- The five route modules under `frameworks/` (gorilla/mux, chi, gin, echo, fiber), each serving
  `GET /api/orders` and `GET /api/orders/{id}` over the seeded state; no other lane carries them.

Lane-only ids (carried by this lane alone): 50. Sorted under rulings R13 and R14 of issue #223:
32 score a Go mechanism and carry a "Go-specific:" sentence in their note (the ids that count
toward the floor of 30); 12 are common candidates a sibling lane could carry unchanged
(`def-error-sentinel`, `def-method-value`, `def-method-expression`, `def-generic-two-params`,
`def-generic-struct-method`, `def-generic-free-function-extra-param`,
`def-generic-registry-instantiation`, `def-type-switch`, `def-anonymous-struct`,
`dir-interface-embeds-interface`, `def-shadowing-promoted-method`,
`resolution-same-name-package-support`); 6 are route variants (`def-route-default-mux` and the
five framework tasks), counted on the definition row only.

Lane-specific `kind` strings used in `expect` blocks: `structural`, `shadow_alias`, `same_name`,
`path_name_divergence`, `receiver`, `arity`, `init_order`, `embedded_field`, `lane_local`, `syntax_error`,
`parent_of`, `child_of`, `uses_self`, `one_of_two`, `dot_import`, `side_effect_only`,
`type_only`, `visibility_boundary`, `one_member`, `no_fanout`.

Counting rules: the `notes` of `bench/tasks.json` state one rule per count and count-bearing field.
In short, `exact_count` on an implementation or cardinality list counts concrete, non-generic,
unconditionally compiled types that satisfy the contract directly or through embedding;
interfaces, the embeddable bases in `atelier/support/` and anything behind a build tag are
excluded, and an interface whose method set contains the contract's is an optional site. The one
exception is `card-rule-contract`, which states `48` with `nominal_count: 24` (structs asserting
`RuleContract`) and `structural_count: 24` (the `AdHocRule` values, which assert nothing),
matching the typescript, javascript and python lanes; `impl-structural-no-assertion` asks about
the same method set by type and counts 25. A references `exact_count` counts lines, not uses.

## Integrations (E.2)

The Go extractors the tools under test ship (`bench/TOOL-SURFACE.md`, ruling R2 of issue #223) are
the route parsers net/http, gorilla/mux, chi, gin, echo and fiber (scored as the route tasks
above) and the HTTP client resty. No ORM, schema or serialization integration is listed for Go,
so none is owed here; `def-struct-tag` scores instead what Go's own `encoding/json` reads, the
string-keyed link from a JSON wire name (`body["reference"]` in a test) to the struct field whose
`json:"reference"` tag carries it.

- resty: a deliberate gap. The lane makes no outgoing HTTP call, so no resty call site exists for
  a task to start from, and a client written only to be scored would be a construct with no real
  use.

## Known-hard resolution classes (E.3)

| Class | Task ids |
| --- | --- |
| Dynamic dispatch | `def-trait-method-through-binding` (an interface method call answered under the container binding), `impl-structural-no-assertion`, `resolution-structural-concern` (satisfaction with no `implements` and no assertion) |
| String-keyed lookup | `def-struct-tag` (a JSON wire name to the field whose tag carries it), `refs-string-event-name` (`"repair.completed"`), `impl-exporter-contract` (exporters reached only by extension), `refs-report-registry` (reports by slug) |
| Alias divergence | `def-shadow-alias-billing`, `def-shadow-alias-reporting`, `def-import-alias`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting`, `resolution-package-path-vs-name`, `def-vendored-package-name`, `resolution-shadowed-stdlib-package`, `resolution-embedded-field-name` |
| Re-export chain | absent from the language: a Go package exports only what it declares, an import never re-exports, and the nearest form, a type alias `type X = pkg.Y`, declares a new name in the aliasing package that a definition answers on its own line; so no task is added |
| Generated code | `def-generated-file`, `hover-generated-marker` |
| Conditional compilation | `def-build-tag-gated` (the `//go:build darwin` / `!darwin` pair), `parse-negative-unclosed-class` and `parse-negative-bad-receiver` (behind the `brokenfixtures` tag) |

## Language server (E.5)

The language server this lane's stack starts is **gopls v0.24.0**
(the binary used was built by `go install golang.org/x/tools/gopls@v0.24.0` with go1.27.4,
as `go version -m` on it reports). `bench/lspcheck` runs it over stdio, with
`GOOS=linux` (the CI platform), on every `hover`, `document_symbol`, `call_hierarchy` and
`implementation` task, and `bench/lsp-check.md` is its committed report:

```
cd go
go run ./bench/lspcheck -gopls "$(go env GOPATH)/bin/gopls" -out bench/lsp-check.md
```

Result: 19 tasks, 19 agree, 0 disagree, 0 no answer. The server is compared with each key and
never used to make one; how each difference reads against the tree:

- `implementation`: where the server returns more locations than the key lists implementors
  (`impl-report-contract` 25 for 24, `impl-repository-generic` 9 for 8,
  `impl-structural-no-assertion` 26 for 25), every extra location is one of that task's
  `optional_sites` interfaces (notes rule 2), so the key stands.
- `document_symbol`: gopls names a method `(*RepairOrder).TransitionTo`; the key names the
  identifier, `TransitionTo`. The check's first run reported six "missing" methods of
  `docsym-repair-order` for that reason alone; the checker now matches the method name after the
  receiver, and no key changed.
- `hover-generated-marker` was re-anchored in this wave, from the tree, not from the server: the
  task sat on the `// Code generated ... DO NOT EDIT.` header line with a null symbol, and a
  comment holds no identifier to hover. The generator now writes the marker into the doc comment
  of the generated `Label` method, and the task hovers `Label`.

`bench/lspcheck`'s own test covers its framing, position, path, verdict and report logic with
recorded reply shapes, so it runs in CI, where no gopls is installed.

## License

MIT. Corpus content is clean-room for bench use.
