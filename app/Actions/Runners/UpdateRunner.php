<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\RunnerInput;
use App\Support\RunQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Renames a runner or sets its places (spec 8.4, 10.1, org admins): only the keys sent change (`name`, `slots` as a
 * whole: `total`, `per_repo`, `light`, `usage_limit`: the percent of the Claude subscription from which it takes no new
 * runs of `claude`, null for none, WEBU-65). The runner gets the places with its next answer; what runs keeps running,
 * fewer places or a lower limit only hold back new runs. Only a real change is written and recorded.
 */
final class UpdateRunner
{
    use AsAction;

    public const FIELDS = ['name', 'slots', 'usage_limit'];

    /**
     * @param  array<array-key, mixed>  $input  `name`, `slots`, `usage_limit`
     *
     * @throws Problem 403, 404 for a revoked runner
     * @throws ValidationException
     */
    public function handle(Actor $actor, Runner $runner, array $input): Runner
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        $updated = DB::transaction(function () use ($actor, $runner, $input): Runner {
            CatalogLock::take();
            $current = Runner::query()->lockForUpdate()->whereNull('revoked_at')->find($runner->id) ?? throw Problem::notFound();

            if (is_string($input['name'] ?? null)) {
                $input['name'] = Str::trim($input['name']);
            }
            $rules = [...(array_key_exists('name', $input) ? ['name' => RunnerInput::name($current)] : []), ...(array_key_exists('slots', $input) ? RunnerInput::slots() : []), ...(array_key_exists('usage_limit', $input) ? RunnerInput::usageLimit() : [])];
            $valid = Validator::make($input, $rules, RunnerInput::messages())->validate();

            $before = self::snapshot($current);
            if (isset($valid['name'])) {
                $current->name = $valid['name'];
            }
            if (isset($valid['slots'])) {
                $current->fill(['slots_total' => $valid['slots']['total'], 'slots_per_repo' => $valid['slots']['per_repo'], 'slots_light' => $valid['slots']['light']]);
            }

            if (array_key_exists('usage_limit', $valid)) {
                $current->usage_limit = $valid['usage_limit'];
            }

            $changes = CatalogInput::changes($before, self::snapshot($current));
            if ($changes === []) {
                return $current;
            }

            $current->save();
            EventRecorder::record(EventType::RunnerUpdated, $actor, $current, null, $changes);

            return $current;
        }, 3);

        // a new limit changes why runs wait (`usage_limit`)
        if ($updated->wasChanged('usage_limit')) {
            RunQueue::refreshReasons();
        }

        return $updated;
    }

    /**
     * @return array{name: string, slots: array{total: int, per_repo: int, light: int}, usage_limit: int|null}
     */
    private static function snapshot(Runner $runner): array
    {
        return ['name' => $runner->name, 'slots' => ['total' => $runner->slots_total, 'per_repo' => $runner->slots_per_repo, 'light' => $runner->slots_light], 'usage_limit' => $runner->usage_limit];
    }
}
