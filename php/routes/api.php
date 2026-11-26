<?php

use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ReportDataController;
use Illuminate\Support\Facades\Route;

// Corpus API surface (wave D2): route-model binding by reference,
// FormRequest validation, JsonResource shaping.
Route::get('/orders', [OrderController::class, 'index']);
Route::get('/orders/{repairOrder:reference}', [OrderController::class, 'show'])->name('api.orders.show');
Route::post('/orders/{repairOrder:reference}/notes', [OrderController::class, 'storeNote'])->middleware('auth:sanctum');
Route::get('/reports/{slug}', [ReportDataController::class, 'show']);
