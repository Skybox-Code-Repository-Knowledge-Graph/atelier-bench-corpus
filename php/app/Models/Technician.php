<?php

namespace App\Models;

use App\Concerns\ForwardsToSchedule;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Carries the magic-forwarding trait: calls to Schedule's own methods on a technician
 * forward to its Schedule. $technician->nextSlot(...) and ->bookSlot(...)
 * resolve through __call to App\Support\Schedule; any other undeclared call
 * falls through to Eloquent's __call.
 *
 * @method \Carbon\CarbonImmutable nextSlot(\Carbon\CarbonImmutable $after)
 * @method bool bookSlot(\Carbon\CarbonImmutable $slot)
 */
class Technician extends Model
{
    use ForwardsToSchedule;
    use HasFactory;

    protected $guarded = [];

    public function repairOrders(): HasMany
    {
        return $this->hasMany(RepairOrder::class);
    }
}
