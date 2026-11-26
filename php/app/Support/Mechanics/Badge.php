<?php

namespace App\Support\Mechanics;

/**
 * A status badge. make() is the named constructor: `new static` and the `static` return type
 * both mean "the class it was called on", so RushBadge::make() is a RushBadge, not a Badge.
 */
abstract class Badge
{
    public static function make(): static
    {
        return new static();
    }

    abstract public function label(): string;

    public function css(): string
    {
        return 'badge';
    }

    public function render(): string
    {
        return '<span class="' . $this->css() . '">' . $this->label() . '</span>';
    }
}
