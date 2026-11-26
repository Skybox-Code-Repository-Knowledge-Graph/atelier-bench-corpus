# atelier-bench-corpus / rust lane

Accuracy-bench corpus for agent/tool evaluation over a real Rust application graph.
Same repair-atelier domain as the `php/` lane (customers, devices, repair orders, parts,
technicians), with deliberate **Rust** language edges for definition/reference/resolution tasks.

## Stack

| Piece | Pin / constraint |
| --- | --- |
| Rust | `1.96.0`, pinned in `rust-toolchain.toml` |
| Edition | 2024 (workspace `rust-version` floor is 1.85) |
| Layout | cargo workspace, 3 library/binary crates + 1 dependency-free verifier |
| Dataset | `Dataset::seeded()` — fixed rows, **no randomness** in the corpus seed path |
| Vendor breadth | axum, tokio, tower, serde, serde_json, chrono, uuid, indexmap, itertools, rayon, once_cell, thiserror, anyhow, tracing, tracing-subscriber — present so cross-crate resolution into `~/.cargo/registry` is exercised, not for domain depth |
| Language server | rust-analyzer `1.96.0 (ac68faa 2026-05-25)`: the `rust-analyzer` rustup component of the pinned toolchain (`rustup component add rust-analyzer` from this directory); box E.5 below |

Build from the **committed** `Cargo.lock` only (`cargo build --locked`). Do not freestyle
`cargo update` on a bench machine if you need bit-stable ground truth.

## Crates

| Crate | Role | .rs files under `src/` |
| --- | --- | --- |
| `crates/atelier-core` | Domain: models, enums, traits, container bindings, money, errors | 45 |
| `crates/atelier-bench` | Breadth subsystem: 8 contracts, 8 concerns, 7 bases, 76 implementors | 149 |
| `crates/atelier-app` | Application surface: axum router, console commands, jobs | 14 |
| `bench/verify-tasks` | Ground-truth self-check; **zero third-party dependencies** | 2 |

## Coverage map

| Surface | Where |
| --- | --- |
| Enums with methods | `crates/atelier-core/src/support/{status,priority}.rs` (`transitions_to`, `surcharge_bp`) |
| Trait with a default body, reused | `concerns/has_reference.rs` implemented by `Customer` + `RepairOrder` |
| Associated const, overridden per impl | `HasReference::PREFIX` defaults to `ATELIER_REF_PREFIX`; `Customer` and `Voucher` override it (`"CU"`, `"VO"`); the trait's default bodies read it through `Self::PREFIX` |
| Trait + 2 impls + container binding | `contracts/invoice_calculator.rs`, `services/{standard,rush}_invoice_calculator.rs`, `Arc<dyn ...>` in `container.rs` |
| Same-name shadow pair (aliases) | `billing::Formatter` vs `reporting::Formatter`, aliased in `atelier-app/src/state.rs` and called in `http/report.rs` |
| `Deref` method forwarding | `Technician` → `Schedule`: `technician.next_slot()` has no declaration on `Technician` |
| `macro_rules!`-generated methods | `support/macros.rs` → `forwards_to_schedule!(Technician)` generates `peek_next_slot` / `book_next_slot` |
| Blanket impl (local bound) | `concerns/has_formatting.rs`: `impl<T: ReportContract> HasFormatting for T` |
| Blanket impl (foreign bound) | `concerns/has_serialization.rs`: `impl<T: serde::Serialize> HasSerialization for T` |
| Re-export chain | `atelier-core/src/lib.rs` `pub use` block — definition must land on the declaring module |
| Operator overloads + newtype | `money.rs`: `Add`/`AddAssign`/`Sub`/`Mul`/`Sum`/`Display`/`FromStr` on `Money` |
| Extension trait on a primitive | `money.rs`: `impl MoneyExt for i64` — `1_500_i64.cents()` |
| Associated types | `contracts/repository.rs` (`type Id` / `type Record`), pinned by 8 implementors cross-crate |
| Trait objects + registry fan-in | `atelier-bench/src/lib.rs`: `Lazy<Vec<Box<dyn ReportContract>>>` with 24 entries |
| Error enum + `?` conversions | `errors.rs` (`#[from] ParseMoneyError`, `#[from] serde_json::Error`) |
| Events / listener / observer / policy / job | `events.rs`, `observers.rs`, `policy.rs`, `atelier-app/src/jobs.rs` |
| Async + HTTP surface | `atelier-app/src/lib.rs` router; handlers in `http/{report,api}.rs`; `IntoResponse` in `http/errors.rs` |
| Parallel iteration (rayon) | `services/revenue_service.rs::metric_sweep` — also what forces `MetricContract: Send + Sync` |
| Wide contract implementation | 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services |
| Deterministic seed | `atelier-bench/src/dataset.rs::seeded` — revenue `58_325c`, part cost `46_300c`, gross profit `12_025c` |
| Tests (incl. request-level) | 104 tests: domain lifecycle, shadow pair, Deref/macro forwarding, not-found conversion, breadth registry, every exporter and notifier plus the repositories, services, timestamp concern and device observer no other test reaches (`tests/every_component.rs`, each asserting hand-computed seed values), the core models no other test reaches (`tests/every_model.rs`), canonical-parity constructs, open-order iterator, topic subscription, axum routes (the generic export route included), console commands under both spellings and the binary itself, the verifier's JSON parser and key checks; plus the feature-gated rule under `--features extra-rules` (40). `bench/lsp-check.test.mjs` (6, node) covers the language-server check. Reach, measured by stripping comments and strings, ignoring names declared in two files, and looking for each `src/` file's public names (or its module path) in test-reached code: every file is found that way except `rules/generated.rs` (its types come from `define_rules!`; the `RULES` registry names them and `support/rule_summary.rs`'s test evaluates all 48), `concerns/forwards_to_schedule.rs` (a `Deref` impl, run by `technician.next_slot()` in `tests/schedule_forwarding.rs`), `main.rs` (spawned through `CARGO_BIN_EXE` in `tests/console.rs`) and the `mod.rs` / `lib.rs` / `prelude.rs` files that hold only `mod` and `use` lines |
| Build-script generated item | `crates/atelier-core/build.rs` writes `generated_units()` into `OUT_DIR`; `support/generated_units.rs` splices it in with `include!` — no textual definition under `src/` |
| `#[path]` module | `support/mod.rs`: `#[path = "pathed/tally_sheet.rs"] pub mod ledger;` — module name and file name differ |
| Lifetimes, HRTB, GAT | `support/borrowed.rs` (`Borrowed<'a>`, `for<'x> Fn(&'x str)`), `support/lender.rs` (`type Loan<'a> where Self: 'a`) |
| Broken-syntax fixtures | `fixtures/broken-syntax`, **DO NOT FIX** (negative cases; outside every crate, so cargo never sees them) |
| Shared-id mapping: `parse-negative-unclosed-class` | Rust has no classes; the same question (a type body left open) is asked by lane-local `parse-negative-unclosed-impl` (`fixtures/broken-syntax/unclosed_impl.rs`) |
| Cardinality: macro-generated half of a wide contract | `contracts/rule_contract.rs` + `rules/`: 48 `RuleContract` implementors, 24 textual (one file each) + 24 from `define_rules!` in `rules/generated.rs` |
| Direction: parent/child/self-reference/inherent | `dir-contract-parent`/`dir-implementor-child` (`ReportContract` ↔ `CashFlowReport`), `support/expr.rs` (`Expr` self-reference), `money.rs` inherent `impl Money` |
| Import-precision: one-of-siblings, cross-crate, glob | `support/pair.rs` (`Left`/`Right`, only `Left` imported), `dataset.rs` (`Money` without `ParseMoneyError`), `support/report_glob.rs` (`use ...report_contract::*;`) |
| Collision: lane-local identifiers | `Money`, `Customer`, `Dataset`, `ATELIER_REF_PREFIX`, `InvoiceCalculator::calculate`, `billing::Formatter` — same names exist in the php/typescript/javascript lanes |
| Multi-parent: three-way supertrait fan-in | `contracts/composite_contract.rs`: `CompositeContract: ReportContract + CacheableContract + ScheduleContract`, implemented by `CashFlowReport`; `&dyn CompositeContract` upcasts to `&dyn ReportContract` |
| Breadth: const generics, closures, async traits, cfg-gating | `support/grid.rs`, `support/closure_predicate.rs`, `support/pair_map.rs`, `support/rule_summary.rs` (`#[derive(Serialize)]`), `atelier-app/src/async_check.rs`, `rules/cfg_gated.rs`, `prelude.rs` + `rules_probe.rs` (two-level re-export) |
| Dedicated error type behind `#[from]` | `errors.rs`: `NotFoundError` is its own type; `AtelierError::NotFound(#[from] NotFoundError)` converts it, and `http/report.rs` constructs it at the lookup site |
| Multi-parent: one impl line, two inherited supertraits | `contracts/digest_contract.rs` (`DigestContract: HasAudit + HasMetadata`) implemented by `support/audit_digest.rs`'s `AuditDigest` |
| Structural look-alike that is NOT an implementor | `support/plain_row_formatter.rs`: `HasFormatting`'s method set declared inherently, no `impl HasFormatting`, and the `T: ReportContract` blanket does not reach it |
| Import-precision: barrel, type-position-only | `repositories/customer_repository.rs` (`use atelier_core::Customer;` through the crate-root `pub use`), `models/repair_order.rs` (`Container` named only in a signature) |
| Document-symbol + call-hierarchy | `crates/atelier-core/src/models/repair_order.rs` (31 named symbols) and `crates/atelier-bench/src/lib.rs` (16) for the symbol listing; `complete` → `transition_to`, three callers of `transition_to`, and `atelier-app` `commands::recalculate_inventory::run` → `atelier-core` `Dispatcher::register` for the call graph |
| Callback-style entry point | `atelier-app/src/jobs.rs`: `run_with_callback` takes the continuation as a parameter and forwards to `run` |
| Hand-written iterator (rust's generator) | `atelier-bench/src/dataset.rs`: `OpenOrders::next` is the yield point; `Dataset::open_labour_minutes` drives it with a `for` loop |
| Namespace-bound module import | `atelier-bench/src/support/rule_namespace_user.rs`: `use crate::rules;` binds the module, only `rules::RULES` is read |
| String-keyed subscription | `atelier-core/src/events.rs`: `Dispatcher::on` matches on a topic literal; `DomainEvent::topic` writes the same literal per variant |
| Axum route variant: generic handler | `atelier-app/src/lib.rs` registers `GET /api/exports/{slug}` as `get(http::api::export_rows::<CsvExporter>)`; `http/api.rs` declares `export_rows<E: ExporterContract + Default>` |
| `?` conversion and `IntoResponse` | `http/report.rs` `show`: the `?` on a `NotFoundError` converts through `impl From<NotFoundError> for ApiError`, and axum turns the `ApiError` into the response through `impl IntoResponse for ApiError` (`http/errors.rs`) |
| Trait brought into scope for its methods | `atelier-bench/tests/breadth.rs`: `use ...::has_formatting::HasFormatting;` is never written again; `report.format_value(1.5)` resolves because of it |
| References of macro, macro-generated and cfg-gated items | `forwards_to_schedule!` (3 sites), the macro-generated `book_next_slot` (4 calls), the `extra-rules`-gated `ExperimentalRule` (2 sites) |

## Consumption (runner)

1. Check out the pinned SHA.
2. `cargo build --locked` (no unlock, no update).
3. No remote artifacts beyond crates.io, no SSH private remotes, no secrets.

Local use:

```bash
cargo test --workspace          # 104 tests
cargo test -p atelier-bench --features extra-rules   # 40 tests, incl. the feature-gated ExperimentalRule
RUSTDOCFLAGS="-D rustdoc::broken_intra_doc_links" \
  cargo doc --workspace --no-deps --document-private-items --all-features   # every intra-doc link resolves
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p atelier-app -- serve 8080
cargo run -p atelier-app -- seed
cargo run -p atelier-app -- export-report gross-profit
cargo run -p atelier-app -- recalculate-inventory
node --test bench/lsp-check.test.mjs                 # the language-server check's own tests
rustup component add rust-analyzer && node bench/lsp-check.mjs   # box E.5 report
```

HTTP surface: `GET /report/{reference}` (e.g. `AT-2026-000001`), `GET /api/orders`,
`GET /api/reports/{slug}`, `POST /api/orders/{id}/notes`, `GET /health`, plus the lane-only
`GET /api/exports/{slug}` (below).

## Ground truth

| Artifact | Role |
| --- | --- |
| `bench/tasks.json` | 104 needle-based accuracy tasks (`from` → `expect` file/needle pairs): 59 shared canonical ids (three or more lanes), 3 two-lane ids (`def-crate-const`, `parse-negative-bad-generics`, `refs-rule-registry`) and 42 one-lane ids (box D.2 below) |
| `bench/lsp-check.mjs` | Runs rust-analyzer over the hover, document_symbol, call_hierarchy and implementation keys and prints one verdict per task; never changes a key. Its committed output is `bench/lsp-check.md` |
| `bench/verify-tasks` | Self-check that every task needle still resolves to exactly one line (`optional_sites` included), every `repeated_sites` needle to exactly its `lines` count (a whole number, 2 or more), every references `exact_count` equals its `known_sites` entries plus the sum of `lines` with no line counted twice, and every `must_not_include` entry written as text or as a `.*` pattern occurs on a code line (not a `//` comment) of the lane's sources |

```bash
cargo run -p bench-verify           # resolve every file+needle pair
cargo run -p bench-verify -- --lint # cargo check + broken-fixture guard
```

The verifier has **no third-party dependencies** — it ships its own JSON reader — so it also runs
on a machine that has never fetched the corpus dependency tree:

```bash
# run from this lane root: without cargo it resolves task paths against the cwd
rustc --edition 2024 bench/verify-tasks/src/main.rs -o /tmp/bench-verify && /tmp/bench-verify
```

Task `file` paths are relative to this lane root (`rust/`), not to the repository root.

**Regenerate discipline:** any edit under `crates/` or `fixtures/` must leave
`cargo run -p bench-verify` at **exit 0**. If needles move, update `bench/tasks.json` in the same
change (bench lane owns `bench/`; crate lanes keep needles green).

## Lane-only extras

| Extra | What it is |
| --- | --- |
| `report [slug]`, `recalculate` | This lane's older spellings of the shared `export-report` and `recalculate-inventory` commands; both still parse to the same command |
| `serve [port]`, `seed` | Start the HTTP surface; print the seed summary |
| `GET /api/exports/{slug}` | One registered report as CSV through the generic handler `export_rows::<CsvExporter>`: the axum route variant of box E.1 |

## One-lane ids (box D.2)

Each of the 42 ids only this lane carries is sorted under ruling R13. Outcome 1 (33): the path from
the asked line to the keyed answer applies a resolution rule only Rust has, and the task's note
names it in one sentence. Outcome 2 (8, common candidates other lanes could carry unchanged):
`def-cross-crate-trait`, `def-error-conversion`, `def-registry-entry`, `def-serde-tagged-enum`,
`def-impl-trait-return`, `def-lifetime-struct`, `def-hrtb-bound`, `def-reexport-two-levels`.
Route variant (1): `def-route-axum-generic-handler`. Ids that only repeated a question the lane
already asks were retired in wave 3.

## Indexer surface (box E)

The tools under test are skybox at the version `.github/workflows/score-tools.yml` pins (ruling R1);
for Rust its published framework extractors are "Axum routes, Reqwest HTTP" (ruling R2,
`bench/TOOL-SURFACE.md`).

- **E.1 route parsers.** Axum, the only one listed: `def-route-to-handler` (`GET /report/{reference}`
  → `http::report::show`) and the lane-local variant `def-route-axum-generic-handler`
  (`GET /api/exports/{slug}` → the generic `export_rows`, instantiated by turbofish at the route).
- **E.2 integrations.** No ORM, schema or serialization integration is listed for Rust, and the stack
  has no ORM (no diesel, sqlx or sea-orm in any manifest), so none is scored as an integration; the
  three serde tasks (`def-serde-tagged-enum`, `impl-derived-serialize`,
  `resolution-foreign-bound-blanket`) score serde's derive and its blanket trait bound as Rust
  resolution. Reqwest HTTP is a deliberate gap: the lane makes no outbound HTTP call, and adding
  reqwest would pull an HTTP client and TLS stack into a lockfile that must install offline.
- **E.3 known-hard classes.** Dynamic dispatch: `lane-local-calculate`,
  `def-trait-method-through-binding`, `resolution-dyn-upcast`. String-keyed lookup:
  `refs-string-event-name`. Alias divergence: `def-shadow-alias-billing`,
  `def-shadow-alias-reporting`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting`,
  `lane-local-formatter-billing`. Re-export chain: `def-reexport-two-levels`,
  `imp-barrel-no-fanout`. Generated code: `def-build-script-generated`, `def-macro-generated-method`,
  `def-macro-repetition-impl`, `refs-macro-generated-method`, `hover-macro-generated`,
  `impl-derived-serialize`. Conditional compilation: `def-cfg-gated`, `refs-cfg-gated-type`,
  `card-rule-contract` (excludes `ExperimentalRule` and `AlwaysTrueRule`). Every class Rust has is
  present, so no task was added for this box.
- **E.5 language server.** The stack starts rust-analyzer `1.96.0 (ac68faa 2026-05-25)`, the
  component of the toolchain `rust-toolchain.toml` pins. The `rust` job of
  `.github/workflows/corpus.yml` installs it and runs `node bench/lsp-check.mjs` over every hover,
  document_symbol, call_hierarchy and implementation task; `bench/lsp-check.md` is that run's output
  with its run id. Where the server and a key disagree the tree decides and the report says so; no key
  is changed to match the server.

## License

MIT. Corpus content is clean-room for bench use.
