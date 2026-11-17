<?php

namespace App\Console\Commands;

use App\Support\ReportLookup;
use Illuminate\Console\Command;

class ExportReport extends Command
{
    protected $signature = 'atelier:export-report {report : Report slug, e.g. cash-flow} {exporter=json : Exporter name, e.g. json, csv}';

    protected $description = 'Render one registered report through one exporter.';

    public function handle(): int
    {
        $report = ReportLookup::report((string) $this->argument('report'));
        if ($report === null) {
            $this->components->error("Unknown report: {$this->argument('report')}");

            return self::FAILURE;
        }

        $exporter = ReportLookup::exporter((string) $this->argument('exporter'));
        if ($exporter === null) {
            $this->components->error("Unknown exporter: {$this->argument('exporter')}");

            return self::FAILURE;
        }

        $this->line($exporter->export($report->generate()));

        return self::SUCCESS;
    }
}
