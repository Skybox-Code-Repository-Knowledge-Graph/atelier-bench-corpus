<?php

namespace Tests\Support;

use PhpToken;

/**
 * Collects every module specifier a PHP source text writes, with the name it
 * resolves to under PHP's own name-resolution rules:
 *
 * - import: each name a top-level `use` binds (class, `use function`,
 *   `use const`, brace groups, aliases, a namespace bound as a prefix);
 * - trait: each trait named by a `use` inside a class body, and each trait
 *   named in its `insteadof` / `as` conflict block;
 * - code: each qualified or fully-qualified name written in code;
 * - docblock: each class-like name in a docblock type position (@param,
 *   @return, @var, @property*, @method, @throws, @mixin, @extends,
 *   @implements, @use, @template bounds, @see), resolved through the file's
 *   imports and namespace. Names declared by @template are type parameters,
 *   not specifiers; lowercase unqualified names are PHP or PHPDoc built-in types.
 *
 * Unqualified names written in code are not specifiers and are not collected.
 */
final class SpecifierScanner
{
    private const DOC_TAGS = 'param|var|return|property|property-read|property-write|throws|mixin|extends|implements|use|template-extends|template-implements|template-use|see|method|template|template-covariant|template-contravariant';

    /**
     * @return list<array{origin: string, kind: string, name: string, line: int}>
     *   kind: class | function | const | class-or-namespace | trait | any
     */
    public static function scan(string $code): array
    {
        $tokens = PhpToken::tokenize($code);
        $count = count($tokens);
        $found = [];

        $namespace = '';
        $nsIndex = 0;
        $tables = [0 => self::emptyImports()];
        $imports = &$tables[0];
        $docblocks = [];
        $templates = [];
        $depth = 0;
        $classDepths = [];
        $pendingClassBody = false;
        $prevSig = null;

        $next = static function (int $i) use ($tokens, $count): int {
            for ($j = $i + 1; $j < $count; $j++) {
                if (! $tokens[$j]->is([T_WHITESPACE, T_COMMENT, T_DOC_COMMENT])) {
                    return $j;
                }
            }

            return $count;
        };

        for ($i = 0; $i < $count; $i++) {
            $t = $tokens[$i];

            if ($t->is([T_WHITESPACE, T_COMMENT, T_INLINE_HTML, T_OPEN_TAG, T_CLOSE_TAG])) {
                continue;
            }

            if ($t->is(T_DOC_COMMENT)) {
                $docblocks[] = ['text' => $t->text, 'line' => $t->line, 'namespace' => $namespace, 'ns' => $nsIndex];
                if (preg_match_all('/@(?:phpstan-|psalm-)?template(?:-covariant|-contravariant)?\s+([A-Za-z_]\w*)/', $t->text, $m)) {
                    foreach ($m[1] as $name) {
                        $templates[$name] = true;
                    }
                }
                continue;
            }

            if ($t->is(T_NAMESPACE)) {
                $j = $next($i);
                if ($j < $count && $tokens[$j]->is([T_STRING, T_NAME_QUALIFIED])) {
                    $namespace = $tokens[$j]->text;
                    $nsIndex++;
                    $tables[$nsIndex] = self::emptyImports();
                    unset($imports);
                    $imports = &$tables[$nsIndex];
                    $i = $j;
                    $prevSig = $tokens[$j];
                    continue;
                }
                if ($j < $count && $tokens[$j]->text === '{') {
                    $namespace = '';
                    $nsIndex++;
                    $tables[$nsIndex] = self::emptyImports();
                    unset($imports);
                    $imports = &$tables[$nsIndex];
                }
                $prevSig = $t;
                continue;
            }

            if ($t->is([T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM]) && ! ($prevSig !== null && $prevSig->is(T_DOUBLE_COLON))) {
                $pendingClassBody = true;
            }

            if ($t->text === '{' || $t->is([T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES])) {
                $depth++;
                if ($pendingClassBody && $t->text === '{') {
                    $classDepths[] = $depth;
                    $pendingClassBody = false;
                }
                $prevSig = $t;
                continue;
            }

            if ($t->text === '}') {
                if ($classDepths !== [] && end($classDepths) === $depth) {
                    array_pop($classDepths);
                }
                $depth--;
                $prevSig = $t;
                continue;
            }

            if ($t->is(T_USE)) {
                $j = $next($i);
                if ($j < $count && $tokens[$j]->text === '(') {
                    $prevSig = $t;
                    continue; // closure `use ($var)`
                }
                if ($classDepths !== [] && end($classDepths) === $depth) {
                    $i = self::traitUse($tokens, $j, $next, $namespace, $imports, $found);
                } else {
                    $i = self::importClause($tokens, $j, $next, $namespace, $imports, $found);
                }
                $prevSig = $tokens[$i] ?? $t;
                continue;
            }

            if ($t->is([T_NAME_FULLY_QUALIFIED, T_NAME_QUALIFIED, T_NAME_RELATIVE])) {
                $found[] = ['origin' => 'code', 'kind' => 'any', 'name' => self::resolveClass($t->text, $namespace, $imports['class']), 'line' => $t->line];
            }

            $prevSig = $t;
        }

        foreach ($docblocks as $doc) {
            $docImports = $tables[$doc['ns']];
            foreach (self::docNames($doc['text'], $templates) as [$kind, $raw, $offsetLine]) {
                $name = $kind === 'function'
                    ? self::resolveFunction($raw, $doc['namespace'], $docImports['function'])
                    : self::resolveClass($raw, $doc['namespace'], $docImports['class']);
                $found[] = ['origin' => 'docblock', 'kind' => $kind, 'name' => $name, 'line' => $doc['line'] + $offsetLine];
            }
        }

        return $found;
    }

    /** @return array{class: array<string, string>, function: array<string, string>, const: array<string, string>} */
    private static function emptyImports(): array
    {
        return ['class' => [], 'function' => [], 'const' => []];
    }

    /**
     * Parses `use [function|const] A\B [as C], ...;` and `use [function|const] A\{B, function c, const D as E};`
     * starting at token $j (the first token after `use`). Returns the index of the closing `;`.
     *
     * @param  list<PhpToken>  $tokens
     */
    private static function importClause(array $tokens, int $j, \Closure $next, string $namespace, array &$imports, array &$found): int
    {
        $count = count($tokens);
        $clauseKind = 'class';
        if ($j < $count && $tokens[$j]->is(T_FUNCTION)) {
            $clauseKind = 'function';
            $j = $next($j);
        } elseif ($j < $count && $tokens[$j]->is(T_CONST)) {
            $clauseKind = 'const';
            $j = $next($j);
        }

        while ($j < $count && $tokens[$j]->text !== ';') {
            $tok = $tokens[$j];
            if (! $tok->is([T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED])) {
                $j = $next($j);
                continue;
            }
            $prefix = ltrim($tok->text, '\\');
            $k = $next($j);
            if ($k < $count && $tokens[$k]->is(T_NS_SEPARATOR)) {
                // group: Prefix\{ item, item }
                $k = $next($k); // '{'
                $k = $next($k);
                while ($k < $count && $tokens[$k]->text !== '}') {
                    $itemKind = $clauseKind;
                    if ($tokens[$k]->is(T_FUNCTION)) {
                        $itemKind = 'function';
                        $k = $next($k);
                    } elseif ($tokens[$k]->is(T_CONST)) {
                        $itemKind = 'const';
                        $k = $next($k);
                    }
                    if ($tokens[$k]->is([T_STRING, T_NAME_QUALIFIED])) {
                        $full = $prefix . '\\' . $tokens[$k]->text;
                        $line = $tokens[$k]->line;
                        $k = $next($k);
                        $alias = self::lastSegment($full);
                        if ($k < $count && $tokens[$k]->is(T_AS)) {
                            $k = $next($k);
                            $alias = $tokens[$k]->text;
                            $k = $next($k);
                        }
                        self::bind($itemKind, $full, $alias, $line, $imports, $found);
                        continue;
                    }
                    $k = $next($k);
                }
                $j = $next($k);
                continue;
            }
            $alias = self::lastSegment($prefix);
            if ($k < $count && $tokens[$k]->is(T_AS)) {
                $k = $next($k);
                $alias = $tokens[$k]->text;
                $k = $next($k);
            }
            self::bind($clauseKind, $prefix, $alias, $tok->line, $imports, $found);
            $j = $k;
        }

        return $j;
    }

    private static function bind(string $kind, string $full, string $alias, int $line, array &$imports, array &$found): void
    {
        if ($kind === 'class') {
            $imports['class'][strtolower($alias)] = $full;
            $found[] = ['origin' => 'import', 'kind' => 'class-or-namespace', 'name' => $full, 'line' => $line];

            return;
        }
        if ($kind === 'function') {
            $imports['function'][strtolower($alias)] = $full;
        } else {
            $imports['const'][$alias] = $full;
        }
        $found[] = ['origin' => 'import', 'kind' => $kind, 'name' => $full, 'line' => $line];
    }

    /**
     * Parses `use A, B;` or `use A, B { A::x insteadof B; B::y as z; }` inside a class body.
     *
     * @param  list<PhpToken>  $tokens
     */
    private static function traitUse(array $tokens, int $j, \Closure $next, string $namespace, array $imports, array &$found): int
    {
        $count = count($tokens);
        while ($j < $count && $tokens[$j]->text !== ';' && $tokens[$j]->text !== '{') {
            if ($tokens[$j]->is([T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED])) {
                $found[] = ['origin' => 'trait', 'kind' => 'trait', 'name' => self::resolveClass($tokens[$j]->text, $namespace, $imports['class']), 'line' => $tokens[$j]->line];
            }
            $j = $next($j);
        }
        if ($j < $count && $tokens[$j]->text === '{') {
            $j = $next($j);
            while ($j < $count && $tokens[$j]->text !== '}') {
                $tok = $tokens[$j];
                $after = $next($j);
                $isTraitRef = $tok->is([T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED])
                    && ($after < $count && $tokens[$after]->is(T_DOUBLE_COLON));
                $prev = $j - 1;
                while ($prev >= 0 && $tokens[$prev]->is(T_WHITESPACE)) {
                    $prev--;
                }
                $afterInsteadof = $prev >= 0 && $tokens[$prev]->is(T_INSTEADOF)
                    || ($prev >= 0 && $tokens[$prev]->text === ',' && self::insteadofOpen($tokens, $prev));
                if ($tok->is([T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED]) && ($isTraitRef || $afterInsteadof)) {
                    $found[] = ['origin' => 'trait', 'kind' => 'trait', 'name' => self::resolveClass($tok->text, $namespace, $imports['class']), 'line' => $tok->line];
                }
                $j = $after;
            }
        }

        return $j;
    }

    /** True when the nearest `insteadof` / `;` before token $i is an `insteadof` (a list `insteadof A, B`). */
    private static function insteadofOpen(array $tokens, int $i): bool
    {
        for ($k = $i; $k >= 0; $k--) {
            if ($tokens[$k]->is(T_INSTEADOF)) {
                return true;
            }
            if ($tokens[$k]->text === ';' || $tokens[$k]->text === '{') {
                return false;
            }
        }

        return false;
    }

    /**
     * @param  array<string, true>  $templates
     * @return list<array{0: string, 1: string, 2: int}> [kind, raw name, line offset within the docblock]
     */
    private static function docNames(string $doc, array $templates): array
    {
        $out = [];
        foreach (preg_split('/\R/', $doc) as $offset => $line) {
            if (! preg_match('/@(?:phpstan-|psalm-)?(' . self::DOC_TAGS . ')(?![\w-])(.*)$/', $line, $m)) {
                continue;
            }
            $tag = $m[1];
            $rest = trim(preg_replace('/\*\/\s*$/', '', $m[2]));

            if (str_starts_with($tag, 'template') && ! str_contains($tag, '-extends') && ! str_contains($tag, '-implements') && ! str_contains($tag, '-use')) {
                if (preg_match('/^[A-Za-z_]\w*\s+(?:of|as)\s+(.+)$/', $rest, $b)) {
                    foreach (self::typeNames(self::typeExpression($b[1]), $templates) as $name) {
                        $out[] = ['class', $name, $offset];
                    }
                }
                continue;
            }

            if ($tag === 'see') {
                $target = strtok($rest, " \t") ?: '';
                if ($target === '' || str_contains($target, '://')) {
                    continue;
                }
                if (str_contains($target, '::')) {
                    $out[] = ['class', strstr($target, '::', true), $offset];
                } elseif (str_ends_with($target, '()')) {
                    $out[] = ['function', substr($target, 0, -2), $offset];
                } elseif (preg_match('/^\\\\?[A-Z]/', $target)) {
                    $out[] = ['class', $target, $offset];
                }
                continue;
            }

            if ($tag === 'method') {
                // `[static] [ReturnType] name(ParamType $p, ...)`: names up to the closing parenthesis.
                $sig = preg_match('/^(.*?\))/', $rest, $s) ? $s[1] : $rest;
                $sig = preg_replace('/(?<![\w\\\\])[A-Za-z_]\w*\s*\(/', '(', $sig); // drop the method name
                foreach (self::typeNames($sig, $templates) as $name) {
                    $out[] = ['class', $name, $offset];
                }
                continue;
            }

            foreach (self::typeNames(self::typeExpression($rest), $templates) as $name) {
                $out[] = ['class', $name, $offset];
            }
        }

        return $out;
    }

    /** The leading type expression of a tag body: up to the first whitespace outside brackets. */
    private static function typeExpression(string $rest): string
    {
        $depth = 0;
        $len = strlen($rest);
        for ($i = 0; $i < $len; $i++) {
            $c = $rest[$i];
            if (str_contains('<({[', $c)) {
                $depth++;
            } elseif (str_contains('>)}]', $c)) {
                $depth--;
            } elseif (ctype_space($c) && $depth <= 0) {
                // `Foo | Bar` and `Foo, Bar` inside generics stay together; a top-level space ends the type.
                return substr($rest, 0, $i);
            }
        }

        return $rest;
    }

    /**
     * @param  array<string, true>  $templates
     * @return list<string>
     */
    private static function typeNames(string $type, array $templates): array
    {
        $type = preg_replace('/\$\w+/', ' ', $type);
        $type = preg_replace("/'[^']*'|\"[^\"]*\"/", ' ', $type);
        preg_match_all('/(?<![\w\\\\:$-])(\\\\?[A-Za-z_]\w*(?:\\\\[A-Za-z_]\w*)*)(?![\w\\\\-])(?!\s*\??:(?!:))/', $type, $m);
        $names = [];
        foreach ($m[1] as $name) {
            $qualified = str_contains($name, '\\');
            if (! $qualified && (ctype_lower($name[0]) || $name[0] === '_')) {
                continue; // int, string, array-key, list, class-string, self, static, ...
            }
            if (! $qualified && isset($templates[$name])) {
                continue;
            }
            $names[] = $name;
        }

        return $names;
    }

    /** @param array<string, string> $classImports */
    private static function resolveClass(string $name, string $namespace, array $classImports): string
    {
        if (str_starts_with($name, '\\')) {
            return ltrim($name, '\\');
        }
        if (str_starts_with(strtolower($name), 'namespace\\')) {
            return ltrim($namespace . '\\' . substr($name, 10), '\\');
        }
        $first = strtolower(strtok($name, '\\'));
        if (isset($classImports[$first])) {
            $rest = str_contains($name, '\\') ? substr($name, strpos($name, '\\')) : '';

            return $classImports[$first] . $rest;
        }

        return ltrim($namespace . '\\' . $name, '\\');
    }

    /** @param array<string, string> $functionImports */
    private static function resolveFunction(string $name, string $namespace, array $functionImports): string
    {
        if (str_starts_with($name, '\\')) {
            return ltrim($name, '\\');
        }

        return $functionImports[strtolower($name)] ?? ltrim($namespace . '\\' . $name, '\\');
    }

    private static function lastSegment(string $name): string
    {
        $pos = strrpos($name, '\\');

        return $pos === false ? $name : substr($name, $pos + 1);
    }
}
