<?php

namespace App\Support;

use App\Domain\Agents\AgentCli;
use App\Domain\Agents\Places;
use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\Runner;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * What every request of a runner shares (spec 6.1, 6.3, 8.6–8.8): its report (load, CLIs, equipment), which werkbuch
 * keeps as the last state; its version and protocol from the headers; the places and version every answer carries; and
 * what runs on it now, which the places count.
 *
 * The report: `load` {cpu, gpu (null without a GPU reading), ram_used, ram_total, disk_free, disk_total} in percent and
 * GB; `clis` [{cli, installed, version, logged_in, path}] (CLIs werkbuch does not know are kept out); `equipment`
 * {mcp_servers, skills, plugins, werkbuch_access} as lists of names. Each part is optional: a part left out keeps the
 * last one.
 */
final class RunnerProtocol
{
    public const NAMES_MAX = 200;

    public const NAME_MAX = 200;

    /**
     * The report of a request, checked; the parts it does not send are missing.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{load?: array<string, int|float|null>, clis?: list<array<string, mixed>>, equipment?: array<string, list<string>>}
     *
     * @throws ValidationException
     */
    public static function report(array $input): array
    {
        $number = ['required_with:load', 'numeric', 'min:0', 'max:1000000'];
        $names = ['sometimes', 'array', 'list', 'max:'.self::NAMES_MAX];
        $name = ['string', 'max:'.self::NAME_MAX];

        $valid = Validator::make($input, [
            'load' => ['sometimes', 'nullable', 'array:cpu,gpu,ram_used,ram_total,disk_free,disk_total'],
            'load.cpu' => ['required_with:load', 'numeric', 'min:0', 'max:100'],
            'load.gpu' => ['present_with:load', 'nullable', 'numeric', 'min:0', 'max:100'],
            'load.ram_used' => $number,
            'load.ram_total' => $number,
            'load.disk_free' => $number,
            'load.disk_total' => $number,
            'clis' => ['sometimes', 'array', 'list', 'max:10'],
            'clis.*' => ['array:cli,installed,version,logged_in,path'],
            'clis.*.cli' => ['required', 'string', 'max:32'],
            'clis.*.installed' => ['required', 'boolean:strict'],
            'clis.*.version' => ['present', 'nullable', 'string', 'max:64'],
            'clis.*.logged_in' => ['required', 'boolean:strict'],
            'clis.*.path' => ['sometimes', 'nullable', 'string', 'max:500'],
            'equipment' => ['sometimes', 'nullable', 'array:mcp_servers,skills,plugins,werkbuch_access'],
            'equipment.mcp_servers' => $names,
            'equipment.mcp_servers.*' => $name,
            'equipment.skills' => $names,
            'equipment.skills.*' => $name,
            'equipment.plugins' => $names,
            'equipment.plugins.*' => $name,
            'equipment.werkbuch_access' => $names,
            'equipment.werkbuch_access.*' => $name,
        ], [], [])->setCustomMessages(['*' => __('field.runner.report')])->validate();

        $report = [];

        if (array_key_exists('load', $valid) && $valid['load'] !== null) {
            $report['load'] = $valid['load'];
        }

        if (array_key_exists('clis', $valid)) {
            $report['clis'] = array_values(array_map(fn (array $cli) => [
                'cli' => $cli['cli'], 'installed' => $cli['installed'], 'version' => $cli['version'], 'logged_in' => $cli['logged_in'], 'path' => $cli['path'] ?? null,
            ], array_filter($valid['clis'], fn (array $cli) => in_array($cli['cli'], AgentCli::VALUES, true))));
        }

        if (array_key_exists('equipment', $valid) && $valid['equipment'] !== null) {
            $report['equipment'] = [
                'mcp_servers' => $valid['equipment']['mcp_servers'] ?? [],
                'skills' => $valid['equipment']['skills'] ?? [],
                'plugins' => $valid['equipment']['plugins'] ?? [],
                'werkbuch_access' => $valid['equipment']['werkbuch_access'] ?? [],
            ];
        }

        return $report;
    }

    /**
     * Keeps the report as the last state of the runner, with its contact, version and protocol.
     *
     * @param  array{load?: mixed, clis?: mixed, equipment?: mixed}  $report
     */
    public static function keep(Runner $runner, array $report, string $version, int $protocol): void
    {
        $runner->forceFill([...$report, 'version' => $version, 'protocol' => $protocol, 'last_seen_at' => now()])->save();
    }

    /** The version a request names (`X-Werkbuch-Runner-Version`), cut to its column. */
    public static function version(mixed $header): string
    {
        return is_string($header) ? mb_substr(trim($header), 0, 32) : '';
    }

    /** The protocol a request speaks (`X-Werkbuch-Protocol`); without one it speaks none werkbuch knows. */
    public static function protocol(mixed $header): int
    {
        return is_string($header) && preg_match('/^\d{1,4}\z/', trim($header)) === 1 ? (int) trim($header) : 0;
    }

    /**
     * What runs on the runner now, as the places count it: its kind and its repo (the project until projects have
     * repos, A476: repo and project are one to one).
     *
     * @return list<array{type: RunType, repo: string}>
     */
    public static function running(Runner $runner): array
    {
        return AgentRun::query()->where('runner_id', $runner->id)
            ->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value])
            ->get(['type', 'project_id'])
            ->map(fn (AgentRun $run) => ['type' => $run->type, 'repo' => $run->project_id])
            ->values()->all();
    }

    /**
     * What every answer to a runner carries: its places as set in werkbuch and as used now, the version werkbuch
     * expects (a runner of another one updates itself, spec 8.3) and the protocol.
     *
     * @return array{places: array{total: int, per_repo: int, light: int, used: array{total: int, per_repo: int, light: int}}, version: string, protocol: int, heartbeat_seconds: int}
     */
    public static function answer(Runner $runner): array
    {
        return [
            'places' => [
                'total' => $runner->slots_total,
                'per_repo' => $runner->slots_per_repo,
                'light' => $runner->slots_light,
                'used' => Places::used(self::running($runner)),
            ],
            'version' => (string) config('werkbuch.version'),
            'protocol' => Protocol::VERSION,
            'heartbeat_seconds' => Protocol::HEARTBEAT_SECONDS,
        ];
    }
}
