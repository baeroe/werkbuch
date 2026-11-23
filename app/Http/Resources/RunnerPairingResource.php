<?php

namespace App\Http\Resources;

use App\Actions\Runners\CreatePairingCode;
use App\Models\RunnerPairingCode;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A one-time code of a runner (spec 6.2): the code and the command that installs the runner with it only in the answer
 * of making it; `runner_id` once a runner redeemed it.
 *
 * @mixin RunnerPairingCode
 */
final class RunnerPairingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var RunnerPairingCode $pairing */
        $pairing = $this->resource;

        return [
            'id' => $pairing->id,
            'code' => $this->when($pairing->plain !== null, fn () => $pairing->plain),
            'command' => $this->when($pairing->plain !== null, fn () => CreatePairingCode::command((string) $pairing->plain)),
            'expires_at' => $pairing->expires_at->toJSON(),
            'redeemed_at' => $pairing->redeemed_at?->toJSON(),
            'runner_id' => $pairing->runner_id,
        ];
    }
}
