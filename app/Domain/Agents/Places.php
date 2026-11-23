<?php

namespace App\Domain\Agents;

/**
 * The places of a runner (spec 9): code runs count in all and per repo, light runs (`review`, `comment`) only in a pot
 * of their own. `fits` says whether one more run of a kind fits next to what runs.
 */
final readonly class Places
{
    public function __construct(
        public int $total,
        public int $perRepo,
        public int $light,
    ) {}

    /**
     * @param  list<array{type: RunType, repo: string}>  $running  what runs on the runner now
     */
    public function fits(RunType $type, string $repo, array $running): bool
    {
        if ($type->light()) {
            return count(array_filter($running, fn (array $run) => $run['type']->light())) < $this->light;
        }

        $code = array_values(array_filter($running, fn (array $run) => ! $run['type']->light()));
        $inRepo = array_filter($code, fn (array $run) => $run['repo'] === $repo);

        return count($code) < $this->total && count($inRepo) < $this->perRepo;
    }

    /**
     * What runs in each pot: code runs in all, code runs of the busiest repo, light runs.
     *
     * @param  list<array{type: RunType, repo: string}>  $running
     * @return array{total: int, per_repo: int, light: int}
     */
    public static function used(array $running): array
    {
        $perRepo = [];
        $light = 0;
        foreach ($running as $run) {
            if ($run['type']->light()) {
                $light++;
            } else {
                $perRepo[$run['repo']] = ($perRepo[$run['repo']] ?? 0) + 1;
            }
        }

        return ['total' => array_sum($perRepo), 'per_repo' => $perRepo === [] ? 0 : max($perRepo), 'light' => $light];
    }
}
