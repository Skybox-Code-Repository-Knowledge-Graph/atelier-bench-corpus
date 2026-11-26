<?php

namespace Tests\Feature;

use App\Filament\Pages\InventoryReport;
use App\Filament\Widgets\RepairStats;
use App\Models\Part;
use App\Models\RepairOrder;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The admin panel discovers the RepairStats widget and the InventoryReport page; nothing else
 * renders them. These tests render both against the seeded dataset: the widget's open() and
 * rush() scope counts, and the page's Blade view reading the #[Computed] lowStockParts list.
 */
class FilamentSurfacesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->actingAs(User::query()->firstOrFail());
        Filament::setCurrentPanel(Filament::getPanel('admin'));
    }

    public function test_repair_stats_widget_counts_the_seeded_orders(): void
    {
        // Two more open, normal-priority orders beside the seed, so the two counts differ.
        RepairOrder::factory()->count(2)->create(['status' => 'received', 'priority' => 'normal']);
        $open = RepairOrder::query()->where('status', '!=', 'delivered')->count();
        $rush = RepairOrder::query()->where('priority', 'rush')->count();
        $this->assertGreaterThan(0, $rush);
        $this->assertNotSame($open, $rush);

        Livewire::test(RepairStats::class)
            ->assertSeeInOrder(['Open orders', (string) $open, 'Rush orders', (string) $rush]);
    }

    public function test_inventory_report_lists_parts_at_or_below_the_threshold(): void
    {
        $part = Part::query()->orderBy('sku')->firstOrFail();

        Livewire::test(InventoryReport::class)
            ->set('lowStockThreshold', $part->stock - 1)
            ->assertSee('All parts sufficiently stocked.')
            ->assertDontSee("{$part->sku}: {$part->name}")
            ->set('lowStockThreshold', $part->stock)
            ->assertSee("{$part->sku}: {$part->name} ({$part->stock} left)")
            ->assertDontSee('All parts sufficiently stocked.');
    }
}
