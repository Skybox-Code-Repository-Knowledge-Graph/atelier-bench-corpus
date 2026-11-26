<?php

/**
 * Global helper surface for the bench corpus.
 *
 * Deliberate coverage: a top-level const and a global function, both consumed
 * from multiple namespaces (trait, seeder, service). Exercises global-symbol
 * definition/references resolution (acuity #67 const coverage, #237 globals).
 */

const ATELIER_REF_PREFIX = 'AT';

if (! function_exists('atelier_format_reference')) {
    /**
     * Format a workshop reference like "AT-2026-000123".
     *
     * The zero-padded width is deliberately a magic number consumed nowhere
     * else, so hover on this function has a unique docblock to assert on.
     */
    function atelier_format_reference(string $prefix, int $number): string
    {
        return sprintf('%s%s%d%s%06d', $prefix, \App\Support\Reference::PREFIX_SEPARATOR, now()->year, \App\Support\Reference::PREFIX_SEPARATOR, $number);
    }
}
