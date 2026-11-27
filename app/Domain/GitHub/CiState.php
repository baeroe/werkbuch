<?php

namespace App\Domain\GitHub;

/**
 * The CI state of a PR from the check runs on its head commit (spec 7.2): red as soon as a run ends in anything but
 * `success`, `neutral` or `skipped` (`failure`, `cancelled`, `timed_out`, `action_required`, `stale`), even while others
 * still run; green when every run ended and none is red; pending while one runs; none without a run (what that means
 * after a push is the flow's question, WEBU-26).
 */
final class CiState
{
    public const NONE = 'none';

    public const PENDING = 'pending';

    public const SUCCESS = 'success';

    public const FAILURE = 'failure';

    /** The conclusions that hold no PR back. */
    public const PASSING = ['success', 'neutral', 'skipped'];

    /**
     * Only the newest attempt of each check (WEBU-62): a job started again keeps its name and gets a higher id, and the
     * attempt it replaces no longer counts, red or not; the same for the statuses of one context. Keys of a check are
     * kind, app and name; the newest is the one with the highest `id`. Order as given.
     *
     * @template T of array{kind: string, app: ?string, name: string, id: int}
     *
     * @param  iterable<T>  $runs
     * @return list<T>
     */
    public static function latest(iterable $runs): array
    {
        $newest = [];
        foreach ($runs as $run) {
            $key = $run['kind']."\0".($run['app'] ?? '')."\0".$run['name'];
            if (! isset($newest[$key]) || $run['id'] > $newest[$key]['id']) {
                $newest[$key] = $run;
            }
        }
        $ids = array_map(fn (array $run) => $run['kind'].':'.$run['id'], $newest);

        $kept = [];
        foreach ($runs as $run) {
            if (in_array($run['kind'].':'.$run['id'], $ids, true)) {
                $kept[] = $run;
            }
        }

        return $kept;
    }

    /**
     * @param  iterable<array{status: string, conclusion: ?string}>  $runs
     */
    public static function of(iterable $runs): string
    {
        $state = self::NONE;

        foreach ($runs as $run) {
            if ($run['status'] === 'completed' && ! in_array($run['conclusion'], self::PASSING, true)) {
                return self::FAILURE;
            }

            $state = $run['status'] !== 'completed' || $state === self::PENDING ? self::PENDING : self::SUCCESS;
        }

        return $state;
    }
}
