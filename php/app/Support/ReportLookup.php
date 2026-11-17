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
        $class = 'App\\Bench\\Exporters\\'.Str::studly($name).'Exporter';

        return class_exists($class) ? app($class) : null;
    }
}
