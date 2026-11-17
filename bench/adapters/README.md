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

An adapter never reads `expect`, `note` or any other part of the answer key, and never passes
`kind` or a definition file to the tool. `kind` may decide whether a question is asked; it must
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
  every name that is not unique in the lane is answered with all its candidates and fails.
- Assisted protocols (the adapter narrows candidates with the tool's own graph, for example) may
  come later, each with its own name and its own call budget, written here first.

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
| [skybox](skybox/) | `raw`: one `context(name)`, plus one `cypher` lookup by node id for the line of a resolved symbol | Asked: `definition`, `resolution`, `import-precision`. Not asked under `raw`: a symbol that is a segment of an import path, and the `resolution` kinds whose answer is a relation rather than the symbol's definition (`structural`, `init_order`, `mro`, `derive_generated`, `dyn_upcast`, `blanket_impl`). A `null` symbol is `unsupported`: skybox is asked by name |

To run one locally:

```
node bench/adapters/skybox/run.mjs --lane go --skybox <path to skybox> --version 0.9.0 --out go.skybox.json
node bench/score/score.mjs --lane go --answers go.skybox.json
```
