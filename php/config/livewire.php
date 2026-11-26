<?php

// Full-page Livewire components (GET /board) render inside the lane's one layout, the anonymous
// component the Folio pages also use. Livewire's default, 'layouts::app', names a
// resources/views/layouts directory this lane does not have, so /board answered 500 without this.
// Every other Livewire setting keeps the package default.
return [
    'component_layout' => 'components.layouts.app',
];
