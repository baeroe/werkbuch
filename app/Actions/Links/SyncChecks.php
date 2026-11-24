<?php

namespace App\Actions\Links;

use App\Live\ChecksChanged;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Keeps the check runs of linked PRs (spec 12) from a `check_run` delivery: every link of the repo whose head commit is
 * the commit of the run gets the run (name, app, status, conclusion, link); a run of another commit says nothing about
 * a PR and is passed over. A run that ended stays ended: a delivery that comes late (`in_progress` after `completed`)
 * does not make it run again. Locks the links of the commit, then writes its row per link. Answers `ignored` (no link
 * has the commit, or the payload is no check run) or `ok`. `check_suite` stays with the flow (WEBU-26). Each item whose
 * checks changed hears it after the commit, once per delivery (ChecksChanged, A648).
 */
final class SyncChecks
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $payload  the payload of a `check_run` delivery
     */
    public function handle(Actor $actor, array $payload): string
    {
        $changed = self::store($payload);
        if ($changed === null) {
            return 'ignored';
        }

        ChecksChanged::tell($changed);

        return 'ok';
    }

    /**
     * Writes the run of a `check_run` payload to the links of its commit; answers the links whose row changed (new or
     * other values), or null when no link has the commit or the payload is no check run. Tells nobody (LoadChecks tells
     * once for all the runs it read).
     *
     * @param  array<array-key, mixed>  $payload
     * @return list<WorkItemLink>|null
     */
    public static function store(array $payload): ?array
    {
        $run = is_array($payload['check_run'] ?? null) ? $payload['check_run'] : [];
        $repository = is_array($payload['repository'] ?? null) ? $payload['repository'] : [];
        $app = is_array($run['app'] ?? null) ? $run['app'] : [];

        if (! is_int($repository['id'] ?? null) || ! is_int($run['id'] ?? null) || ! is_string($run['head_sha'] ?? null)
            || ! is_string($run['status'] ?? null) || ! is_string($run['name'] ?? null)) {
            return null;
        }

        $fields = [
            'check_run_id' => $run['id'],
            'name' => mb_substr($run['name'], 0, 255),
            'app' => is_string($app['name'] ?? null) ? mb_substr($app['name'], 0, 100) : null,
            'status' => mb_substr($run['status'], 0, 16),
            'conclusion' => is_string($run['conclusion'] ?? null) ? mb_substr($run['conclusion'], 0, 20) : null,
            'url' => is_string($run['html_url'] ?? null) ? mb_substr($run['html_url'], 0, 2048) : null,
            'head_sha' => $run['head_sha'],
        ];

        return DB::transaction(function () use ($repository, $fields): ?array {
            $links = WorkItemLink::query()->where('repository_github_id', $repository['id'])->where('head_sha', $fields['head_sha'])
                ->orderBy('id')->lockForUpdate()->get();

            $changed = [];
            foreach ($links as $link) {
                $check = WorkItemLinkCheck::query()->where('work_item_link_id', $link->id)->where('kind', 'check')->where('check_run_id', $fields['check_run_id'])->first()
                    ?? new WorkItemLinkCheck(['work_item_link_id' => $link->id]);

                if ($check->status !== 'completed' || $fields['status'] === 'completed') {
                    $check->fill($fields);
                    if ($check->isDirty()) {
                        $check->save();
                        $changed[] = $link;
                    }
                }
            }

            return $links->isEmpty() ? null : $changed;
        }, 3);
    }
}
