# Adapters

An adapter asks one code-intelligence tool the corpus's questions and writes the tool's replies in
the answer format of [`bench/score/README.md`](../score/README.md). The scorer then compares that
file with the answer key. The scorer knows nothing about any tool; everything tool-specific lives
in `bench/adapters/<tool>/`.

These rules bind every adapter, so that the numbers of different tools can be compared.

## What an adapter may know

Only the question side of a task, built by [`lib/question.mjs`](lib/question.mjs):

| Field | Use |
| --- | --- |
| `id` | to file the answer under |
| `surface`, `kind` | what sort of question it is, to decide whether and how to ask |
| `from.file`, `from.needle`, `from.line`, `from.text` | where the question is asked from |
| `from.symbol`, `from.occurrence` | which identifier on that line is asked about (issue #145) |
| `direction` | `call_hierarchy` only: `callers` or `callees`, which way the question asks; `null` elsewhere |

An adapter never reads `expect`, `note` or any other part of the answer key, and never passes
`kind` or a file taken from the key to the tool (`from.file` is the question's own file, not the
key's). `kind` may decide whether a question is asked; it must
never be used to filter or reorder what the tool returned.

## What an adapter writes

- **The tool's reply, unedited.** Every result the tool returned goes into `locations`, in a
  stable order (sorted by file, then line), so two runs over the same index write the same bytes.
  A result without a file and line is counted in `unlocated`, never dropped.
- **A negative answer is an answer.** "Not found" is `locations: []` and scores as a failure.
- **A harness failure is an error.** A timeout, a crash, or a reply the adapter cannot parse is
  `status: "error"` with a reason. It must never look like a miss by the tool.
- **`unsupported` only when it is true of the tool**: the tool has no way to be asked this. A
  question the adapter does not implement yet is left out, which the scorer reports as
  `UNANSWERED`.
- **Nothing time-dependent** in the answer file. Timings go to stderr.

## Protocols

An adapter states its `protocol` in the answer file. Results under different protocols are reported
in separate columns, never blended.

- **`raw`**: the fewest calls the tool needs to answer, with no help from the adapter. For a
  name-based tool that is one lookup by `from.symbol`, plus whatever call is needed to read a line
  number from the tool itself. No second guess, no disambiguation by the adapter. A `raw` score for
  a name-based tool therefore measures lookup by bare name: the tool never sees the `from` line, so
  a name that is not unique in the lane is answered with all its candidates, which fails unless the
  key lists the other candidates as known sites (python `def-property` lists the setter beside the
  getter, so both together pass).
- **`anchored`**: for surfaces whose question is asked at a declaration or a use site (`hover`,
  `call_hierarchy`, `references`, and the implementation lists), the `from` file and line are part of the question: a person hovering a name
  is looking at that line. The adapter may pass the file to the tool and take the tool's own node
  at that line; it may not pick among nodes by anything the key states. The adapter's choices
  (which step found the subject) go in `note`.
- **`file`**: for surfaces whose question names a file, not a symbol (`document_symbol`): the
  tool is asked about that file and its reply is listed as it stands.
- Other assisted protocols (the adapter narrows candidates with the tool's own graph, for example)
  may come later, each with its own name and its own call budget, written here first.

An answer file states its protocol per surface when it uses more than one
(`"protocol": { "definition": "raw", "hover": "anchored", … }`). `note` is the adapter's remark on
an answer; the scorer never reads it. `text` holds only text the tool returned.

## Scope

`lane`: the tool indexes one lane directory, copied to a temporary location with its own state
directory, so neither the checkout nor the user's tool configuration is touched. `repo`: the tool
indexes the whole checkout, and same-named symbols in other lanes compete. Each is a separate
column.

## Tests

An adapter's tests replay recorded tool replies (`bench/adapters/<tool>/test/`). They run in the
`score` workflow on every pull request, without installing the tool and without network access.

## Adapters

| Tool | Protocol | Notes |
| --- | --- | --- |
| [skybox](skybox/) | `raw` (definition, resolution, import-precision): one `context(name)`, plus one `cypher` lookup by node id for the line of a resolved symbol. `anchored` (hover, call_hierarchy, references, implementation, cardinality, multi-parent): `context(name, file_path)` and the node at the `from` line, falling back to `context(name)` when the file declares no such name (hover only: on the other surfaces the subject must cover the `from` line); then `cypher` by node id for `description` and `signature` (hover), for the subject's range and its `CALLS` edges (call_hierarchy), or for the `CALLS` and `USES` edges into it (references: an edge that carries a call-site line is answered at that line; one without, the using declaration's range), or for the nodes that reach it by `IMPLEMENTS` and `EXTENDS` edges at any depth, one `cypher` call per step until a step finds nothing new, at most 50 steps (implementation, cardinality) or that it reaches by one such edge (multi-parent), each at its own declaration. `file` (document_symbol): one `cypher` call for every node with a source position in the file (the schema's File, Folder, Community and Process nodes have none), each name as stored, ordered by start line then name, nothing deduplicated or renamed. direction: the two-sided kinds under `anchored`, each asked both ways (`parent_of`: implementors at any depth, opposite its own IMPLEMENTS and EXTENDS edges; `child_of` the reverse; `used_by`: `USES_TRAIT` edges into the trait, opposite out of it), the opposite in `reverse_locations`; the definition kinds (`uses_self`, `declaration_merge`) under `raw`, by bare name, stated per kind in the answer file (`"direction:uses_self": "raw"`) | Not asked under `raw`: a symbol that is a segment of a quoted import path; the `resolution` kinds whose answer is a relation rather than the symbol's definition (`structural`, `init_order`, `mro`, `derive_generated`, `dyn_upcast`, `blanket_impl`); and the `import-precision` kinds that bind a namespace or a whole package, whose answer is the member reached through it (`namespace_import`, `namespace_prefix`, `one_member`, `dot_import`, `side_effect_only`, `no_fanout`). A `null` symbol is `unsupported`: skybox is asked by name. Hover text comes from `description` and `signature` only, never from the node's `content`, which is the source itself; skybox 0.9.0 leaves both empty on typescript, javascript and python nodes (a python docstring is only inside `content`), so hover answers there are empty. php: the tasks whose targets are under `vendor/` are `UNRESOLVED` for the exact rules and unanswerable for hover (`rel-ofmany-builder`), since neither the scorer's checkout nor the adapter's copy has the Composer packages. A php `$variable` or `$property` symbol is asked without its `$`, which is how skybox names the node (`Property:StatusBoard:statusFilter:...`), under both protocols. skybox 0.9.0 records a use of a symbol as `CALLS` edges (every one with its call-site line, all lanes) and `USES` edges (php 355 and go 505, none with a line; rust 1341, 683 with a line; none in typescript, javascript or python), and has no edge for an import of a symbol or a read of a constant or variable; so a typescript, javascript or python references answer holds call sites only, and a php or go answer adds the ranges of the declarations that use the symbol; string literals and module-level variables have no node, so `name_only` event-name tasks and registry variables are answered not found. Its ambiguous reply lists at most 10 candidates; when a name has more, which 10 depends on index order, so the answer bytes for such a name can differ between runs (php `def-nullsafe-chain`: 12 nodes named `label`) |

To run one locally:

```
node bench/adapters/skybox/run.mjs --lane go --skybox <path to skybox> --version 0.9.0 --out go.skybox.json
node bench/score/score.mjs --lane go --answers go.skybox.json
```
