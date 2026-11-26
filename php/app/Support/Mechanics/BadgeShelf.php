<?php

namespace App\Support\Mechanics;

/**
 * Where the badge styles are looked up. Each method reaches its target in a different PHP way:
 * a late-static-bound named constructor, a callable array and a callable string.
 */
final class BadgeShelf
{
    public static function rushCss(): string
    {
        return RushBadge::make()->css();
    }

    /** @param list<string> $kinds */
    public static function cssForKinds(array $kinds): array
    {
        return array_map([BadgeCss::class, 'forKind'], $kinds);
    }

    public static function cssForPriority(string $priority): string
    {
        return call_user_func('App\Support\Mechanics\BadgeCss::forPriority', $priority);
    }

    /** The old board markup still asks for the label spelling of both lookups. */
    public static function legacyCss(string $kind, string $priority): array
    {
        return [LegacyBadgeCss::forKind($kind), LegacyBadgeCss::forPriority($priority)];
    }
}
