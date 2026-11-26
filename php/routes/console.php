<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// The shared command names every lane carries (export-report, recalculate-inventory). Each one is
// a command of its own that hands its input to this lane's atelier:* spelling, which stays.
Artisan::command('export-report {report : Report slug, e.g. cash-flow} {exporter=json : Exporter name, e.g. json, csv}', function (string $report, string $exporter): int {
    return $this->call('atelier:export-report', ['report' => $report, 'exporter' => $exporter]);
})->purpose('Render one registered report through one exporter (shared name of atelier:export-report).');

Artisan::command('recalculate-inventory {--restock=10 : Target stock level}', function (): int {
    return $this->call('atelier:recalculate-inventory', ['--restock' => $this->option('restock')]);
})->purpose('Rebuild part stock from consumed pivot quantities (shared name of atelier:recalculate-inventory).');
