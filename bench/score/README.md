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
| `protocol` | How the adapter asked (see `bench/adapters/README.md`): one name, or an object from surface to name when it differs by surface. Reported, never scored |
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
- A task that carries `exact_count` beside a target is `UNSCORABLE`: the count is an overload
  count in one task and a parameter count in another.
- `kind` and `resolution` are labels and are never scored. The kinds these four rules cover were
  reviewed against the lanes' `notes`. One, `build_generated`, is excluded (`KIND_UNSCORABLE` in
  `lib/plan.mjs`): its key names two places, so a tool that returns either one alone would fail.

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

Not covered yet, reported `UNSCORABLE`: `direction`, `parse-negative`, `diagnostics`, and tasks
whose only expectation is a count.

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
site), and no location, the line shifted by one, an enclosing range, an unexpected extra location
and one hit for every `must_not_include` entry each fail. For the recall rules: an empty answer,
one listed entry missing, one moved by a line, a truncated `contains` string and one hit for every
`must_not_include` entry each fail, and the known limit is pinned as passing (extra text, an extra
location, one range per file over every call site), so a change that closes or widens it shows.
`test/resolve.test.mjs` rebuilds the verifier report for `bench/conformance/` around the scorer's
resolver and compares it byte for byte with `expected.txt`, so the scorer and the lane verifiers
agree on what a needle resolves to. `test/fixture.test.mjs` pins the report format against a small
lane-shaped fixture.

The number of scorable tasks is computed at run time and printed by the tests and by every report.
It is not written down here, because the lanes change.
