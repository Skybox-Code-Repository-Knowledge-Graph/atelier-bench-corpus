<?php

namespace Tests\Feature;

use App\Models\Part;
use App\Models\RepairOrder;
use App\Support\Edge\CacheableTtlProbe;
use App\Support\Edge\CallableStore;
use App\Support\Edge\ClockAwareDemo;
use App\Support\Edge\HeavyItem;
use App\Support\Edge\ImmutablePoint;
use App\Support\Edge\InvoiceLineBuilder;
use App\Support\Edge\LightItem;
use App\Support\Edge\MetricsProbe;
use App\Support\Edge\OrderLabel;
use App\Support\Edge\PartCollection;
use App\Support\Edge\PartCollectionFactory;
use App\Support\Edge\PriorityMatcher;
use App\Support\Edge\SeverityLevel;
use App\Support\Edge\SeverityLevelDemo;
use App\Support\Edge\Tally;
use App\Support\Formatting\UnitFormatter;
use App\Support\Formatting\UnitLabel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Real use sites for the lane-only breadth probes (checklist D.3): each test
 * builds the host a task anchors in and calls the member that holds the
 * task's from line, so the construct runs instead of sitting unreferenced.
 *
 * This file names none of the symbols a references task counts.
 */
class EdgeProbesTest extends TestCase
{
    use RefreshDatabase;

    public function test_enum_implementing_an_interface_classifies_scores(): void
    {
        $demo = new SeverityLevelDemo();

        $this->assertSame(SeverityLevel::High, $demo->classify(9));
        $this->assertSame(SeverityLevel::Medium, $demo->classify(4));
        $this->assertSame(SeverityLevel::Low, $demo->classify(0));
        $this->assertSame('Medium', $demo->classify(5)->label());
        $this->assertSame(SeverityLevel::Low, SeverityLevel::Default);
    }

    public function test_first_class_callables_are_stored_then_invoked(): void
    {
        $store = new CallableStore();
        $store->register();

        $this->assertSame(14, $store->invokeDouble(7));
    }

    public function test_readonly_promoted_point_translates_into_a_new_instance(): void
    {
        $origin = new ImmutablePoint(1.0, 2.0);
        $moved = $origin->translated(0.5, -2.0);

        $this->assertSame([1.5, 0.0], [$moved->x, $moved->y]);
        $this->assertSame([1.0, 2.0], [$origin->x, $origin->y]);
    }

    public function test_intersection_typed_parameter_counts_an_iterator(): void
    {
        $this->assertSame(3, (new Tally())->measure(['a', 'b', 'c']));
    }

    public function test_attribute_on_the_heartbeat_is_read_through_reflection(): void
    {
        $probe = new MetricsProbe();
        $attribute = MetricsProbe::readTrackable();

        $this->assertTrue($probe->heartbeat());
        $this->assertNotNull($attribute);
        $this->assertSame('probe-heartbeat', $attribute->label);
    }

    public function test_new_in_initializer_supplies_the_default_clock(): void
    {
        $this->assertGreaterThan(0, (new ClockAwareDemo())->timestamp());
    }

    public function test_static_closure_matches_every_priority_level(): void
    {
        $matcher = new PriorityMatcher();

        $this->assertSame([1, 2, 3], [$matcher->score('low'), $matcher->score('medium'), $matcher->score('high')]);

        $this->expectException(\UnhandledMatchError::class);
        $matcher->score('urgent');
    }

    public function test_named_arguments_skip_the_defaulted_quantity(): void
    {
        $this->assertSame(
            ['label' => 'Diagnostic fee', 'quantity' => 1, 'unitPriceCents' => 5000],
            (new InvoiceLineBuilder())->buildDefault(),
        );
    }

    public function test_nullsafe_chain_reaches_the_device_label(): void
    {
        $order = RepairOrder::factory()->create();
        $labeler = new OrderLabel();

        $this->assertSame($order->device->label(), $labeler->labelFor($order));
        $this->assertNull($labeler->labelFor(null));
    }

    public function test_docblock_generic_collection_sums_raw_cents(): void
    {
        $parts = [
            Part::factory()->create(['unit_price_cents' => 550]),
            Part::factory()->create(['unit_price_cents' => 1250]),
        ];

        $collection = (new PartCollectionFactory())->make($parts);

        $this->assertInstanceOf(PartCollection::class, $collection);
        $this->assertSame(1800, $collection->totalValueCents());
    }

    public function test_trait_abstract_weight_is_supplied_by_each_user(): void
    {
        $this->assertSame(10, (new LightItem())->weightedScore(10));
        $this->assertSame(50, (new HeavyItem())->weightedScore(10));
    }

    public function test_interface_constant_is_read_through_an_implementor(): void
    {
        $this->assertSame(3600, (new CacheableTtlProbe())->ttlSeconds());
    }

    public function test_namespaced_const_and_function_imports_resolve(): void
    {
        $this->assertSame('u', UnitLabel::suffix());
        $this->assertSame('3u', UnitFormatter::format(3));
    }
}
