<?php

namespace Tests\Feature;

use Composer\Autoload\ClassLoader;
use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Tests\Support\SpecifierScanner;
use Tests\TestCase;

/**
 * Checklist F.1: every module specifier written anywhere in the lane resolves.
 *
 * Walks the whole lane (vendor/, node_modules/, storage/, bootstrap/cache/ and
 * the intentionally broken fixtures/ excluded), scans every PHP file plus the
 * `artisan` script, and every Blade view after compiling it (Volt and Folio
 * pages carry their imports in `<?php` blocks). See SpecifierScanner for what
 * counts as a specifier: imports of every form, trait uses, qualified names in
 * code, and docblock type names, docblock-only and type-only uses included.
 */
class SpecifierResolutionTest extends TestCase
{
    private const SKIP_DIRS = ['vendor', 'node_modules', 'storage', 'fixtures', '.git', 'bootstrap/cache'];

    public function test_every_specifier_in_the_lane_resolves(): void
    {
        $failures = [];
        $stats = ['files' => 0, 'blade' => 0, 'namespace_prefix' => 0];
        $byKind = [];

        foreach ($this->laneSources() as $relative => $code) {
            $stats['files']++;
            if (str_ends_with($relative, '.blade.php')) {
                $stats['blade']++;
            }
            foreach (SpecifierScanner::scan($code) as $spec) {
                $key = $spec['origin'] . ':' . $spec['kind'];
                $byKind[$key] = ($byKind[$key] ?? 0) + 1;
                $how = $this->resolution($spec['kind'], $spec['name']);
                if ($how === null) {
                    $failures[] = "{$relative}:{$spec['line']} {$spec['origin']} {$spec['kind']} {$spec['name']}";
                } elseif ($how === 'namespace') {
                    $stats['namespace_prefix']++;
                }
            }
        }

        $this->assertSame([], $failures, 'unresolved module specifiers:' . PHP_EOL . implode(PHP_EOL, $failures));

        // Non-vacuous: every specifier form the lane writes was seen.
        $this->assertGreaterThan(300, $stats['files']);
        $this->assertGreaterThan(5, $stats['blade']);
        $this->assertGreaterThanOrEqual(2, $stats['namespace_prefix']);
        foreach (['import:class-or-namespace', 'import:function', 'import:const', 'trait:trait', 'code:any', 'docblock:class'] as $kind) {
            $this->assertGreaterThan(0, $byKind[$kind] ?? 0, "no {$kind} specifier scanned");
        }
    }

    public function test_the_scanner_reports_each_broken_form(): void
    {
        $code = <<<'PHP'
        <?php
        namespace App\Probe;

        use App\Models\RepairOrdr;
        use App\Bench\Ruls;
        use function App\Support\atelier_format_unt;
        use const App\Support\ATELIER_UNIT_SUFIX;
        use App\Bench\Repositories\{CustomerRepository, CustomerRepositry};
        use App\Models\Part;

        /**
         * @mixin \App\Models\Custmer
         * @property Prat $part
         * @method \Carbon\CarbonImmutabl at(\Carbon\CarbonImmutable $when)
         */
        class Probe
        {
            use \App\Concerns\HasRefrence;

            /** @param Part $part @return Missing */
            public function run(Part $part): string
            {
                return \App\Support\NoSuchClass::class;
            }
        }
        PHP;

        $unresolved = [];
        foreach (SpecifierScanner::scan($code) as $spec) {
            if ($this->resolution($spec['kind'], $spec['name']) === null) {
                $unresolved[] = $spec['name'];
            }
        }
        sort($unresolved);

        $this->assertSame([
            'App\\Bench\\Repositories\\CustomerRepositry',
            'App\\Bench\\Ruls',
            'App\\Concerns\\HasRefrence',
            'App\\Models\\Custmer',
            'App\\Models\\RepairOrdr',
            'App\\Probe\\Prat',
            'App\\Support\\ATELIER_UNIT_SUFIX',
            'App\\Support\\NoSuchClass',
            'App\\Support\\atelier_format_unt',
            'Carbon\\CarbonImmutabl',
        ], $unresolved);
    }

    /** @return iterable<string, string> lane-relative path => PHP source (Blade compiled) */
    private function laneSources(): iterable
    {
        $root = base_path();
        $iterator = new RecursiveIteratorIterator(
            new \RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
                function (\SplFileInfo $file) use ($root): bool {
                    $relative = ltrim(substr($file->getPathname(), strlen($root)), '/');

                    return ! ($file->isDir() && in_array($relative, self::SKIP_DIRS, true));
                },
            ),
        );

        $paths = ['artisan'];
        foreach ($iterator as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
                $paths[] = ltrim(substr($file->getPathname(), strlen($root)), '/');
            }
        }
        sort($paths);

        $blade = app('blade.compiler');
        foreach ($paths as $relative) {
            $source = (string) file_get_contents($root . '/' . $relative);
            yield $relative => str_ends_with($relative, '.blade.php') ? $blade->compileString($source) : $source;
        }
    }

    /** How a specifier resolves: 'symbol', 'namespace' (a PSR-4 directory holding PHP files), or null. */
    private function resolution(string $kind, string $name): ?string
    {
        $classLike = static fn (string $n): bool => class_exists($n) || interface_exists($n) || trait_exists($n) || enum_exists($n);

        $resolved = match ($kind) {
            'class', 'class-or-namespace' => $classLike($name),
            'trait' => trait_exists($name),
            'function' => function_exists($name),
            'const' => defined($name),
            'any' => $classLike($name) || function_exists($name) || defined($name),
        };
        if ($resolved) {
            return 'symbol';
        }

        return $kind === 'class-or-namespace' && $this->isNamespaceDirectory($name) ? 'namespace' : null;
    }

    private function isNamespaceDirectory(string $name): bool
    {
        foreach (ClassLoader::getRegisteredLoaders() as $loader) {
            foreach ($loader->getPrefixesPsr4() as $prefix => $dirs) {
                if (! str_starts_with($name . '\\', $prefix)) {
                    continue;
                }
                $relative = str_replace('\\', '/', substr($name, strlen($prefix)));
                foreach ($dirs as $dir) {
                    $candidate = rtrim($dir . '/' . $relative, '/');
                    if (is_dir($candidate) && glob($candidate . '/*.php') !== []) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
