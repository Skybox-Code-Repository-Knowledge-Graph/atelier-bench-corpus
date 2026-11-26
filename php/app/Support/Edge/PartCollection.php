<?php

namespace App\Support\Edge;

use App\Models\Part;
use Illuminate\Database\Eloquent\Collection;

/**
 * Breadth surface: @template docblock generic + @extends of a generic base.
 *
 * @template TKey of array-key
 * @extends Collection<int, Part>
 */
final class PartCollection extends Collection
{
    /** Raw stored cents: reading unit_price_cents through its cast yields a decimal string, not cents. */
    public function totalValueCents(): int
    {
        return $this->sum(fn (Part $part): int => (int) $part->getAttributes()['unit_price_cents']);
    }
}

final class PartCollectionFactory
{
    public function make(array $parts): PartCollection
    {
        return new PartCollection($parts);
    }
}
