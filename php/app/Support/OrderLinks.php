<?php

namespace App\Support;

use App\Models\RepairOrder;

/**
 * Public API links to an order. The URL is built from the route's name (routes/api.php), not
 * from a path, so the link follows the route if its URI changes.
 */
class OrderLinks
{
    public static function apiUrl(RepairOrder $order): string
    {
        return route('api.orders.show', $order);
    }
}
