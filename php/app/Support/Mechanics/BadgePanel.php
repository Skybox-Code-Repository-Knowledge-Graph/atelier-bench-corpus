<?php

namespace App\Support\Mechanics;

/**
 * Takes the trait's public render() under another name and a narrower visibility, then declares
 * a render() of its own that wraps it.
 */
final class BadgePanel
{
    use RendersBadge {
        render as protected renderBadge;
    }

    public function title(): string
    {
        return 'Rush orders';
    }

    public function render(): string
    {
        return '<div class="panel">' . $this->renderBadge() . '</div>';
    }
}
