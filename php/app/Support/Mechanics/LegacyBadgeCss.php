<?php

namespace App\Support\Mechanics;

/**
 * The pre-badge spelling of the same two lookups, kept for the old board markup. It shares its
 * method names with BadgeCss, so a name alone does not say which of the two a call reaches.
 */
final class LegacyBadgeCss
{
    public static function forKind(string $kind): string
    {
        return 'label label-' . $kind;
    }

    public static function forPriority(string $priority): string
    {
        return $priority === 'rush' ? 'label label-danger' : 'label';
    }
}
