<?php

namespace App\Support\Mechanics;

final class RushBadge extends Badge
{
    public function label(): string
    {
        return 'Rush';
    }

    public function css(): string
    {
        return 'badge badge-rush';
    }
}
