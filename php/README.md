# atelier-bench-corpus / php lane

Accuracy-bench corpus for agent/tool evaluation over a real Laravel + Filament application graph.
Same repair-atelier domain as the `rust/` and `typescript/` lanes (customers, devices, repair
orders, parts, technicians), with deliberate **PHP / Laravel / Livewire / Filament** edges for
definition/reference/resolution tasks. The shared lane contract lives in [`../README.md`](../README.md).

Clean-room, **zero code copied** from any prior fixture (operator order 2026-07-16).

## Stack

| Piece | Pin / constraint |
| --- | --- |
| PHP | `^8.3` |
| Laravel | **13.20** (`laravel/framework` ^13.8; runtime verified 13.20.x) |
| Filament | **5.6** (`filament/filament` ^5.6) |
| Database | SQLite (`database/database.sqlite`; tests run on `:memory:`) |
| Seeder | Deterministic fixed rows in `DatabaseSeeder` — **no faker randomness** in the corpus seed path |
| First-party vendor breadth | 43 laravel/livewire/filament packages in the lock (operator order 2026-07-16): horizon, telescope*, sanctum, passport, cashier, scout, socialite, fortify, pennant, pulse*, reverb, octane, folio, slack-notification-channel, volt, flux, the three Filament spatie plugins, plus dev: dusk, breeze, envoy, sail. *Telescope/Pulse ship disabled via env (no migrations run); packages are present for vendor-resolution benchmarking, not wired into app behavior. |

Install from the **committed** `composer.lock` only (`composer install`). Do not freestyle
`composer update` on a bench machine if you need bit-stable ground truth.

## Layout

| Path | Role | .php files |
| --- | --- | --- |
| `app/` | Domain models, enums, concerns, services, events, policies, jobs, HTTP + Livewire + Filament surfaces | 281 |
| `app/Bench/` | Breadth subsystem: 11 contracts, 8 concerns, 7 abstract bases, 24 reports (+ `ReportRegistry` fan-in), 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services, 48 rules | 152 |
| `database/` | Migrations, factories, deterministic `DatabaseSeeder`, delegating `CanonicalSeeder` | 41 |
| `routes/` | `web.php`, `api.php`, `console.php` | 3 |
| `resources/views/` | Report view, Blade components, Livewire SFC, Filament pages | 12 |
| `tests/` | Feature + Unit suite (111 tests), Dusk scaffold | 26 |
| `bench/` | `tasks.json` + `verify_tasks.php` self-check; the needle check has **zero composer dependencies** (the `--lint` Blade fixture check needs `vendor/`); `lsp_check.php` and its report `lsp-check.md` (section E.5) | 2 |
| `fixtures/broken-syntax/` | Intentionally invalid PHP + Blade, **DO NOT FIX** | 2 |

## Coverage map

| Surface | Where |
| --- | --- |
| Enums with methods | `app/Enums` (`Priority`, `RepairStatus`) |
| Trait reuse | `app/Concerns/HasReference` used by Customer + RepairOrder models |
| Magic `__call` → `name_only` | `app/Concerns/ForwardsToSchedule` → `app/Support/Schedule`; live call sites in `DatabaseSeeder` (`nextSlot` / `bookSlot` on Technician) |
| Interface + 2 impls + container binding | `app/Contracts/InvoiceCalculator`, `app/Services/StandardInvoiceCalculator` + `RushInvoiceCalculator`, bind in `app/Providers/AppServiceProvider` |
| Same-name shadow pair (aliases) | `app/Billing/Formatter` vs `app/Reporting/Formatter` via aliases in `app/Http/Controllers/ReportController` |
| Custom cast | `app/Casts/Money` |
| Global fn + global const + class const | `app/Support/helpers.php` (`atelier_format_reference`, `ATELIER_REF_PREFIX`), `app/Support/Reference::PREFIX_SEPARATOR` |
| Events / listener / policy / job / command / middleware | `app/Events/RepairCompleted`, `app/Listeners/SendCompletionNotice`, `app/Policies/RepairOrderPolicy`, `app/Jobs/RecalculateInventory`, `app/Console/Commands/*`, `app/Http/Middleware/RecordReportVisit` |
| Laravel helper inventory (live HTTP path) | `app/Support/HelperInventory` via `ReportController` + `cache()->remember` |
| Filament resource / relation-manager / widget / custom page | `app/Filament/Resources/*`, relation managers under RepairOrders, `app/Filament/Widgets/RepairStats`, `app/Filament/Pages/InventoryReport` |
| Livewire `#[Computed]` | `app/Filament/Pages/InventoryReport` (`lowStockParts`) |
| Blade nav / report view | `resources/views/report/summary.blade.php` |
| Broken-syntax fixtures | `fixtures/broken-syntax`, **DO NOT FIX** (intentionally invalid for parser/indexer negative cases) |
| Livewire class components | `app/Livewire/{StatusBoard,PartsPicker,NoteComposer}`: `#[Url]`, `#[Locked]`, `#[On]` listeners + `dispatch()`, `#[Validate]`, DI in `mount()`, `WithPagination`, lifecycle hooks; full-page route `/board` |
| Livewire 4 single-file component | `resources/views/components/⚡order-tracker.blade.php` (anonymous class + `#[Computed]` inside a blade file); embedded via `<livewire:order-tracker>` in the report view |
| Livewire Form object | `app/Livewire/Forms/NoteForm` (`form.body` binding resolves through Form magic) |
| REST API + JsonResources + FormRequest | `routes/api.php`, `app/Http/Controllers/Api/OrderController`, `app/Http/Resources/{RepairOrderResource,PartResource}` (whenLoaded / whenPivotLoaded), `app/Http/Requests/StoreNoteRequest` |
| Localization | `lang/en/atelier.php` + `__('atelier.note_created')` in the API controller |
| Class-based Blade component | `app/View/Components/StatusBadge` + `<x-status-badge>` in the report view |
| Model factories + states | `database/factories/*Factory.php`, deterministic sequences; `RepairOrderFactory::rush()` / `::completed()` |
| Observer via attribute | `app/Observers/DeviceObserver` registered with `#[ObservedBy]` on Device |
| Feature tests (incl. Livewire::test) | `tests/`: 111 tests / 1002 assertions covering HTTP, lifecycle/events, all Livewire components, observer registration, the full relationship matrix, every package integration, the shared health, report-by-slug and export-report surfaces, and the guards below |
| COMPLETE Eloquent relationship matrix | BelongsTo, HasOne, HasMany, BelongsToMany+pivot, HasOneThrough (Device→invoice), HasManyThrough (Customer→statusLogs), HasOne/MorphOne `ofMany`, MorphTo, MorphOne (Signature), MorphMany (Note), MorphToMany/MorphedByMany first-party (Label/labelables) AND vendor (spatie tags on Part). Proven in `tests/Feature/RelationshipsTest.php` |
| First-party packages USED as intended (auth, billing, search, flags, broadcast) | sanctum guard on the API mutation + HasApiTokens · passport guard `api` · cashier Billable on User · scout Searchable on Part (database driver) · pennant `rush-surcharge` flag in RushInvoiceCalculator · reverb-ready ShouldBroadcast event + private channel · socialite login pair · fortify actions + TwoFactorAuthenticatable |
| First-party packages USED as intended (pages, UI, ops, plugins) | folio pages (incl. filename binding) · volt functional component at /rush-counter · flux badge + layout · horizon/octane/telescope/pulse configured (recorders env-gated) · slack notification (guarded) · spatie media/tags/settings via Filament plugins. Proven in `tests/Feature/IntegrationsTest.php` |
| Wide contract implementation | `app/Bench/`: 24 reports, 16 metrics, 8 exporters, 8 notifiers, 8 repositories, 12 services over 8 contracts, 8 concerns and 7 abstract bases |
| Cardinality (exact-count fan-in) | `app/Bench/Contracts/RuleContract` — 48 implementors under `app/Bench/Rules/`, fanned in through `RuleRegistry::RULES`; existing `ReportContract` (24 implementors) |
| Direction (edge orientation) | `dir-contract-parent`/`dir-implementor-child` on `ReportContract` → `CashFlowReport` → `AbstractPeriodicReport`; `dir-self-reference` on `app/Support/TreeNode` (USES, never inheritance) |
| Import-precision (one-of-many, const vs function) | `app/Support/Units.php` (global const + function) consumed one-at-a-time by `app/Support/Formatting/{UnitLabel,UnitFormatter}`; sibling pair `app/Support/Pair/{Left,Right}` with a Left-only consumer |
| Collision (lane-local resolution) | Names colliding with `rust/`/`typescript/` lanes — `Money`, `Customer`, `DatabaseSeeder` (the lane's `Dataset`), `ATELIER_REF_PREFIX`, `InvoiceCalculator::calculate`, `Formatter` — each resolved to this lane's declaration |
| Multi-parent declarations | `app/Bench/Contracts/CompositeContract` (three parent interfaces); `app/Bench/Reports/CashFlowReport` (one `extends` + two `implements`; the composite implementor is an existing report so `ReportContract` stays at 24) |
| Framework magic 1/2 (string-keyed edges) | facade static call (`Log::info` -> `Illuminate\Log\LogManager::info`), gate ability (`allows('update')` -> `RepairOrderPolicy::update`), query scope (`->open()` -> `scopeOpen`), `Attribute::get` accessor (`display_name` -> `displayName()`), container string key (`app('atelier.clock')` -> the `singleton` line) |
| Framework magic 2/2 (string-keyed edges) | middleware alias (`record.visit` -> `RecordReportVisit`), route -> controller method + `{repairOrder:reference}` binding, `config('atelier.labor_rate_cents')` -> `config/atelier.php`, `__('atelier.note_created')` -> `lang/en/atelier.php`; probes in `app/Support/Edge/StringKeyProbe.php` |
| Canonical shared ids: call sites | `app/Support/Canonical/CanonicalProbe` carries the global-function, class-const, static-factory, container-resolved-contract and error-throw call sites the shared ids point at |
| Canonical shared ids: resolution edges | `app/Support/Canonical/`: `Exports/barrel.php` aliasing `Ledger` (re-export with no declaration of its own), `TypeOnlyProbe` (docblock-only import), `DuckFormatter` (duck-typed `FormatterContract` satisfier) |
| Canonical shared ids: row fan-in | `app/Support/Canonical/Reporting/ReportRow::rowFromCents`, called once by each of the 8 `Reporting/Summaries/*` |
| Report fan-in registry | `app/Bench/Reports/ReportRegistry::REPORTS`, the 24 `ReportContract` implementors in one constant, mirroring `RuleRegistry::RULES` |
| Delegating seeder | `database/seeders/CanonicalSeeder` calls `DatabaseSeeder::class`, giving the frozen dataset an in-code reference instead of only an artisan string |
| Document-symbol + call-hierarchy | `app/Bench/Reports/ReportRegistry` (4 named symbols) for the symbol listing; `complete` → `transitionTo`, three callers of `transitionTo` (model, seeder, feature test), and `ReportController::show` → both aliased `Formatter` halves for the call graph |
| Wave-2 shared ids: language shapes | `app/Support/Canonical/Wave2/`: generator (`OrderStream::each`), brace group-use (`RepositoryGlob`), namespace-prefix import (`NamespaceOneMember`), namespace-level const (`constants.php`) |
| Wave-2 shared ids: name collisions | `App\Console\Commands\RecalculateInventory` against `App\Jobs\RecalculateInventory` (aliased import), and `PricingPolicy` resolving two traits' `rate()` with `insteadof` |
| Generic contract | `app/Bench/Contracts/RepositoryContract`, a `@template` docblock generic with the 8 repositories as implementors |
| Breadth (constructs that may be dropped) | `app/Support/Edge/`: enum-implements-interface, first-class callables, readonly promoted properties + readonly class, intersection types, `#[Attribute]` + reflection, `new` in initializer + `never` type, static closure + no-default `match`, named arguments, nullsafe chain, `@template`/`@extends` generics, trait with abstract method + static property, interface constant via implementor |
| Laravel registries, Blade components, relations by name (wave 3) | `view('report.summary')` -> the template (`def-view-name`); `<x-status-badge>` class component and `<x-layouts.app>` anonymous component (`def-blade-component-tag`, `def-anonymous-component`); `load([... 'device' ...])` and `$order->parts` (`def-relation-name`, `def-relation-property`); `$this->call('atelier:export-report')` -> the command's `$signature` (`def-artisan-command-name`); `new PrivateChannel('orders')` -> `Broadcast::channel` (`def-broadcast-channel`); `Feature::active('rush-surcharge')` -> `Feature::define` (`def-pennant-flag`); `route('api.orders.show')` -> its handler through `routes/api.php` (`def-named-route-api`) |
| Guards no gate covers otherwise | `tests/Feature/SpecifierResolutionTest` (every module specifier written in the lane resolves: imports of every form, trait uses, qualified names in code, docblock types, Blade views compiled first), `tests/Feature/LaneFilesLoadTest` (every PHP file under `app/` `bootstrap/` `config/` `database/` `lang/` `routes/` loads, and every `app/Bench` component is called through each contract it implements), `tests/Feature/EdgeProbesTest` (each `app/Support/Edge` probe and the `Units` const/function pair is exercised), `tests/Feature/FilamentSurfacesTest` (the panel's discovered `RepairStats` widget and `InventoryReport` page render against the seed), `tests/Feature/SharedCommandNamesTest` (the shared command names run), `tests/Feature/LspCheckPlanTest` (`bench/lsp_check.php --plan` asks every language-server task at its symbol), `php bench/verify_tasks.php --lint` (each broken fixture must still refuse to parse) |

## Consumption (runner)

1. Check out the pinned SHA (see [`../README.md`](../README.md) for the `corpora.lock.json` contract).
2. `composer install` from the **committed** `composer.lock` (no unlock, no update).
3. No remote artifacts, no SSH private remotes, no secrets.

Local use:

```bash
composer install
cp .env.example .env   # if needed
php artisan key:generate
php artisan migrate --force
php artisan db:seed    # DatabaseSeeder — deterministic
php artisan test       # 111 tests, sqlite :memory:
```

Admin UI: `/admin` (Filament). Sample report path: `GET /report/{repairOrder:reference}` (see `ReportController`).

## Ground truth

| Artifact | Role |
| --- | --- |
| `bench/tasks.json` | 118 needle-based accuracy tasks (`from` → `expect` file/needle pairs): 30 of the 40 original (wave 3 of issue #223 retired ten, see Lane-local ids) + 29 for the cardinality/direction/import-precision/collision/multi-parent/breadth surfaces (issue #7) + 10 framework-magic string-keyed edges + 24 shared canonical ids carried by the other lanes + 3 document-symbol/call-hierarchy surfaces + 13 wave-2 ids (`def-module-const` through `parse-negative-unclosed-blade`; three of them, `resolution-trait-conflict-insteadof`, `dir-trait-user` and `parse-negative-unclosed-blade`, are php-only) + 9 wave-3 ids (the last 9 entries, `def-view-name` through `def-named-route-api`, all php-only). By surface: definition 60, resolution 12, references 11, import-precision 7, hover 6, implementation 5, call_hierarchy 4, direction 4, document_symbol 2, cardinality 2, multi-parent 2, parse-negative 2, diagnostics 1. The counting rule for every count the keys state is in the `notes` field |
| `bench/verify_tasks.php` | Self-check that every task needle still resolves to exactly one line |

```bash
php bench/verify_tasks.php          # resolve every file+needle pair (4 tasks read vendor/: vendor-scout-trait, vendor-sanctum-trait, vendor-shouldbroadcast-contract, def-facade-static-call; run composer install first)
php bench/verify_tasks.php --lint   # php -l over app/ bench/ config/ database/ routes/, then each fixtures/broken-syntax/* must refuse to parse
```

The needle check has **no composer dependencies**, so it also runs on a machine that has never
installed the corpus dependency tree (the four tasks that read `vendor/` then report `file missing`
by design). `--lint` needs `vendor/` for one check: it compiles the broken Blade fixture with the
Blade compiler before asserting that `php -l` refuses the compiled PHP.

Task `file` paths are relative to this lane root (`php/`), not to the repository root.

**Regenerate discipline:** any edit under `app/`, `routes/`, `resources/views/`, seeders, or other
task-target paths must leave `php bench/verify_tasks.php` at **exit 0**. If needles move, update
`bench/tasks.json` in the same change (bench lane owns `bench/`; app lanes keep needles green).

Broken fixtures under `fixtures/broken-syntax/` are out of scope for "fix until green" — they are
negative cases on purpose.

## Lane-local ids (checklist D.2)

A lane-local id is one only this lane carries (rulings R10, R13). Each is sorted into one of three outcomes; `bench/matrix.json` lists which lanes carry each id.

- **Language- or framework-specific mechanism (37; 33 without the four route variants `lw-fullpage-route`, `int-folio-filename-binding`, `resolution-route-model-binding`, `def-named-route-api`).** Each note names the mechanism: `def-blade-model-method`, `def-livewire-computed`, `lw-sfc-computed`, `lw-wireclick-method`, `lw-form-object-magic`, `lw-url-attribute`, `lw-embed-tag`, `rel-ofmany-builder`, `int-pennant-flag`, `int-volt-functional-prop`, `imp-const-not-function`, `imp-function-not-const`, `def-attribute-class`, `refs-attribute-usage`, `def-facade-static-call`, `def-policy-ability`, `def-query-scope`, `def-accessor-attribute`, `def-container-string-key`, `def-middleware-alias`, `def-config-key`, `def-lang-key`, `resolution-trait-conflict-insteadof`, `dir-trait-user`, `parse-negative-unclosed-blade`, `def-view-name`, `def-blade-component-tag`, `def-relation-name`, `def-artisan-command-name`, `def-broadcast-channel`, `def-pennant-flag`, `def-anonymous-component`, `def-relation-property`, and the four route variants above (section E.1), which count on their surface rows only.
- **Common candidates (21): the same question could be asked unchanged in a sibling lane; kept as they are, not counted as language-specific.** `refs-trait-usage` (rust, python), `hover-schedule-method`, `card-complete-hub` (every lane), `lw-di-in-mount`, `rel-hasonethrough`, `rel-hasmanythrough`, `rel-morphedbymany` (the scored question is a plain definition or references query: every lane), `vendor-scout-trait`, `vendor-sanctum-trait`, `vendor-shouldbroadcast-contract` (a declaration in a dependency's source: every lane), `def-enum-implements` (python, rust), `def-first-class-callable` (typescript, javascript, python, go, rust), `def-readonly-promoted` (typescript, rust), `def-intersection-type` (typescript), `def-new-in-initializer` (typescript, javascript, python), `def-static-closure` (every lane), `def-named-args` (python), `def-nullsafe-chain` (typescript, javascript), `def-docblock-generic` (javascript, typescript), `impl-trait-abstract` (rust, python), `def-interface-const-via-impl` (rust, python).
- **Retired in wave 3: a renamed copy of a shared id this lane carries, or a duplicate of a question the lane already asks.** `impl-interface` (= `impl-invoice-calculator`), `def-global-function` (= `def-free-function`), `hover-global-function` (= `hover-free-function`), `def-class-const` (= `def-assoc-const`), `def-enum-case` (= `def-enum-variant`), `def-interface-through-binding` (= `def-trait-method-through-binding`), `def-global-const` (the from line of `lane-local-ref-prefix`), `card-magic-forward` (= `def-proxy-forwarded-method`), `lw-on-listener-edge` (= `refs-string-event-name`), `def-trait-method-scope` (= the lane's own `def-query-scope`, same answer line).

`def-nullsafe-chain` and `def-blade-model-method` both answer `Device::label`, from different mechanisms (a nullsafe chain in PHP; an expression in a Blade-compiled template), so neither duplicates the other.

## Indexer surfaces (checklist section E)

What the tools under test ship for PHP (ruling R2, `npm view @skylence-ai/skybox@0.9.0 readme`, column "Framework extractors", committed as `bench/TOOL-SURFACE.md`): Laravel routes, Eloquent, Guzzle, Inertia (PHP side), Blade.

### E.1 Route parsers

Laravel routes is the one route parser listed for PHP. It is scored by `def-route-to-handler` (shared: the `[ReportController::class, 'show']` action in `routes/web.php` -> `ReportController::show`) and by the lane-local `def-named-route-api` (`route('api.orders.show')` in `OrderController::storeNote` -> `OrderController::show`, through the `->name()` registration in `routes/api.php`), which also puts a task on `routes/api.php`. Volt (`Volt::route`), Folio (file-based pages) and the Filament panel routes are not in the shipped list, so no route task is owed for them; the lane still scores those frameworks through `lw-fullpage-route`, `int-folio-filename-binding` and `int-volt-functional-prop`.

### E.2 ORM and the other listed extractors

| Listed | Scored by, or why not |
| --- | --- |
| Eloquent (ORM) | relations: `rel-hasonethrough`, `rel-hasmanythrough`, `rel-ofmany-builder`, `rel-morphedbymany`, `def-relation-name` (a relation named by a string in `load()`), `def-relation-property` (a relation read as a property through `__get`); local scope: `def-query-scope`; `Attribute` accessor: `def-accessor-attribute`; casts: `def-enum-method` (an enum attribute cast), `lane-local-money` and `refs-money-class` (the custom `Money` cast class); route-model binding by column: `resolution-route-model-binding` |
| Blade | expressions in templates: `def-blade-model-method`, `def-accessor-attribute`; view name to template: `def-view-name`; components: `def-blade-component-tag` (class component), `def-anonymous-component` (anonymous component); Livewire inside Blade: `lw-embed-tag`, `lw-sfc-computed`, `lw-wireclick-method`, `lw-form-object-magic`; a broken template: `parse-negative-unclosed-blade` |
| Guzzle | Deliberate gap: the lane's own code makes no outgoing HTTP call (no `Http::` client and no Guzzle client anywhere under `app/`, `routes/`, `config/` or `database/`); `guzzlehttp/guzzle` is in `composer.lock` only as a dependency of `laravel/framework`, `laravel/socialite` and the Slack notification channel, so there is no client call site to score. |
| Inertia (PHP side) | Deliberate gap: Inertia (PHP side) goes unscored because Inertia is not installed (`composer.lock` has no `inertiajs/inertia-laravel` package); the lane's UI is Blade, Livewire and Filament, so there is no Inertia response to score. |

### E.3 Known-hard resolution classes

| Class | Tasks |
| --- | --- |
| Dynamic dispatch | `def-proxy-forwarded-method`, `hover-proxy-forwarding` (`__call` forwarding to `Schedule`), `def-facade-static-call` (a facade's `__callStatic` to the manager), `def-relation-property` (Eloquent `__get`), `lw-form-object-magic` (Livewire Form object) |
| String-keyed lookup | `def-container-string-key`, `def-policy-ability`, `def-middleware-alias`, `def-config-key`, `def-lang-key`, `def-artisan-command-name`, `def-broadcast-channel`, `def-pennant-flag`, `def-named-route-api`, `def-view-name`, `def-relation-name`, `int-pennant-flag`, `refs-string-event-name` |
| Alias divergence | `def-import-alias`, `def-shadow-alias-billing`, `def-shadow-alias-reporting`, `resolution-shadow-type-billing`, `resolution-shadow-type-reporting`, `lane-local-formatter-billing`, `resolution-same-name-command-vs-job` |
| Re-export chain | `imp-barrel-no-fanout` (`app/Support/Canonical/Exports/barrel.php` aliases `Ledger` and declares nothing) |
| Generated code | Blade templates run only as the PHP Blade compiles them to: `def-blade-model-method`, `def-accessor-attribute`, `lw-sfc-computed`, `parse-negative-unclosed-blade` |
| Conditional compilation | PHP has none (no preprocessor and no build-time flags), so no task |

### E.5 Language server

Pinned: **phpactor 2026.11.22.0**, the release phar (sha256 `1ae84e18348754a94ad28b14d3ec341aded0d2c082be61e155bc33fc42690659`). It answers `hover`, `document_symbol` and `implementation`. No installable PHP language server answers `call_hierarchy`: phpactor 2026.11.22.0 and intelephense 1.18.5 (npm) both answer `textDocument/prepareCallHierarchy` with -32601 and neither advertises `callHierarchyProvider` in `initialize` (intelephense 1.18.5 advertises no `implementationProvider` either, and answers every implementation query with null). So the four `call_hierarchy` keys (`card-complete-hub`, `hierarchy-complete-chain`, `hierarchy-incoming-transition`, `hierarchy-cross-package`) have no server second opinion and rest on reading both bodies.

Install and run (no secret, nothing added to `composer.json`; the server indexes the lane's own `vendor/`):

```bash
composer install
curl -fsSL -o /tmp/phpactor.phar https://github.com/phpactor/phpactor/releases/download/2026.11.22.0/phpactor.phar
shasum -a 256 /tmp/phpactor.phar     # 1ae84e18348754a94ad28b14d3ec341aded0d2c082be61e155bc33fc42690659
php bench/lsp_check.php --server 'php /tmp/phpactor.phar language-server' --name phpactor --server-version 2026.11.22.0 --wait 45
# second server, appended to the same report:
(cd /tmp && npm pack intelephense@1.18.5 && tar xzf intelephense-1.18.5.tgz)
php bench/lsp_check.php --server 'node /tmp/package/lib/intelephense.js --stdio' --name intelephense --server-version 1.18.5 --wait 45 --append
php bench/lsp_check.php --plan       # no server: the request each task makes (tests/Feature/LspCheckPlanTest.php runs it)
```

The report is [`bench/lsp-check.md`](bench/lsp-check.md), one line per `hover`, `document_symbol`, `call_hierarchy` and `implementation` task (17). phpactor 2026.11.22.0: 13 agree, 4 have no answer (the `call_hierarchy` tasks), none disagrees. intelephense 1.18.5: 8 agree (the hover and document_symbol tasks), 9 have no answer. An earlier run disagreed on one key, `vendor-shouldbroadcast-contract`, which keyed the interface `ShouldBroadcast` (a definition answer) on the `implementation` surface; read against the tree the server was right, and the task now sits on the `definition` surface, so it is no longer asked here. No key was changed because of a server's reply.

## Deliberate differences from the other lanes

The shared set every lane carries is `GET /health`, `GET /report/{reference}`, `GET /api/orders`, `POST /api/orders/{key}/notes`, `GET /api/reports/{slug}`, the export-report and recalculate-inventory commands, and the recalculate-inventory job. This lane carries all of it. These differences are deliberate and stay:

- **Seed.** `DatabaseSeeder` is framework-native and does not use the shared seed numbers (customers, order totals). Nine tasks anchor needles there, so it is not reseeded.
- **Lane-only routes.** Order by reference (`GET /api/orders/{repairOrder:reference}`), `/board`, the two social-auth routes (`/auth/{provider}/redirect`, `/auth/{provider}/callback`) and the Volt route `/rush-counter`; Laravel's skeleton welcome page `GET /` (`routes/web.php:8`) and its `/up` health endpoint, which stays beside `/health`; the Folio pages `/about` and `/orders/{repairOrder:reference}` (`resources/views/pages/`); and the Filament panel under `/admin` (the customers, parts and repair-orders resources and the inventory-report page; `php artisan route:list` lists them), plus the routes the installed first-party packages register, which `route:list` lists too. Section E added no route module: Laravel routes is the only route parser listed for PHP, and its lane-local task (`def-named-route-api`) reuses the existing `GET /api/orders/{repairOrder:reference}` route, now named `api.orders.show`.
- **Commands.** The shared names `export-report` and `recalculate-inventory` are commands of their own (`routes/console.php`, `php artisan list` shows each as its own row); each hands its input to the lane's own spelling, and `tests/Feature/SharedCommandNamesTest.php` runs both. Lane-only commands: `atelier:export-report` and `atelier:recalculate-inventory` (the lane's original spellings of the shared pair, kept), `atelier:prune-delivered` (a prune command no other lane has) and Laravel's skeleton `inspire` (`routes/console.php:6`).
- **Route parameter names.** `GET /report/{repairOrder:reference}` is the shared `GET /report/{reference}`: Laravel names the parameter after the model it binds and looks it up by the `reference` column.
- **Notes bound by reference.** `POST /api/orders/{repairOrder:reference}/notes` binds the order by its `reference` key where the other lanes bind by id.
- **Report payload.** `GET /api/reports/{slug}` returns the report's own `generate()` array as `rows`, a title derived from `name()` and Laravel's standard 404 body, where the other lanes return a row list, a human title and `{error, key}`.

- **Shared ids this lane does not carry.** `def-async-function` (typescript, python, javascript): PHP has no async function and no `await` (a Fiber is a runtime class, not a function modifier), so no lane-local id is an honest stand-in and the lane carries none.

Report slugs for `/api/reports/{slug}` and `atelier:export-report` are the kebab-cased class name without the `Report` suffix (`CashFlowReport` is `cash-flow`), resolved in `app/Support/ReportLookup.php`, not in `ReportRegistry`.

## License

MIT (Laravel skeleton lineage). Corpus content is clean-room for bench use.
