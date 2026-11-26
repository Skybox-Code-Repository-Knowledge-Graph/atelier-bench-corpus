# Scorer

Compares one tool's answers for one lane with that lane's `bench/tasks.json`.

The scorer knows nothing about any tool. An **adapter** asks a tool the corpus's questions and
writes its replies in the answer format below; the scorer reads that file and the answer key and
reports a verdict per task. Tool names live in adapters and answer files, never in a `tasks.json`.

```
node bench/score/score.mjs --lane go --answers go.answers.json
node bench/score/score.mjs --lane go --answers go.answers.json --format json
node bench/score/oracle.mjs --lane go > go.oracle.json     # a perfect answer file, built from the key
node --test 'bench/score/test/*.test.mjs'                  # the scorer's own checks
```

Node built-ins only. `score.mjs` exits 0 whenever scoring completed, whatever the tool scored. A
tool that fails every task is a result, not an error. It exits 2 when an input cannot be used: a
file is unreadable, the answer file is malformed, or its `lane` names a different lane from the one
being scored. Answers for ids the lane does not have are listed in the report, so a renamed id
never passes for an unanswered one.

## Answer format

One JSON file per tool and lane.

```json
{
  "version": 1,
  "tool": { "name": "example", "version": "1.2.3" },
  "lane": "go",
  "scope": "repo",
  "answers": {
    "def-free-function": { "locations": [ { "file": "core/money/money.go", "line": 41 } ] },
    "hover-pad-helper":  { "status": "unsupported" },
    "def-through-alias": { "status": "error", "detail": "timed out after 60s" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `tool.name`, `tool.version` | What was scored. Pin the version |
| `scope` | `repo` when the tool indexed the whole checkout, `lane` when it indexed one lane directory. Default `lane` |
| `protocol` | How the adapter asked (see `bench/adapters/README.md`): one name, or an object from surface to name when it differs by surface; a `surface:kind` key names the protocol of one kind of a surface. Reported, never scored |
| `answers` | Keyed by task id. A task with no entry is `UNANSWERED` |

One answer:

| Field | Meaning |
| --- | --- |
| `status` | `answered` (default), `unsupported` (the tool has no way to be asked this), or `error` (the tool or the adapter failed; say why in `detail`) |
| `locations` | What the tool returned: `file`, `line`, optional `end_line`. Paths are relative to the lane directory, as in `tasks.json`. A location in another lane is written `../<lane>/...` |
| `text` | Free text the tool returned with the answer, such as hover documentation, a label, a qualified name or a relation. Only the tool's own words: the `hover` rule reads it. Optional |
| `note` | The adapter's own remark on the answer (which lookup found it, how many candidates came back). Never read by the scorer. Optional |
| `names` | Symbol names the tool returned, when the answer is a list of names. Optional |
| `unlocated` | How many further results the tool returned without a file and line. Optional, default 0. They count like unexpected locations, so an adapter can never improve a score by dropping them |

### What a line means

- **A declaration** is the line that carries the symbol's name. The scorer matches it by exact line.
  A range never makes it pass, so an answer that returns the enclosing class for a question about
  a member fails. A tool that reports the start of a decorated or attributed declaration is
  normalized by its adapter: move to the first line, at or after the reported start, that contains
  the name the tool reported.
- **A site** that the key allows beside a target (`known_sites`) is matched by its line too: a
  range that starts above it is an enclosing scope, not the site, and counts as an unexpected
  location. Only a call site under `call_hierarchy` is matched by containment, where `line` to
  `end_line` is the range of the function the tool reported as the caller; that is why the
  `call_hierarchy` rules are recall-only (see Recall rules).
- **A few targets are anchored inside their declaration**, because the declaration line is not
  unique in its file or because the answer is a statement. No line of their key names the
  declaration, and matching them by containment would pass any range that covers the anchor, one
  over the whole file included, so they are `UNSCORABLE` (`TARGET_INSIDE_SYMBOL` in
  `lib/plan.mjs`) until their key anchors a line a tool can return.

### Scope

Many exclusions in the corpus are lane prefixes such as `php/`: the answer must not land in another
lane. They can only fire when the tool saw the other lanes, so they are checked for `scope: repo`
and reported as not exercised for `scope: lane`.

## Repeated sites

A complete list of reference sites (issue #168) can hold lines whose text is identical to a sibling
line in the same file, so no needle keys exactly one of them. Such lines go in `repeated_sites`:

```json
"repeated_sites": [ { "file": "tests/breadth.test.cjs", "needle": "const data = Dataset.seeded();", "lines": 2 } ]
```

The needle occurs on exactly `lines` lines of the file, and every one of them is a site. A task
that carries `repeated_sites` states `exact_count` equal to its `known_sites` plus all repeated
lines. The lane verifiers ignore this key; `test/sites.test.mjs` checks it.

## Optional sites

Some lines link to a task's symbol in a way a tool may or may not report, and no `kind` on the task
says that this link is the one asked about: an export list entry (python `__all__ = ["Money"]`), a
type-literal key that names an export by structure, a use of the constant whose value is the event
name a `name_only` task asks about. Such lines go in
`optional_sites`:

```json
"optional_sites": [ { "file": "atelier_core/__init__.py", "needle": "    \"Money\"," } ]
```

An optional site is neither required nor wrong: a tool that returns it is not marked down, and a
tool that omits it is not either. It does not count toward `exact_count`. Each needle keys exactly
one line, which is not also the target, a known site or a repeated site. The lane verifiers ignore
this key; `test/sites.test.mjs` checks it. The references rule treats these lines as neutral.

## The queried symbol

A task's `from` names a line, and a line can hold several identifiers. `from.symbol` says which one
the task asks about, exactly as written on that line and with no qualifier. `from.occurrence`
(1-based) says which one when it appears more than once on the line, and is then required: two
occurrences on a line are often two different symbols. The symbol is the alias where an alias is
used and the member on a member access. It is `null` when the question has no single identifier,
such as a name built at run time. `document_symbol`, `parse-negative` and `diagnostics` tasks ask
about a file and carry neither key.

An adapter takes the question from these keys and never from the answer line, which would leak the
answer into the question. `lib/symbol.mjs` gives it the column:

```js
import { symbolColumn } from "./lib/symbol.mjs";
const column = symbolColumn(lineText, task.from);   // 0-based, or -1 when no symbol is stated
```

Every lane states the symbol on every symbol-level task (issues #145 and #157). `test/symbol.test.mjs`
fails when one is stated wrongly or missing, so a new task must carry it.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `PASS` | Every scored check passed |
| `FAIL` | A scored check failed; the reason is printed |
| `UNSUPPORTED` | The adapter says the tool cannot be asked this |
| `UNANSWERED` | The answer file has no entry for the task |
| `ERROR` | The tool or adapter failed, or the answer is malformed |
| `UNSCORABLE` | No rule in this version of the scorer covers the task, or the task states no `from.symbol` (its lane is not annotated yet, or the task is a misfit), so no adapter can be asked it |
| `UNRESOLVED` | An expected file is not in the checkout (the php lane's `vendor/` needles before `composer install`) |

The report states how many tasks this scorer can score, then one line per rule class (see Rules)
and adapter protocol (the answer file's `protocol`, per surface where it differs): passed of
scorable tasks (the headline: a question the adapter did not ask counts as not passed), passed of
the questions the tool was asked (its errors and "unsupported" replies count as asked), and how
many were not asked. The per-surface table has no total row, since it would add exact and
recall-only verdicts. The lines are separate measures and are never summed: an exact pass under one protocol does not mean what it means under another, and a
recall-only pass means less than either. The JSON report carries them as `summary.columns`.

## Rules in this version

Semantics come from the rule table in `lib/plan.mjs`, never from the shape of an `expect` block:
the same key means different things in different tasks. A task is scored only when a rule names
its surface and keys. Every key a rule does not use is printed per task as `not scored`.

### Exact rules

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `definition/target` | `definition` | `file`, `needle` | the target declaration is returned |
| `definition/candidate` | `definition` | `candidate` | the candidate declaration is returned |
| `resolution/candidate` | `resolution` | `candidate` | the candidate declaration is returned |
| `import-precision/candidate` | `import-precision` | `candidate` | the candidate declaration is returned |

For all four:

- The answer must contain the target, by exact line.
- It may also contain the task's `known_sites`. Any other location makes the answer ambiguous,
  and an ambiguous answer fails.
- Nothing in `must_not_include` may be returned. A known site is never an excluded hit, since the
  key itself lists it.
- A task that carries `exact_count` beside a target is `UNSCORABLE`, unless a rule below says what
  the count means for it. The count is not one thing: it is the number of declarations the key
  lists in one task (`resolution/merged-name`) and a signature's parameter count in another (kind
  `arity`, which stays `UNSCORABLE`).
- `kind` and `resolution` are labels and are never scored. The kinds these four rules cover were
  reviewed against the lanes' `notes`. One, `build_generated`, is excluded (`KIND_UNSCORABLE` in
  `lib/plan.mjs`): its key names two places, so a tool that returns either one alone would fail.

### Counts beside a target

Issue #135. Each of these was decided from the task's own `expect`, `note` and `from`, its lane's
`notes`, and the lane's own language server, before any tool under test was measured on it.

| Rule | Surface | Serves | Pass when | Class |
| --- | --- | --- | --- | --- |
| `resolution/merged-name` | `resolution` | kind `declaration_merge`, the merged name asked | every declaration of the name (`known_sites`) is returned, and nothing else | exact |
| `resolution/merged-member` | `resolution` | kind `declaration_merge`, a member asked | the member's own declaration (`candidate`), inside the half that declares it, is returned, and nothing else | exact |

- **Declaration merging.** The lane notes: "the name resolves to both declarations, a member resolves
  to the half that declares it". Which question a task asks is read from `from.symbol`: it is the
  merged name when that symbol is written on every declaration the key lists (`asksMergedName`).
  Asked about the name (typescript `resolution-class-interface-merge`, `Worker`), the answer is the
  `known_sites`, `exact_count` of them; the line asked from is not neutral, and the `candidate` (a
  member) is not read, so returning it fails. Asked about a member (typescript
  `resolution-namespace-vs-enum`, `transitionsTo`), the answer is the `candidate`; `known_sites` and
  `exact_count` describe the name, another question, so they are not read and returning one of them
  beside the member fails. typescript-language-server 6.1.0 (TypeScript 5.9.3) answers both tasks
  exactly so.

Left `UNSCORABLE`, with the reason printed:

| Task | Why |
| --- | --- |
| go `resolution-arity-parameter-groups` (kind `arity`, `SURFACE_KIND_UNSCORABLE`) | `exact_count` is the parameter count (lane notes), which no answer field carries; the candidate is the line asked from, so a location alone would pass an answer that returns the question |
| python `def-overload` (`TARGET_COUNT_UNSCORABLE`) | the key's sources disagree on whether the stubs are part of the answer: the task's note ("the definition is the implementation, the stubs are known_sites"), the typescript `def-overload` note ("A tool that lists only one overload, or the implementation only, is incomplete") and the python lane notes ("exact_count gives the size of the answer, and known_sites ... list it"). An implementation-only answer is correct under one reading and incomplete under the other, and neither the lenient rule (stubs optional) nor the strict one (implementation and every stub) is stated by the key. pyright 1.1.414 answers the implementation and both stubs. A key question for the owner |
| typescript `def-method-overload` (`TARGET_COUNT_UNSCORABLE`) | typescript-language-server 6.1.0 returns only the overload signature the call matches, not the implementation the key names, while the note asks for both signatures and the implementation |
| typescript `def-overload` (`TARGET_COUNT_UNSCORABLE`) | the candidate is a parameter line inside the implementation signature, not the line that names it, and the server returns only the overload signature the call matches |
| javascript `resolution-calculate-through-binding` (`TARGET_COUNT_UNSCORABLE`) | no `kind` says whether the answer is the default binding's implementation (the candidate) or both implementations (`exact_count` 2); the server returns neither, only the `@typedef` property of the contract |

### Key shapes no rule scores

Issue #135 also found key shapes no rule names. Where no sound rule can be stated from the primary
sources, the task stays `UNSCORABLE` and the reason names the gap (`UNRULED_SHAPES` in
`lib/plan.mjs`: a surface, a kind, the exact set of `expect` keys, and the `lane:id` tasks it is true of, so a task of the same shape elsewhere gets the generic reason). These entries are matched
only after every rule has passed a task by, so they never take a task a rule scores. The key is
not changed to fit a rule.

| Shape | Tasks | Why no rule |
| --- | --- | --- |
| `resolution`, kind `lane_local`, keys `contains`, `kind` | go `lane-local-calculate`, `-customer`, `-dataset`, `-formatter-billing`, `-money`, `-ref-prefix` | The lane notes ask that resolution land on this lane's own declaration and never a sibling lane's. These keys name no declaration and exclude no sibling lane (the same ids in the other lanes carry a `candidate` and lane-prefix `must_not_include` entries). `contains` is defined for hover text only; gopls v0.24.0's hover holds the string on one of the six, the one where it is the asked symbol itself (`Calculator`), and `AT-2026-` is not the value of `AtelierPrefix` (`"AT"`) |
| `resolution`, kind `shadow_alias`, keys `contains`, `kind`, `must_not_include`, `resolution` | go `resolution-shadowed-stdlib-package` | The answer, `net/http`'s `NewServeMux`, is in the Go standard library, outside the repository: no lane-relative location names it (gopls v0.24.0 answers a GOROOT path, and an absolute path is an invalid answer). `contains` (`net/http`) is defined for hover text only, and the package's own `app/http` declares no `NewServeMux`, so the exclusion `app/http#NewServeMux` can trip only on the line asked from: on its own it would pass an empty answer |
| `definition`, keys `implementations` only | rust `def-cfg-gated` | Asked from the `Cargo.toml` line `extra-rules = []` (no symbol). No `kind` and no count say what the question returns or that the list is complete, and the list holds `ExperimentalRule` (behind `feature = "extra-rules"`) and `AlwaysTrueRule` (behind `#[cfg(test)]`, which the feature does not gate). rust-analyzer 1.96.0 answers no definition in `Cargo.toml` |
| `definition`, kind `unresolvable_static`, keys `exact_count`, `kind`, `known_sites` | javascript `def-dynamic-require`, python `def-dynamic-import-module` | The answer is each candidate module (lane notes: "the honest result is every candidate module, and exact_count counts them"), and the key anchors each module on a line inside it, its `SLUG` line, so no line of the key names the module. A module answer lands on the file's first line (typescript-language-server 6.1.0 and pyright 1.1.414 on a static specifier; at the runtime-built specifier both return nothing). Matching by file is a mode the key does not state: the same class as the targets anchored inside their declaration |
| `import-precision`, kind `visibility_boundary`, keys `contains`, `kind`, `known_sites` | go `imp-internal-package` | Asked from the package clause of `internal/audit` (note: "only atelier.example/lane/... may import this package"). No source says what the question returns; `known_sites` with no target has no stated role (above), and `contains` (`internal`) is defined for hover text only. The key lists one importer, `tests/structure_test.go`, and no count; gopls v0.24.0, asked for references at the package clause, answers three importers (`cmd/atelier/main.go` and `tests/events_test.go` blank-import it), so a rule over the list could only be recall |
| `import-precision`, kind `glob`, keys `exact_count`, `kind`, `known_sites` | rust `imp-glob-import` | The shared id `imp-glob-import` has no single reading (below). The rust key lists both public items of `report_contract` (`ReportRow`, `ReportContract`, `exact_count` 2), so its list is complete; only what the answer is stays open |
| `import-precision`, kind `glob`, keys `exact_count`, `kind`, `known_sites`, `must_include` | python `imp-glob-import`, typescript `imp-glob-import` | No single reading (below), and neither key lists its answer. python: 2 of the 16 names in `__all__`, each on its `from .x import X` line in `metrics/__init__.py`, while pyright 1.1.414 resolves a name the star import brings in to its class (`metrics/margin.py:14`), and the lane's `barrel` note says the same of `atelier_core`: an import through its `__init__.py` lands on the submodule that defines the name. typescript: 2 of the 4 exported names by line, the other 2 (`ReportContract`, `reportRow`) only by name in `must_include` |
| `import-precision`, kind `glob` or `group_use`, keys `exact_count`, `kind`, `known_sites`, `must_not_include` | javascript `imp-glob-import`, php `imp-glob-import` | No single reading (below). javascript: the key lists the four declarations of `helpers.js` and counts them, while typescript-language-server 6.1.0 asked at `from.symbol` answers the module (`helpers.js:3`), which no line of the key names. php: the key has rust's form (the eight declarations the brace group-use binds, `exact_count` 8), phpactor 2026.11.22.0 answers no location at the namespace asked (`Repositories`), and the shared id still splits across the python, typescript and go keys |
| `multi-parent`, keys `exact_count`, `must_include` | rust `parents-supertrait-send-sync` | Asked from `pub trait ReportContract: Send + Sync {`. The two parents, `Send` and `Sync`, are declared in the Rust core library, outside the repository, so no lane-relative location names them: rust-analyzer 1.96.0 answers `core/src/marker.rs` in the toolchain (an absolute path is an invalid answer) and has no type hierarchy (`textDocument/prepareTypeHierarchy` is an unknown request). The key names them only in `must_include`, which no rule scores on any surface, and judging a parents answer by name (the `names` field) is a mode no source states for this surface |
| `implementation`, keys `file`, `needle` | php `vendor-shouldbroadcast-contract` | Asked from `class RepairCompleted implements ShouldBroadcast` (note: "VENDOR contract: RepairCompleted implements a framework interface"), the key names the interface itself, under `vendor/`, not an implementor. Measured on a copy with `composer install`: phpactor 2026.11.22.0 answers `implementation` at `ShouldBroadcast` with six implementors (`RepairCompleted` and five under `vendor/`, one an interface that extends it) and `definition` with the key's interface, so the key holds the definition answer on the implementation surface; the lane's other vendor targets (`vendor-scout-trait`, `vendor-sanctum-trait`) are `definition` tasks |

**`imp-glob-import`.** Five lanes ask it with a key no rule names (rust, python, typescript and
javascript kind `glob`, php kind `group_use`), and the lane notes say a shared id asks the same
question in every lane. No reading of the answer is settled:

- Asked at the import (`from.symbol`, the module), every lane's own server answers the module or
  nothing, never the lines the keys list: rust-analyzer 1.96.0 `report_contract.rs:1`, pyright
  1.1.414 `metrics/__init__.py:1`, typescript-language-server 6.1.0 the module's first statement
  (`reportContract.ts:3`, `helpers.js:3`), phpactor 2026.11.22.0 no location at `Repositories`.
  Asked at a name the import binds, the servers answer that name's declaration instead.
- The javascript key lists the four declarations of `helpers.js` and counts them (the lane notes:
  glob is `export *`, whose `exact_count` is the number of names crossing the re-export; the task
  note says where the names are declared, not that the answer is one module location), and
  typescript-language-server 6.1.0 asked at `from.symbol` answers the module (`helpers.js:3`),
  which no line of the key names.
- The keys of the shared id disagree: go's (kind `dot_import`, scored by
  `import-precision/candidate` and not changed here) names one member the file uses
  (`FormatReference`) as its candidate, though the file uses more than one; python's
  anchors its names on their re-export lines in `metrics/__init__.py`, and typescript's lists half
  its names by line and half by name only. php's key has rust's form (the eight declarations the
  brace group-use binds, `exact_count` 8; its own source calls the group-use the lane's equivalent
  of the glob question), so php is split only by the shared id and by phpactor answering no
  location at `Repositories`.

So the five stay `UNSCORABLE`, each with its lane's own detail, and the question is open on issue #135.

### String-keyed definitions

| Rule | Surface | Serves | Pass when | Class |
| --- | --- | --- | --- | --- |
| `definition/string-key` | `definition` | kind `string_key`, with `known_sites` and `exact_count` and no target | every declaration the string can select (`known_sites`) is returned, and nothing else | exact |

The lane notes: "a method or class named only by a string built or looked up at runtime and passed
to getattr or importlib: the answer is what the string selects, and no import or call names it".
python `def-string-key-dispatch` asks `getattr(self, f"scope_{scope}")`; the key lists the two
`def scope_...` methods, the only ones in the lane, and `exact_count` 2. Each is matched by its line,
like a `references` site; the line asked from (the `getattr` call) is not neutral, so returning it
fails. The lane's own language server gives no reference answer here: pyright 1.1.414 returns no
location at the string, so this task is beyond its reference, as the kind says. A `string_key` task
that names a target (`file` and `needle`, or `candidate`) keeps the target rules.

### References

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `references/sites` | `references` | `known_sites`, `exact_count` | every site is returned, and nothing else |

An exact rule. The sites are every known site and every line of each `repeated_sites` group, and
`exact_count` must equal their number (`test/sites.test.mjs` holds every lane to it). A site is a
line, so each returned location is matched by its `line` alone: a range stands for its first line,
and one range over a function or a file answers none of the sites inside it. A range whose first
line is itself a site (a function whose signature names the symbol) does match that one site. Two lines are
neutral, returned or not: the line the question is asked from (a tool may list the declaration
among its references) and each optional site. Any other location, or a result without a file and
line, fails the answer, as does a `must_not_include` hit. A task that still carries a floor
(`min_references`) is `UNSCORABLE`. The kinds on these tasks (`name_only`, `type_only`) are labels:
the lists already say which lines count, the string literal lines for `name_only`.

### Implementation lists

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `implementation/list` | `implementation` | `implementations` and a count | every listed declaration is returned, and nothing else |
| `cardinality/list` | `cardinality` | `implementations` and a count | the same |
| `multi-parent/list` | `multi-parent` | `implementations` and a count | the same: the list holds the parents |

An exact rule, the `references` rule over another list. The count is `exact_count`, or
`extends_count` plus `implements_count` on a parents task; it must equal the listed lines (the
same test holds every lane to it), and a task with no count is `UNSCORABLE`, since nothing says its
list is complete. Each entry is matched by its line, the line an implementor is declared on: the
class declaration that names the contract (php, typescript, javascript, python), the
`impl Contract for Type` block (rust), the type declaration (go, where satisfaction is implicit).
Neutral, returned or not: the line asked from, each `known_sites` line, and each `optional_sites`
line (a declaration that satisfies the contract but is not counted, such as an abstract base or an
interface that extends it). The other sub-counts (`nominal_count`, `structural_count`,
`textual_count`, `generated_count`) and `must_include` names are reported as not scored.

Some lists are not implementing types, and their tasks are `UNSCORABLE` under these rules
(`LIST_NOT_TYPES` in `lib/plan.mjs`): `card-rule-contract` in every lane, whose list is half rule
values (instances, object literals, macro arms); go `impl-structural-no-assertion` (struct-literal
values); and the method lists of go `card-embedded-promotion`, rust `def-async-trait-method` and
php `impl-trait-abstract`.

### Document symbols

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `document_symbol/names` | `document_symbol` | `symbols` | the answer's `names` are the file's symbol names, and nothing else |

An exact rule. `symbols` lists every named symbol the file declares, at any nesting depth, as each
lane's `notes` count them (#168). The answer's `names` must equal that list as a multiset: a name
the file declares twice is returned twice, and the order is not judged, since tools nest containers
and flatten them in different orders. `min_symbols` and `must_include` are reported as not scored;
the lane notes' 25% margin for a listing that folds containers is dropped on purpose, since an exact
rule must not pass a listing that misses symbols.

Names are compared by the identifier each declares (`declaredName` in `lib/score.mjs`), on the key
and the answer alike: the text after the last `.` or `::` and without a leading `$`, so a server's
label convention (`(*RepairOrder).TransitionTo` from gopls, `$guarded` from a php server) does not
decide the verdict. A label with no identifier of its own (whitespace remains, as in a rust
`impl HasReference for RepairOrder` block) names a container, not a symbol, and is neutral on both
sides. Each lane's own language server was run on its tasks before any tool under test (#208):
gopls, rust-analyzer, phpactor and typescript-language-server (on `docsym-report-registry`) pass.
Where the server also lists what the lane's counting rule leaves out (pyright lists parameters and
locals; typescript-language-server lists object-literal keys, locals, and `require`
bindings), the key is not changed to fit it and the task is `UNSCORABLE`
(`DOCSYM_REFERENCE_DISAGREES` in `lib/plan.mjs`): python and javascript both tasks, typescript
`docsym-repair-order`. Seven tasks are scored.

### Direction

| Rule | Kinds | Pass when | Class |
| --- | --- | --- | --- |
| `direction/two-sided` | `parent_of`, `child_of`, `used_by`, `uses_self` | the candidate is among the locations for the asked direction, and absent from `reverse_locations`, the locations for the opposite direction | recall-only |
| `direction/list` | `declaration_merge` | the listed declarations are returned, and nothing else | exact |

The lane notes define the kinds: `child_of` asks for a direct parent, `parent_of` for a child, `used_by`
for a user of a trait, `uses_self` for a type that refers to itself through a uses edge (never
extends, implements or embedding), so its candidate, the type's own declaration, must come back as
a use and not as a parent. The two-sided key names one member of a set it does not
list, so the answer is asked both ways: a tool with the edge backwards, or in both directions,
fails, and an answer without `reverse_locations` fails, since nothing shows its direction. Other
locations in the asked direction are not judged, which is why the rule is recall-only. `mro` (the
answer is an order) and `inherent_impl` (the key requires nothing) are `UNSCORABLE` on this surface
(`SURFACE_KIND_UNSCORABLE`); they are not excluded on other surfaces.

### Behaviour

| Rule | Surface | Pass when | Class |
| --- | --- | --- | --- |
| `parse-negative/reported` | `parse-negative` (kind `syntax_error`) | the answer's `parse_errors` holds an entry for the asked file | behaviour |
| `diagnostics/loud` | `diagnostics` (`behavior: loud_degradation`) | the same: the failure is reported, not hidden | behaviour |

The fixtures under `fixtures/broken-syntax/` are broken on purpose. Asked about one, a tool must
say that parsing it failed: `parse_errors` is a list of `{ file, line?, message }`, and an entry
whose `file` is the asked file passes. No entry, or entries only for other files, fails as silently
empty; a tool that crashes is a harness `ERROR`. This is stricter than the key's `must_include`
(a fragment of the file name), which is reported as not scored. The answer is yes or no, so it is
its own class and line.

### Recall rules

| Rule | Surface | Needs | Pass when |
| --- | --- | --- | --- |
| `hover/contains` | `hover` | `contains` | the answer's `text` contains the string |
| `call_hierarchy/callees` | `call_hierarchy` | `outgoing_includes` | every listed callee declaration is returned, by exact line |
| `call_hierarchy/callers` | `call_hierarchy` | `incoming_includes` | every listed call site is covered by a returned location (the caller's range) |

The key lists part of these answers, not all of it, so anything else the answer holds is not
judged, except `must_not_include` entries, which fail it as above. A tool that returns every
function in the lane as a callee would pass, so these rules are a separate class: the report prints
an `exact` line and a `recall-only` line, and the two are never added up. `min_incoming` is printed
as `not scored`: tools count callers per call site or per calling function, and the key does not
say which.

Every surface now has a rule. Tasks no rule covers are `UNSCORABLE` with the reason printed (a
floor, a kind listed above, a key that names no single place, a task without `from.symbol`).

### `must_not_include`

The corpus writes these entries in several forms. Each form has one matching rule. Source text is
matched on the line a location reports and never on the rest of its range, so a declaration's own
body cannot trip an exclusion.

| Form | Example | Hit when |
| --- | --- | --- |
| lane prefix | `php/` | a returned location is under that lane (`scope: repo` only) |
| pattern | `impl .* for Money` | a reported line, or `text`, contains the literal parts in order |
| path and symbol | `app/http#NewServeMux` | a returned location is under the path and its reported line contains the symbol |
| anything else | `models/device.ts`, `BOARD_REFRESH`, `ATELIER_UNIT_SUFFIX = 'u'` | a returned path contains it, a reported line contains it, `names` has it, or `text` contains it |

## How "scorable" is established

By test, not by claim. `test/oracle.test.mjs` runs over every lane and requires, for every task a
rule covers, that the oracle answer passes and that each mutation of it fails. For the exact rules:
two richer forms pass as well (the target with its full range, and the target with every known
site the rule allows), and no location, the line shifted by one, an enclosing range, an unexpected extra location,
a known site returned alone in place of the target, a known site a rule does not allow (the
merged name's declarations, asked about a member) beside the target, and one hit for every
`must_not_include` entry each fail; on a list rule, so do the line asked from where it is not
neutral, and a `candidate` the rule does not read. For the recall rules: an empty answer,
one listed entry missing, one moved by a line, a truncated `contains` string and one hit for every
`must_not_include` entry each fail, and the known limit is pinned as passing (extra text, an extra
location, one range per file over every call site), so a change that closes or widens it shows.
`test/gaps.test.mjs` pins each issue #135 task to the rule or the refusal decided for it, and scores
a fixed answer per ruled task, built from the key's own needles, so a rule that changes what it
reads turns one of them red.
`test/resolve.test.mjs` rebuilds the verifier report for `bench/conformance/` around the scorer's
resolver and compares it byte for byte with `expected.txt`, so the scorer and the lane verifiers
agree on what a needle resolves to. `test/fixture.test.mjs` pins the report format against a small
lane-shaped fixture.

The number of scorable tasks is computed at run time and printed by the tests and by every report.
It is not written down here, because the lanes change.

## Comparing two reports

`compare.mjs` shows what changed between two `score.mjs --format json` reports of the same tool on
the same lane: a tool release against the one before it, or a change you are testing against a
baseline. It knows nothing about any tool.

```
node bench/score/compare.mjs --before before.report.json --after after.report.json
node bench/score/compare.mjs --before before.report.json --after after.report.json --format json
```

What it prints, in this order:

- **One line per rule class and protocol**, as the score report groups them, with `passed of
  scorable` before and after, how many tasks that line gained and lost, and how many of its tasks
  were not compared (they move the totals but are in neither gained nor lost). Lines are never added up.
- **GAINED**: tasks that were not `PASS` and are `PASS`.
- **LOST**: tasks that were `PASS` and are not, with the verdict they have now. A loss is listed
  even when its line's total went up.
- **CHANGED**: every other verdict change (`FAIL` to `UNSUPPORTED`, `UNANSWERED` to `FAIL`).
- **NOT COMPARED**: a task whose `rule`, `class` or `protocol` differs between the reports, or that
  is in one report only. The key or the scorer changed, not the tool, so the task counts in neither
  gains nor losses. Per-line counts still count each report as it was scored.

Ids are sorted and nothing reads a clock: the same two files give the same bytes.

It exits 0 whenever the comparison was made, losses included: a loss is a result. It exits 2, with
one line on stderr, when an input is not a score report, or the two reports are for different lanes,
tool names or scopes. Tool versions may differ; that is what is being compared.

A local before and after, for a tool whose adapter you can run on both versions:

```
node bench/adapters/skybox/run.mjs --lane go --skybox <path to old skybox> --version 0.9.0 --out before.json
node bench/adapters/skybox/run.mjs --lane go --skybox <path to new skybox> --version 0.10.0 --out after.json
node bench/score/score.mjs --lane go --answers before.json --format json > before.report.json
node bench/score/score.mjs --lane go --answers after.json --format json > after.report.json
node bench/score/compare.mjs --before before.report.json --after after.report.json
```

Run both at the same checkout of this repository. A key edit that keeps a task's rule, class and
protocol is not detected: it shows as a gain or a loss, so both reports must be scored at the same
checkout. The `score-tools` workflow does this for skybox when a baseline version is given to a manual
run (`baseline_version`): it scores both versions and adds the comparison to the job summary and to
the lane's artifact.
