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
| Layout | one module, `atelier.example/lane`, packages under `core/`, `atelier/`, `app/`, `cmd/`, `internal/`, `tools/`; run every command from the lane root (`go/`) |
| Dependencies | none over the network: the only `require` is the in-tree module `atelier.example/yamlish.v2`, resolved by a `replace` to `./third_party/yamlish.v2`, so there is no `go.sum` |
| Test runner | `go test ./...` (stdlib `testing`): 59 tests, 47 in `tests/` plus in-package tests for the three `main` packages (`bench/verify` 9, `cmd/atelier` 2, `tools/statusgen` 1) |
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
| `bench/` | `tasks.json` + `verify/` (stdlib only) and its test | 4 |
| `third_party/yamlish.v2/` | In-tree module whose import path last segment (`yamlish.v2`) differs from its package name (`yamlish`) | 1 |
| `fixtures/broken-syntax/` | Intentionally invalid Go, **DO NOT FIX** (build-tag gated) | 3 |

## Coverage map

| Surface | Where |
| --- | --- |
| Method promotion, one level (embedded pointer) | `core/models/technician.go` embeds `*support.Schedule`; `technician.BookSlot(0)` resolves to `core/support/schedule.go` |
| Method promotion, two levels | `Technician` embeds `Staff`, `Staff` embeds `concerns.HasReference`; `technician.Reference()` is declared on neither |
| Method promotion, four levels | `reports.CashFlowReport` → `support.CompositeReport` → `PeriodicReport` → `BaseReport` → `concerns.HasCache`; `cashFlow.CacheKey()` on the concrete `*reports.CashFlowReport` (`tests/promotion_test.go`) |
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
| Shared-id mapping: `parse-negative-unclosed-class` | Go has no classes; the same question (a type body left open) is asked by lane-local `parse-negative-unclosed-struct` (`fixtures/broken-syntax/unclosed_struct.go`) |

## Consumption (runner)

```
cd go
go build ./...
go test ./...
go run ./bench/verify          # 108 tasks, exit 0
go run ./bench/verify --lint   # build + broken-fixture guard (each file must fail to parse) + go vet + module specifiers + gofmt
go run ./cmd/atelier seed      # seeded: 3 customer(s), 4 order(s), 4 part(s), revenue 58325c, then one line per metric, the rule tally and one line per service row
```

No network access is needed: the single dependency is replaced by an in-tree path, so `go build`
never contacts a module proxy. `go generate ./core/support` must reproduce
`core/support/status_labels_gen.go` byte for byte; `tools/statusgen`'s test checks it.

`--lint` also resolves every module specifier written anywhere in the lane, whatever the build
constraint: import specs (broken fixtures and the darwin half of the build-tag pair included), the
package of each `//go:generate go run` directive, each `//go:embed` pattern, lane module paths and
doc links in comments, and `go.mod`'s require and replace lines.

## Ground truth

`bench/tasks.json` carries 108 needle-based tasks. `bench/verify` resolves every `file` + `needle`
pair to exactly one line, checks that each `repeated_sites` needle matches exactly its `lines`
lines, and prints one `<id>: OK (from <file>:<line> -> <n> expect needles resolved)` line per task;
its stdout contract is byte-identical to the other five lanes' verifiers, which
`node bench/check-matrix.mjs` proves against `bench/conformance/expected.txt` and
`bench/verify`'s own test checks in this lane's CI job.

Lane-specific `kind` strings used in `expect` blocks: `structural`, `shadow_alias`, `same_name`,
`path_name_divergence`, `receiver`, `arity`, `init_order`, `lane_local`, `syntax_error`,
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

## License

MIT. Corpus content is clean-room for bench use.
