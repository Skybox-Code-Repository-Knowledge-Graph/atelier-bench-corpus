<?php

namespace Tests\Feature;

use App\Bench\Contracts\AuditableContract;
use App\Bench\Contracts\CacheableContract;
use App\Bench\Contracts\ExporterContract;
use App\Bench\Contracts\FormatterContract;
use App\Bench\Contracts\MetricContract;
use App\Bench\Contracts\NotifierContract;
use App\Bench\Contracts\ReportContract;
use App\Bench\Contracts\RepositoryContract;
use App\Bench\Contracts\RuleContract;
use App\Bench\Contracts\ScheduleContract;
use App\Bench\Support\AbstractComponent;
use App\Bench\Support\AbstractService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PhpToken;
use ReflectionClass;
use Tests\TestCase;

/**
 * Checklist F.5: every source file the lane adds is loaded by the suite, and
 * every bench component is called through its contract, so no file can sit
 * broken (a bad signature, a missing parent, a wrong return type) unseen.
 */
class LaneFilesLoadTest extends TestCase
{
    use RefreshDatabase;

    /** Source directories the lane adds code to (bench/verify_tasks.php is a CLI script CI runs itself). */
    private const SOURCE_DIRS = ['app', 'bootstrap', 'config', 'database', 'lang', 'routes'];

    public function test_every_lane_source_file_loads(): void
    {
        $files = $this->sourceFiles();
        $declared = 0;

        foreach ($files as $relative => $path) {
            $names = $this->declaredClassLikes((string) file_get_contents($path));
            if ($names !== []) {
                foreach ($names as $name) {
                    $this->assertTrue(
                        class_exists($name) || interface_exists($name) || trait_exists($name) || enum_exists($name),
                        "{$relative}: {$name} does not autoload",
                    );
                    $declared++;
                }

                continue;
            }

            // No named class-like: a config/lang array, a route file, an anonymous
            // migration class, or a function/const file. config/ and lang/ files are
            // plain returns, safe to require again even when the boot already included
            // them, so the array check always runs.
            if (str_starts_with($relative, 'config/') || str_starts_with($relative, 'lang/')) {
                $this->assertIsArray(require $path, "{$relative} must return an array");
            } elseif (! in_array(realpath($path), array_map('realpath', get_included_files()), true)) {
                $result = require_once $path;
                if (str_starts_with($relative, 'database/migrations/')) {
                    $this->assertInstanceOf(Migration::class, $result, "{$relative} must return a Migration");
                }
            }
        }

        $included = array_flip(array_filter(array_map('realpath', get_included_files())));
        $missing = array_keys(array_filter($files, fn (string $path): bool => ! isset($included[realpath($path)])));

        $this->assertSame([], $missing, 'lane files never loaded');
        $this->assertGreaterThan(330, count($files));
        $this->assertGreaterThan(250, $declared);
    }

    public function test_every_bench_component_honours_its_contract(): void
    {
        $calls = [];
        $rows = [['label' => 'parts', 'value' => 3], ['label' => 'labor', 'value' => 5]];

        foreach ($this->sourceFiles() as $relative => $path) {
            if (! str_starts_with($relative, 'app/Bench/')) {
                continue;
            }
            foreach ($this->declaredClassLikes((string) file_get_contents($path)) as $class) {
                $reflection = new ReflectionClass($class);
                if (! $reflection->isInstantiable()) {
                    continue;
                }
                $component = app($class);

                if ($component instanceof RuleContract) {
                    $component->evaluate($rows);
                    $calls['rule'][] = $class;
                }
                if ($component instanceof MetricContract) {
                    $this->assertIsFloat($component->value());
                    $this->assertNotSame('', $component->label());
                    $calls['metric'][] = $class;
                }
                if ($component instanceof FormatterContract) {
                    $this->assertNotSame('', $component->format(12.5));
                    $calls['formatter'][] = $class;
                }
                if ($component instanceof NotifierContract) {
                    $component->notify('order AT-2026-000001 completed');
                    $calls['notifier'][] = $class;
                }
                if ($component instanceof ExporterContract) {
                    $this->assertNotSame('', $component->export($rows));
                    $calls['exporter'][] = $class;
                }
                if ($component instanceof ReportContract) {
                    $component->generate();
                    $this->assertNotSame('', $component->title());
                    $calls['report'][] = $class;
                }
                if ($component instanceof CacheableContract) {
                    $this->assertNotSame('', $component->cacheKey());
                    $component->ttl();
                }
                if ($component instanceof ScheduleContract) {
                    $this->assertNotSame('', $component->frequency());
                }
                if ($component instanceof AuditableContract) {
                    $component->auditTrail();
                }
                if ($component instanceof RepositoryContract) {
                    $this->assertCount($component->count(), $component->all());
                    $component->sum();
                    $calls['repository'][] = $class;
                }
                if ($component instanceof AbstractService) {
                    $component->run();
                    $calls['service'][] = $class;
                }
                if ($component instanceof AbstractComponent) {
                    $this->assertStringStartsWith($class . ':', $component->describe());
                }
            }
        }

        $this->assertSame(
            ['exporter' => 8, 'formatter' => 16, 'metric' => 16, 'notifier' => 8, 'report' => 24, 'repository' => 8, 'rule' => 48, 'service' => 36],
            array_map('count', $this->sorted($calls)),
        );
    }

    /** @return array<string, string> lane-relative path => absolute path, sorted */
    private function sourceFiles(): array
    {
        $files = [];
        foreach (self::SOURCE_DIRS as $dir) {
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path($dir), \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                $relative = $dir . substr($file->getPathname(), strlen(base_path($dir)));
                if ($file->isFile() && str_ends_with($relative, '.php') && ! str_starts_with($relative, 'bootstrap/cache/')) {
                    $files[$relative] = $file->getPathname();
                }
            }
        }
        ksort($files);

        return $files;
    }

    /** @return list<string> fully-qualified names of the named class-likes a file declares */
    private function declaredClassLikes(string $code): array
    {
        $tokens = array_values(array_filter(
            PhpToken::tokenize($code),
            fn (PhpToken $t): bool => ! $t->is([T_WHITESPACE, T_COMMENT, T_DOC_COMMENT]),
        ));
        $namespace = '';
        $names = [];
        foreach ($tokens as $i => $token) {
            if ($token->is(T_NAMESPACE) && isset($tokens[$i + 1]) && $tokens[$i + 1]->is([T_STRING, T_NAME_QUALIFIED])) {
                $namespace = $tokens[$i + 1]->text;
            }
            if ($token->is([T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM])
                && isset($tokens[$i + 1]) && $tokens[$i + 1]->is(T_STRING)
                && ! ($i > 0 && $tokens[$i - 1]->is([T_DOUBLE_COLON, T_NEW]))) {
                $names[] = ltrim($namespace . '\\' . $tokens[$i + 1]->text, '\\');
            }
        }

        return $names;
    }

    /** @param array<string, list<string>> $calls */
    private function sorted(array $calls): array
    {
        ksort($calls);

        return $calls;
    }
}
