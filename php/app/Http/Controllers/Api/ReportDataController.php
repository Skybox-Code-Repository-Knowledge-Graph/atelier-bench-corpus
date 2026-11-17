<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ReportLookup;
use Illuminate\Http\JsonResponse;

class ReportDataController extends Controller
{
    /**
     * GET /api/reports/{slug}: one registered report as JSON, 404 when unknown.
     */
    public function show(string $slug): JsonResponse
    {
        $report = ReportLookup::report($slug);
        abort_if($report === null, 404);

        return response()->json([
            'slug' => $slug,
            'title' => $report->title(),
            'rows' => $report->generate(),
        ]);
    }
}
