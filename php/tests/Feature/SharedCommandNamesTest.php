<?php

namespace Tests\Feature;

use App\Models\Part;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * The shared command names (export-report, recalculate-inventory) are commands of their own in
 * routes/console.php, each handing its input to this lane's atelier:* spelling.
 */
class SharedCommandNamesTest extends TestCase
{
    use RefreshDatabase;

    public function test_shared_names_are_commands_of_their_own(): void
    {
        $all = Artisan::all();
        foreach (['export-report', 'recalculate-inventory', 'atelier:export-report', 'atelier:recalculate-inventory'] as $name) {
            $this->assertArrayHasKey($name, $all);
            $this->assertSame($name, $all[$name]->getName());
        }
        $this->assertNotSame($all['export-report'], $all['atelier:export-report']);
        $this->assertNotSame($all['recalculate-inventory'], $all['atelier:recalculate-inventory']);
    }

    public function test_export_report_renders_what_the_lane_command_renders(): void
    {
        $this->assertSame(0, Artisan::call('atelier:export-report', ['report' => 'cash-flow', 'exporter' => 'json']));
        $lane = $this->withoutTimestamp(Artisan::output());
        $this->assertSame(0, Artisan::call('export-report', ['report' => 'cash-flow', 'exporter' => 'json']));
        $shared = $this->withoutTimestamp(Artisan::output());

        $this->assertStringContainsString('primary=', $shared);
        $this->assertSame($lane, $shared);
    }

    public function test_export_report_passes_a_failure_through(): void
    {
        $this->artisan('export-report', ['report' => 'nope'])->assertExitCode(1);
        $this->artisan('export-report', ['report' => 'cash-flow', 'exporter' => 'nope'])->assertExitCode(1);
    }

    public function test_recalculate_inventory_counts_the_seeded_parts(): void
    {
        $this->seed();
        $parts = Part::count();
        $this->assertGreaterThan(0, $parts);

        $this->artisan('recalculate-inventory', ['--restock' => 5])
            ->expectsOutputToContain("Recalculated stock for {$parts} parts.")
            ->assertExitCode(0);

        // The forwarded level reaches the job: stock is max(level - consumed, 0), so a level of 5
        // caps every part at 5, and a level of 500 lifts at least one part above it.
        $this->assertLessThanOrEqual(5, (int) Part::max('stock'));
        $this->artisan('recalculate-inventory', ['--restock' => 500])->assertExitCode(0);
        $this->assertGreaterThan(5, (int) Part::max('stock'));
    }

    private function withoutTimestamp(string $output): string
    {
        return (string) preg_replace('/^at=\d+$/m', 'at=', $output);
    }
}
