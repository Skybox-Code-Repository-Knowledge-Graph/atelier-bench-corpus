<?php

namespace Tests\Feature;

use App\Bench\Reports\ReportRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SharedParityTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_returns_json_status(): void
    {
        $this->getJson('/health')->assertOk()->assertJson(['status' => 'ok', 'orders' => 0]);
    }

    public function test_health_sets_no_cookie(): void
    {
        $response = $this->getJson('/health')->assertOk();
        $this->assertSame([], $response->headers->getCookies());
    }

    /** @return array<string, array{string}> */
    public static function slugs(): array
    {
        $out = [];
        foreach (ReportRegistry::all() as $class) {
            $slug = Str::kebab(Str::beforeLast(class_basename($class), 'Report'));
            $out[$slug] = [$slug];
        }

        return $out;
    }

    #[DataProvider('slugs')]
    public function test_every_report_slug_resolves(string $slug): void
    {
        $this->getJson("/api/reports/{$slug}")
            ->assertOk()
            ->assertJsonPath('slug', $slug)
            ->assertJsonStructure(['slug', 'title', 'rows']);
    }

    public function test_slug_set_is_the_24_shared_slugs(): void
    {
        $expected = [
            'cash-flow', 'churn-risk', 'customer-lifetime', 'customer-retention', 'daily-revenue',
            'gross-profit', 'inventory-turnover', 'monthly-revenue', 'net-margin', 'order-backlog',
            'order-throughput', 'order-volume', 'part-shortage', 'part-usage', 'payment-default',
            'payment-latency', 'profit-margin', 'technician-efficiency', 'technician-load',
            'technician-payroll', 'warranty-claim', 'warranty-cost', 'warranty-trend', 'weekly-revenue',
        ];
        $actual = array_keys(self::slugs());
        sort($actual);
        $this->assertCount(24, $actual);
        $this->assertSame($expected, $actual);
    }

    public function test_export_report_command_accepts_md(): void
    {
        $this->artisan('atelier:export-report', ['report' => 'cash-flow', 'exporter' => 'md'])->assertExitCode(0);
    }

    public function test_report_by_slug_returns_json(): void
    {
        $this->getJson('/api/reports/cash-flow')
            ->assertOk()
            ->assertJsonPath('slug', 'cash-flow')
            ->assertJsonStructure(['slug', 'title', 'rows']);
    }

    public function test_unknown_report_slug_is_404(): void
    {
        $this->getJson('/api/reports/no-such-report')->assertNotFound();
    }

    public function test_export_report_command_renders_a_report(): void
    {
        $this->artisan('atelier:export-report', ['report' => 'cash-flow', 'exporter' => 'json'])
            ->expectsOutputToContain('primary=')
            ->assertExitCode(0);
    }

    public function test_export_report_command_rejects_unknown_names(): void
    {
        $this->artisan('atelier:export-report', ['report' => 'nope'])->assertExitCode(1);
        $this->artisan('atelier:export-report', ['report' => 'cash-flow', 'exporter' => 'nope'])->assertExitCode(1);
    }
}
