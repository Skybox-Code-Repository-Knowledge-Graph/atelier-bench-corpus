<?php

namespace App\Support\Mechanics;

final class BadgeCss
{
    public static function forKind(string $kind): string
    {
        return 'badge badge-' . $kind;
    }

    public static function forPriority(string $priority): string
    {
        return $priority === 'rush' ? 'badge badge-rush' : 'badge';
    }
}
