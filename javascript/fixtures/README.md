# fixtures

Negative cases for parsers and indexers. **Do not fix anything in here.**

| Path | Why it exists |
| --- | --- |
| `broken-syntax/type_annotation.js` | TypeScript-only syntax in a `.js` file (parameter and return type annotations, an `interface` declaration): a JavaScript parser must report an error, never strip the types and index the rest |
| `broken-syntax/bad_destructure.cjs` | Unbalanced destructuring patterns and an unclosed `require(` call |
| `broken-syntax/unclosed_class.js` | Unterminated class body and a last method left open: the parser must report an error, not a partial tree |

`jsconfig.json` excludes `fixtures/`, and nothing under `packages/` imports these files, so
`npm test` never loads them.

`node bench/verify-tasks/verify.mjs --lint` asserts the opposite of the usual check: every file
here must still **fail** `node --check`.
