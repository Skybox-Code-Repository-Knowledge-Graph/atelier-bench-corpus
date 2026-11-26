<?php

namespace Tests\Feature;

use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * bench/lsp_check.php (checklist E.5) needs a language server to run for real; its --plan mode
 * needs none. The plan must ask every hover, document_symbol, call_hierarchy and implementation
 * task once, in tasks.json order, at a column inside the task's from.symbol on its from line.
 */
class LspCheckPlanTest extends TestCase
{
    private const SURFACES = ['hover', 'document_symbol', 'call_hierarchy', 'implementation'];

    public function test_plan_asks_every_language_server_task_at_its_symbol(): void
    {
        $process = new Process([PHP_BINARY, 'bench/lsp_check.php', '--plan'], base_path());
        $process->mustRun();
        $lines = array_values(array_filter(explode("\n", trim($process->getOutput()))));
        $summary = array_pop($lines);

        $tasks = array_values(array_filter(
            json_decode((string) file_get_contents(base_path('bench/tasks.json')), true)['tasks'],
            fn (array $task): bool => in_array($task['surface'], self::SURFACES, true),
        ));
        $this->assertGreaterThan(0, count($tasks));
        $this->assertSame(sprintf('plan: %d tasks over %s', count($tasks), implode(', ', self::SURFACES)), $summary);
        $this->assertCount(count($tasks), $lines);

        foreach ($tasks as $i => $task) {
            [$id, $surface, $methods, $at] = explode(' ', $lines[$i]);
            [$file, $row, $column] = explode(':', $at);
            $this->assertSame([$task['id'], $task['surface'], $task['from']['file']], [$id, $surface, $file]);

            $text = file(base_path($file), FILE_IGNORE_NEW_LINES)[(int) $row - 1];
            $this->assertStringContainsString($task['from']['needle'], $text, $id);

            if ($surface === 'document_symbol') {
                $this->assertSame('textDocument/documentSymbol', $methods);

                continue;
            }
            $symbol = $task['from']['symbol'];
            $starts = [];
            for ($s = strpos($text, $symbol); $s !== false; $s = strpos($text, $symbol, $s + 1)) {
                $starts[] = $s;
            }
            $inside = array_filter($starts, fn (int $s): bool => $s <= (int) $column && (int) $column < $s + strlen($symbol));
            $this->assertNotEmpty($inside, "$id: column $column is not inside $symbol");
        }
    }
}
