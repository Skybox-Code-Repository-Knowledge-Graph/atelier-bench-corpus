<?php

namespace App\Support\Mechanics;

trait RendersBadge
{
    public function render(): string
    {
        return '<b class="panel-badge">' . $this->title() . '</b>';
    }
}
