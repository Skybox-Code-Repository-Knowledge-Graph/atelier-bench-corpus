<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SharedParityTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_returns_json_status(): void
    {
        $this->getJson('/health')->assertOk()->assertJson(['status' => 'ok']);
    }

    public function test_report_by_slug_returns_json(): void
    {
        $this->getJson('/api/reports/cash-flow')
            ->assertOk()
            ->assertJsonPath('slug', 'cash-flow')
            ->assertJsonStructure(['slug', 'title', 'data']);
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
