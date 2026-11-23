<?php

namespace App\Actions\Auth;

use App\Domain\Agents\Protocol;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Runner;
use App\Models\RunnerPairingCode;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\RunnerInput;
use App\Support\RunnerProtocol;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A runner redeems its one-time code (`werkbuch-runner login`, spec 6.2, A472, A473): like the link of an invitation, the
 * code is the only credential, so this runs before any sign-in, without an actor (A4); the event names the org admin who
 * made the code (`Actor::system`). The code row is read `for update`: two runners with one code get one runner. An
 * unknown, used or expired code is a clear 422 at `code`. The runner gets the host name it sends (with `-2`, … when an
 * active runner has it), the default places and a token of its own, which only this answer carries.
 */
final class PairRunner
{
    use AsAction;

    /** The keys of the body the action reads. */
    public const FIELDS = ['code', 'name', 'os', 'arch', 'version'];

    public const OS = ['darwin', 'linux'];

    public const ARCH = ['arm64', 'amd64'];

    /**
     * @param  array<array-key, mixed>  $input  `code`, `name` (the host name), `os`, `arch`, `version`, `protocol` of the header
     * @return array{runner: Runner, token: string}
     *
     * @throws ValidationException
     */
    public function handle(array $input): array
    {
        $valid = Validator::make($input, [
            'code' => ['required', 'string', 'regex:'.RunnerPairingCode::PATTERN.'i'],
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'os' => ['required', Rule::in(self::OS)],
            'arch' => ['required', Rule::in(self::ARCH)],
            'version' => ['required', 'string', 'max:32'],
        ], [
            'code' => __('field.code.runner_unknown'),
            'os' => __('field.os.runner', ['allowed' => implode(', ', self::OS)]),
            'arch' => __('field.arch.runner', ['allowed' => implode(', ', self::ARCH)]),
            'version' => __('field.version.runner'),
            'name' => __('field.name.max', ['max' => 255]),
        ])->validate();

        return DB::transaction(function () use ($valid, $input): array {
            CatalogLock::take();
            $pairing = RunnerPairingCode::query()->lockForUpdate()->where('code_hash', RunnerPairingCode::hashCode($valid['code']))->first();

            if ($pairing === null) {
                throw ValidationException::withMessages(['code' => __('field.code.runner_unknown')]);
            }

            $refusal = match (true) {
                $pairing->redeemed_at !== null => 'field.code.runner_used',
                $pairing->expires_at->isPast() => 'field.code.runner_expired',
                default => null,
            };
            if ($refusal !== null) {
                throw ValidationException::withMessages(['code' => __($refusal)]);
            }

            $token = Runner::newToken();
            $runner = Runner::query()->create([
                'name' => RunnerInput::freeName((string) ($valid['name'] ?? '')),
                'token_hash' => Runner::hashToken($token),
                'os' => $valid['os'],
                'arch' => $valid['arch'],
                'version' => $valid['version'],
                'protocol' => RunnerProtocol::protocol($input['protocol'] ?? (string) Protocol::VERSION),
                'slots_total' => Runner::DEFAULT_SLOTS['total'],
                'slots_per_repo' => Runner::DEFAULT_SLOTS['per_repo'],
                'slots_light' => Runner::DEFAULT_SLOTS['light'],
                'clis' => [],
                'last_seen_at' => now(),
                'created_by' => $pairing->created_by,
            ]);
            $pairing->forceFill(['redeemed_at' => now(), 'runner_id' => $runner->id])->save();

            EventRecorder::record(EventType::RunnerPaired, Actor::system($pairing->creator, 'runner_pairing'), $runner, null, [
                'name' => ['old' => null, 'new' => $runner->name],
            ], ['os' => $runner->os, 'arch' => $runner->arch, 'version' => $runner->version]);

            return ['runner' => $runner, 'token' => $token];
        }, 3);
    }
}
