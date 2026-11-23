<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\RunnerPairingCode;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * „Runner verbinden“ (spec 6.2, A473): a one-time code for ten minutes and the command that installs a runner with it.
 * Only its hash is stored; the code is in this answer alone. A new code makes the ones not redeemed yet stop working.
 * No event: a runner that redeems it is one (`runner.paired`).
 */
final class CreatePairingCode
{
    use AsAction;

    /**
     * @return array{pairing: RunnerPairingCode, code: string, command: string}
     *
     * @throws Problem 403
     */
    public function handle(Actor $actor): array
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        return DB::transaction(function () use ($actor): array {
            RunnerPairingCode::query()->whereNull('redeemed_at')->delete();

            $code = RunnerPairingCode::newCode();
            $pairing = RunnerPairingCode::query()->create([
                'code_hash' => (string) RunnerPairingCode::hashCode($code),
                'expires_at' => now()->addMinutes(RunnerPairingCode::MINUTES),
                'created_by' => $actor->user->id,
                'created_at' => now(),
            ]);

            return ['pairing' => $pairing, 'code' => $code, 'command' => self::command($code)];
        });
    }

    /** The command that installs a runner with the code (spec 6.2, 8.2). */
    public static function command(string $code): string
    {
        return 'curl -fsSL '.rtrim((string) config('app.url'), '/').'/runner/install.sh | sh -s -- --code '.$code;
    }
}
