<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A webhook delivery of GitHub (spec 11.4), once per delivery ID (`X-GitHub-Delivery`, a redelivery has the same):
 * received at once, worked in the queue (`processed_at`, `outcome`). The payload holds no secret of werkbuch.
 *
 * @property string $id
 * @property string $delivery_id
 * @property string $event
 * @property string|null $action
 * @property string $payload
 * @property CarbonImmutable $received_at
 * @property CarbonImmutable|null $processed_at
 * @property string|null $outcome
 */
#[Fillable(['delivery_id', 'event', 'action', 'payload', 'received_at', 'processed_at', 'outcome'])]
final class GitHubDelivery extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $table = 'github_deliveries';

    protected function casts(): array
    {
        return ['received_at' => 'immutable_datetime', 'processed_at' => 'immutable_datetime'];
    }

    /**
     * The payload as an array (`[]` for anything else).
     *
     * @return array<string, mixed>
     */
    public function data(): array
    {
        $data = json_decode($this->payload, true);

        return is_array($data) ? $data : [];
    }
}
