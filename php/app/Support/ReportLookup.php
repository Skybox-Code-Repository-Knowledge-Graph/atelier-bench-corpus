<?php

namespace App\Support;

use App\Bench\Contracts\ExporterContract;
use App\Bench\Contracts\ReportContract;
use App\Bench\Reports\ReportRegistry;
use Illuminate\Support\Str;

/**
 * String-keyed lookup for the shared report and exporter surfaces. The report
 * slug is the kebab-cased class basename without the `Report` suffix
 * (CashFlowReport -> cash-flow), the same slugs the other lanes use. Kept out
 * of ReportRegistry so that file's symbol count stays stable.
 */
final class ReportLookup
{
    /** Exporter keys shared with the other lanes (csv, json, md plus the rest), mapped to class stems. */
    private const EXPORTERS = [
        'csv' => 'Csv', 'html' => 'Html', 'json' => 'Json', 'md' => 'Markdown',
        'pdf' => 'Pdf', 'xlsx' => 'Xlsx', 'xml' => 'Xml', 'yaml' => 'Yaml',
    ];

    public static function report(string $slug): ?ReportContract
    {
        foreach (ReportRegistry::all() as $class) {
            $base = class_basename($class);
            if (Str::kebab(Str::beforeLast($base, 'Report')) === $slug) {
                return app($class);
            }
        }

        return null;
    }

    public static function exporter(string $name): ?ExporterContract
    {
        $stem = self::EXPORTERS[$name] ?? null;

        return $stem === null ? null : app('App\\Bench\\Exporters\\'.$stem.'Exporter');
    }
}
