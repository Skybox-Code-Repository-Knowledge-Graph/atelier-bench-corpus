# atelier-bench-corpus / python lane

Accuracy-bench corpus for agent/tool evaluation over a real Python application graph.
Same repair-atelier domain as the other five lanes (customers, devices, repair orders, parts,
technicians), with deliberate **Python** language edges for definition/reference/resolution tasks:
the resolution problems Python creates that the other lanes cannot — decorators that graft
methods, `__getattr__` forwarding, multiple inheritance and the MRO, Protocols vs ABCs, string-keyed
`getattr`/`importlib` dispatch, PEP 562 module `__getattr__`, descriptors, name mangling, and type
hints as the only static-typing surface.

## Stack

| Piece | Pin / constraint |
| --- | --- |
| Python | `>=3.12` (CI runs 3.12; PEP 695 generics and `match` are used) |
| Layout | three importable packages at the lane root (`atelier_core`, `atelier_bench`, `atelier_app`); no build step, no install: run from the lane root |
| Dependencies | `requirements.txt` (runtime): `Flask==3.1.1`, and for the lane-only `atelier_frameworks/` `fastapi==0.165.0`, `Django==6.1.3`, `SQLAlchemy==2.1.9`, `pydantic==2.14.4`, every transitive dependency exact-pinned (31 distributions in both files, resolved for CPython 3.12 on Linux and macOS; no platform-marked dependency applies). `requirements-dev.txt`: `mypy==1.17.1` (type gate), `httpx2==2.16.2` (FastAPI's in-process `TestClient`), `pyright==1.1.414` (the pinned language server, `bench/lsp_check.py`) |
| Test runner | `unittest` (stdlib), `python -m unittest discover -s tests -t .` |
| Dataset | `Dataset.seeded()` — fixed rows, **no randomness**; revenue `58325c`, part cost `46300c`, gross profit `12025c` |

## Packages

| Package | Role | .py files |
| --- | --- | --- |
| `atelier_core/` | Domain: models, Money, enums, Protocols, container, events, policy, both `Formatter` halves, intake channels, the stock ledger (Python data-model hooks) | 41 |
| `atelier_bench/` | Breadth subsystem: 10 contracts, 8 concerns, 8 abstract bases, 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services, 48 rules, dataset, registry | 140 |
| `atelier_app/` | Application surface: Flask routes, console commands, jobs (callback / Future / async) | 12 |
| `atelier_frameworks/` | Lane-only framework modules: FastAPI routes (`fastapi_app.py`), a Django site (`django_site/`), a SQLAlchemy model (`orm.py`), Pydantic models (`schemas.py`) | 8 |
| `tests/` | 72 unittest tests incl. request-level (Flask test client, FastAPI `TestClient`, Django test `Client`), the every-file sweep, the module-specifier check and the language-server replay | 18 |
| `bench/` | `tasks.json` + `verify_tasks.py` (stdlib only) + `mypy-allowlist.txt` + `lsp_check.py` (stdlib only) + `lsp-check.md` | 5 |
| `fixtures/broken-syntax/` | Intentionally invalid Python, **DO NOT FIX** | 2 |

## Coverage map

| Surface | Where |
| --- | --- |
| Enums with methods | `atelier_core/support/{status,priority}.py` (`transitions_to`, `surcharge_bp`) — `str` Enums |
| Mixin class (MRO) vs class decorator (`setattr`) | `concerns/has_reference.py`: `Customer(HasReference)` inherits `reference()`; `@with_reference()` grafts the same methods onto `RepairOrder`, which has no base and no declaration (`def-mixin-method` asks the MRO half, `refs-decorator-usage` the decorator; `def-setattr-mixin` was retired in wave 3 as a near copy of `def-mixin-method`) |
| `__getattr__` forwarding | `concerns/forwards_to_schedule.py`: `technician.next_slot()` resolves to `Schedule` at runtime |
| Protocol (structural) + 2 implementors + container binding | `contracts/invoice_calculator.py`, `services/{standard,rush}_invoice_calculator.py`, `container.py` |
| Same-name shadow pair (aliases) | `billing/formatter.py` vs `reporting/formatter.py`, aliased in `atelier_app/state.py`, called in `http/report.py` |
| Barrel + relative imports + `TYPE_CHECKING` | `atelier_core/__init__.py` re-exports only; `if TYPE_CHECKING:` imports are type-only edges |
| Operator overloads, `__slots__`, `@classmethod` / `@staticmethod` | `money.py` |
| `@property` with setter | `support/schedule.py` |
| `@dataclass`, `NamedTuple`, `TypedDict`, `Enum` | `support/tree_node.py`, `contracts/report_contract.py`, `contracts/notifier_contract.py`, `models/note.py` |
| `__init_subclass__` registries | `models/device.py` (`Device.KINDS`), `atelier_bench/support/abstract_report.py` (`REGISTRY` → the 24-entry report registry, no hand-written list) |
| Structural pattern matching | `policy.py` (`case Actor(role=..., id=...)`) |
| PEP 695 generics, `@overload` | `support/pick.py`, `support/helpers.py`, `contracts/repository.py` |
| Multiple inheritance / MRO | `contracts/composite_contract.py` (three parent ABCs), `support/abstract_composite_report.py` (one base + two mixins), `reports/cash_flow.py` (diamond) |
| Descriptor, name mangling, `types.MethodType` rebinding | `support/abstract_notifier.py` |
| `functools.singledispatch` | `contracts/formatter_contract.py` (`format_cell`) |
| `@contextmanager`, generators, `async def`, `concurrent.futures` | `support/abstract_service.py`, `dataset.py` (`__iter__`), `atelier_app/jobs.py` |
| String-keyed dispatch | `services/order_volume_service.py` (`getattr(self, f"scope_{...}")`), `atelier_app/commands/export_report.py` (importlib table) |
| PEP 562 module `__getattr__` + dynamic `importlib.import_module` | `atelier_bench/__init__.py` (`RULES` supplied lazily; `load_report(slug)` unresolvable statically) |
| Star import with `__all__` | `atelier_bench/support/metric_glob.py` |
| String-named events | `atelier_core/events.py` (`dispatcher.on("repair.completed", ...)`) |
| Cardinality (exact-count fan-in) | `RuleContract` — 24 nominal subclasses + 24 structural `AdHocRule` values = 48; `ReportContract` — 24 concrete reports |
| Direction / import-precision / collision / multi-parent | tasks `dir-*`, `imp-*`, `lane-local-*`, `parents-*` in `bench/tasks.json` (same ids as the other lanes) |
| Same-name functions in two modules | `atelier_app/commands/recalculate_inventory.py` vs `atelier_app/jobs.py` |
| HTTP surface (Flask) | `atelier_app/__init__.py`: `GET /report/<reference>`, `GET /api/orders`, `POST /api/orders/<id>/notes`, `GET /api/reports/<slug>`, `GET /health` |
| Tests (incl. request-level) | 72 unittest tests: money, lifecycle, forwarding, shadow pair, events, structure, breadth, http, console (all four command spellings), jobs, intake, lane-only uses, frameworks, Python hooks, the language-server replay, the every-file sweep, module specifiers |
| Guards no other gate runs | `tests/test_module_specifiers.py` resolves every import (`TYPE_CHECKING` and function-local ones included), every dotted `atelier_*` path and every `.py` path (brace lists expanded) written in any string constant, docstring or comment, the literal prefix of every `import_module(...)` argument, and every dotted string in a `*MODULES*` table, over `atelier_core`, `atelier_bench`, `atelier_app`, `atelier_frameworks`, `tests` and `bench`; `tests/test_every_file.py` imports every module on disk and calls what the other tests never reach, so the whole suite runs every function body in the four packages that has something to run at least once (measured with `sys.settrace` over the suite in wave 3: 201 files, 566 bodies, none left unrun; the 17 bodies that are a bare `...`, abstract and overload stubs, never run) |
| Broken-syntax fixtures | `fixtures/broken-syntax`, **DO NOT FIX** (outside every package; `--lint` requires them to fail `py_compile`) |
| Document-symbol + call-hierarchy | `atelier_core/models/repair_order.py` (18 named symbols) and `atelier_bench/__init__.py` (8) for the symbol listing; `complete` → `transition_to`, three of the four functions that call `transition_to`, and `atelier_app.commands.recalculate_inventory` → `atelier_core` `SendCompletionNotice.subscribe` for the call graph |
| Metaclass method, virtual subclass, `_missing_`, `__post_init__`, `__call__`, `cached_property` | `atelier_core/support/intake.py`; the `Schedule.capacity` setter's only write site is `Technician.set_capacity` in `models/technician.py` |
| Python data-model hooks no call site names | `atelier_core/support/stock_ledger.py`: `Sku.__new__` (a `str` subclass, no `__init__`), `Ledger.__enter__` / `__aenter__` and the `as` binding to the `LedgerSession` they return, `Ledger.__contains__`, `MovementTotals.__missing__`, `StockLevel.__bool__` / `__format__` / `__radd__` (through `sum()`), `Interned.__call__` (the metaclass behind `Bin(...)`), `Shelf.__class_getitem__`, `Countable.__subclasshook__`, `Ledger.__reversed__`; `@total_ordering` filling in `Money.__ge__` from `__lt__` (`money.py`); `Endpoint.__set_name__` (`atelier_bench/support/abstract_notifier.py`); the 26 class statements that run `AbstractReport.__init_subclass__` |
| Frameworks other than Flask (lane-only) | `atelier_frameworks/`: FastAPI (`fastapi_app.py`: `@router.get` / `@router.post` path operations, a Pydantic body, a `Depends` session), Django (`django_site/urls.py` `urlpatterns`, `views.py`), SQLAlchemy (`orm.py`: `Mapped` columns, `ForeignKey("parts.sku")`, `relationship(back_populates=...)`), Pydantic (`schemas.py`: `Field`, `@field_validator`) |

## Consumption (runner)

1. Check out the pinned SHA.
2. `cd python && pip install -r requirements-dev.txt` (exact pins; `requirements.txt` alone is enough to run the app).
3. No remote artifacts beyond PyPI, no SSH private remotes, no secrets. The one exception is optional and outside CI: `bench/lsp_check.py` runs pyright on the node found on PATH, and with no node there the pyright wheel's nodeenv downloads one on first run.

Local use (from `python/`):

```bash
python3 -m unittest discover -s tests -t . -v   # 72 tests
python3 -m atelier_app seed                      # summary + 16 metric lines + rules line
python3 -m atelier_app export-report gross-profit   # csv export
python3 -m atelier_app recalculate-inventory         # "recalculated 1 part(s)"
python3 -m atelier_app serve 8080
```

### Lane-only extras

Not part of the shared set (`bench/S-PLUS-CHECKLIST.md` B.5), listed so a parity check can tell them apart:

| Extra | Where |
| --- | --- |
| Command spellings `report [slug]` and `recalculate` | `atelier_app/commands/__init__.py`: aliases that parse to the same commands as the shared names `export-report` and `recalculate-inventory` (`tests/test_console.py` runs both spellings of each through `main`) |
| FastAPI routes `GET /api/parts/low-stock`, `GET /api/parts/{sku}`, `POST /api/parts/{sku}/adjustments` | `atelier_frameworks/fastapi_app.py` (not mounted on the Flask app; `tests/test_frameworks.py` drives them through `TestClient`) |
| Django routes `customers/<int:customer_id>/orders/` (`customer-orders`) and `parts/low-stock/` (`low-stock-parts`) | `atelier_frameworks/django_site/urls.py` (`tests/test_frameworks.py` drives them through Django's test `Client`) |
| SQLAlchemy models `PartRow`, `StockMovementRow`; Pydantic models `PartOut`, `StockAdjustment` | `atelier_frameworks/orm.py`, `atelier_frameworks/schemas.py` |
| Stock ledger (`Ledger`, `LedgerSession`, `Sku`, `StockLevel`, `MovementTotals`, `recount`, `recount_async`) | `atelier_core/support/stock_ledger.py` (`tests/test_python_hooks.py`) |

## Ground truth

| Artifact | Role |
| --- | --- |
| `bench/tasks.json` | 115 needle-based accuracy tasks (`from` → `expect` file/needle pairs): 59 definition, 15 resolution, 11 references, 6 import-precision, 5 implementation, 4 hover, 4 direction, 3 call_hierarchy, 2 document_symbol, 2 cardinality, 2 multi-parent, 2 parse-negative; 50 of the ids are carried by this lane alone (see Lane-only ids) |
| `bench/verify_tasks.py` | Self-check that every task needle still resolves to exactly one line, each `optional_sites` needle to one line and each `repeated_sites` needle to exactly its `lines` count; **standard library only** |
| Lane-specific `kind` strings (each defined in the `notes`) | `barrel`, `class_creation_hook` (`__init_subclass__`), `class_getitem`, `context_enter` (`with` / `async with` entry and the `as` binding), `context_manager`, `dataclass_generated`, `dataclass_hook` (`__post_init__`), `descriptor`, `dunder_new`, `dynamic_attribute` (`__getattr__` forwarding), `enum_missing` (`Enum._missing_`), `field_validator` (pydantic), `foreign_key` (SQLAlchemy), `forward_annotation` (a type written as a string), `glob`, `metaclass` (method defined on the metaclass), `metaclass_call`, `missing_hook` (`dict.__missing__`), `module_getattr` (PEP 562), `mro`, `name_mangling`, `name_only`, `namespace_import`, `operator_hook` (`in`, truth test, format spec, reflected `__radd__`), `pattern_match`, `property`, `relative_import`, `same_name`, `set_name_hook`, `shadow_alias`, `singledispatch`, `string_key`, `structural`, `subclass_hook`, `syntax_error`, `total_ordering`, `type_only`, `virtual_subclass` (registered at runtime, no inheritance edge) |
| `bench/mypy-allowlist.txt` | The exact `mypy` diagnostics `--lint` accepts (5 at the pinned version: the setattr-grafted `reference()`/`reference_number` the lane exists to exercise); regenerate with `--lint --write-allowlist` |

```bash
python3 bench/verify_tasks.py            # resolve every file+needle pair
python3 bench/verify_tasks.py --lint     # py_compile over the lane + broken-fixture guard + mypy allowlist gate (needs requirements-dev)
python3 bench/verify_tasks.py --root <dir>   # verify another lane-shaped directory (used by bench/check-matrix.mjs)
```

Task `file` paths are relative to this lane root (`python/`), not to the repository root.

**Regenerate discipline:** any edit under `atelier_*/`, `tests/` or `fixtures/` must leave
`python3 bench/verify_tasks.py` at **exit 0**. If needles move, update `bench/tasks.json` in the same change.

## Lane-only ids

50 ids are carried by this lane alone. Sorted under rulings R13 and R14 (issue #223):

| Outcome | Count | Ids |
| --- | --- | --- |
| Python-specific, the note names the mechanism | 29 | `def-descriptor`, `def-enum-missing-hook`, `def-init-subclass-registry`, `def-metaclass-method`, `def-module-getattr`, `def-name-mangling`, `def-post-init`, `def-singledispatch`, `def-context-manager`, `def-dataclass-field`, `dir-mro-linearization`, `resolution-diamond-mro`, `impl-intake-contract`, `refs-cached-property`, `def-with-enter`, `def-enter-as-target`, `def-async-enter`, `def-dict-missing`, `def-dunder-contains`, `def-dunder-bool`, `def-set-name-hook`, `refs-init-subclass-hook`, `def-metaclass-call`, `def-class-getitem`, `def-subclass-hook`, `def-dunder-reversed`, `def-string-forward-annotation`, `resolution-sqlalchemy-foreign-key`, `resolution-pydantic-field-validator` |
| Python-specific by a note sentence | 3 | `parse-negative-bad-indent`, `def-namedtuple-field`, `hover-cached-property` |
| Route variants (R3; not counted toward the 30) | 2 | `def-route-fastapi`, `def-route-django` |
| Common candidates (a sibling lane could ask the same question unchanged; not counted, source untouched) | 16 | `def-dynamic-import-module` (javascript, typescript), `def-super-cooperative` (typescript, javascript, php), `def-future-style` (javascript, typescript, rust), `def-generic-pep695` (typescript, rust, go), `def-match-class-pattern` (rust), `def-property` (javascript, typescript), `resolution-property-setter` (javascript, typescript), `def-string-key-dispatch` (javascript, typescript, php), `def-string-key-exporter` (javascript, php), `def-typed-dict-key` (typescript, rust, go), `imp-relative-import` (typescript, javascript, rust), `refs-dunder-call` (php), `def-dunder-new` (javascript, typescript, php: a construction call lands on the constructor), `def-dunder-format` (go `fmt.Formatter`, php `__toString`, javascript `toString`), `def-reflected-radd` (rust `impl Add<X> for i32`), `def-total-ordering` (rust: `>=` runs `PartialOrd::ge`, derived from `partial_cmp`) |

The floor of 30 one-lane ids is met by the 32 Python-specific ones alone (margin 2, ruling of 2026-11-26T20:53Z).

## Indexer surface

The tools under test and their python extractors, from `bench/TOOL-SURFACE.md` (rulings R1 to R3): routes FastAPI, Flask, Django; ORM and schema SQLAlchemy, Pydantic. Each is scored, so this lane names no deliberate gap.

| Extractor | Scored by |
| --- | --- |
| Flask routes (the lane's main framework, `atelier_app/__init__.py`) | `def-route-to-handler` |
| FastAPI routes (`atelier_frameworks/fastapi_app.py`) | `def-route-fastapi` |
| Django routes (`atelier_frameworks/django_site/urls.py`) | `def-route-django` |
| SQLAlchemy (`atelier_frameworks/orm.py`) | `resolution-sqlalchemy-foreign-key` |
| Pydantic (`atelier_frameworks/schemas.py`) | `resolution-pydantic-field-validator` |

Known-hard resolution classes (checklist E.3), each exercised:

| Class | Task ids |
| --- | --- |
| Dynamic dispatch | `def-metaclass-call`, `def-subclass-hook`, `def-dunder-reversed`, `def-class-getitem`, `def-singledispatch`, `def-proxy-forwarded-method`, `impl-intake-contract`, `def-with-enter`, `def-enter-as-target`, `def-async-enter`, `def-dunder-contains`, `def-dunder-bool`, `def-dunder-format`, `def-reflected-radd`, `def-dict-missing` |
| String-keyed lookup | `def-string-forward-annotation`, `def-string-key-dispatch`, `def-string-key-exporter`, `def-module-getattr`, `refs-string-event-name`, `resolution-sqlalchemy-foreign-key`, `resolution-pydantic-field-validator` |
| Alias divergence | `def-import-alias`, `def-shadow-alias-billing`, `def-shadow-alias-reporting`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting` |
| Re-export chain | `def-through-barrel`, `imp-barrel-no-fanout`, `imp-glob-import` |
| Generated code | `def-dataclass-field`, `def-namedtuple-field`, `def-post-init`, `def-total-ordering`, `def-init-subclass-registry`, `refs-init-subclass-hook` |
| Conditional compilation | Python compiles nothing conditionally; its counterpart is the import under `if TYPE_CHECKING:`, which never runs: `resolution-type-only-import`, `imp-type-only-no-value-edge` |
| Runtime-built import | `def-dynamic-import-module` |

E.4 (a task the indexer is known to get wrong) follows the key freeze (ruling R4) and is not part of this README yet.

## Language server

| Server | Pin | Check |
| --- | --- | --- |
| pyright 1.1.414 | `pyright==1.1.414` in `requirements-dev.txt`; the wheel bundles that pyright build and runs it on node | `python bench/lsp_check.py` (from `python/`, in the lane's venv) starts the venv's `pyright-langserver --stdio` over the `hover`, `document_symbol`, `call_hierarchy` and `implementation` keys and writes `bench/lsp-check.md` |

Committed run (`bench/lsp-check.md`): 14 tasks, 7 agree (4 hover, 3 call_hierarchy), 2 disagree, 5 with no answer.

- Both disagreements are `document_symbol`: the server also lists parameters, locals and attributes assigned through `self`, which the notes' document-symbol rule excludes. Every key name is in the server's list, so the keys are right by the tree and stay as they are.
- The 5 with no answer are the `implementation` tasks: pyright answers `-32601 Unhandled method textDocument/implementation`. Those keys rest on the class statements read from the tree.
- No key was changed because of the server.

The live run needs node and is not part of CI. `tests/test_lsp_check.py` replays recorded replies through the script's comparison and report code, and checks that the committed report lists every task of the four surfaces.

## License

MIT. Corpus content is clean-room for bench use.
