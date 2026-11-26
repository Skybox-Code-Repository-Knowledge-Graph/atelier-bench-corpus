<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Support\Mechanics\Badge;
use App\Support\Mechanics\BadgePanel;
use App\Support\Mechanics\BadgeShelf;
use App\Support\Mechanics\RushBadge;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The PHP-only reaches app/Support/Mechanics uses: late static binding (`new static`, the
 * `static` return type), a callable array, a callable string, and a trait method taken under an
 * alias. Plus `static::creating` in HasReference, which assigns a reference on create.
 */
class PhpMechanicsTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_static_builds_the_class_it_was_called_on(): void
    {
        $badge = RushBadge::make();
        $this->assertInstanceOf(RushBadge::class, $badge);
        $this->assertNotSame(Badge::class, $badge::class);
        $this->assertSame('badge badge-rush', BadgeShelf::rushCss());
        $this->assertSame('<span class="badge badge-rush">Rush</span>', $badge->render());
    }

    public function test_callable_array_and_string_reach_the_static_methods(): void
    {
        $this->assertSame(['badge badge-open', 'badge badge-rush'], BadgeShelf::cssForKinds(['open', 'rush']));
        $this->assertSame('badge badge-rush', BadgeShelf::cssForPriority('rush'));
        $this->assertSame('badge', BadgeShelf::cssForPriority('normal'));
    }

    public function test_trait_alias_keeps_the_original_and_hides_the_alias(): void
    {
        $panel = new BadgePanel();
        $this->assertSame('<div class="panel"><b class="panel-badge">Rush orders</b></div>', $panel->render());
        $this->assertFalse(is_callable([$panel, 'renderBadge']));
    }

    public function test_static_creating_assigns_a_reference_on_create(): void
    {
        $customer = Customer::factory()->create(['reference' => null]);
        $this->assertNotEmpty($customer->reference);
    }
}
