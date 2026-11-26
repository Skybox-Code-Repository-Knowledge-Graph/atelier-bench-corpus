# Fixtures

`broken-syntax/` holds files that MUST NOT parse. They exist to measure how
indexers and language servers behave on malformed input (loud degradation,
no crash, no silent tree-skip). They are outside composer autoload and
outside the `php -l` sweep over the source tree. `php bench/verify_tasks.php
--lint` asserts the opposite for each of them, file by file, under the parser
its `parse-negative` task names: `php -l` must fail on a `.php` file; a
`.blade.php` file is compiled with the Blade compiler (needs `vendor/`) and
`php -l` must fail on the compiled PHP. A fixture that parses, or one with any
other extension, fails the lint.

Do not "fix" these files.
