<?php

namespace App\Actions\GitHub;

use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Support\Actor;
use App\Support\OwnMerges;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Works one webhook delivery (spec 11.4) in the queue: `installation` and `installation_repositories` read GitHub
 * again (SyncGitHub::pull: the payloads carry no default branch), a `push` goes to the guard (DetectUnauthorizedPush),
 * `ping` is fine; pull requests and checks wait for the links and the flow (WEBU-25, WEBU-26) and are `ignored` now.
 * The outcome is kept on the row; a delivery worked once is never worked again. A push the guard cannot judge yet
 * (`pending`) stays open: the job looks again later. Answers the outcome, null for a delivery worked already.
 */
final class HandleGitHubDelivery
{
    use AsAction;

    /**
     * @throws GitHubUnavailable when GitHub does not answer the sync (the job tries again)
     */
    public function handle(Actor $actor, string $deliveryId): ?string
    {
        $delivery = GitHubDelivery::query()->find($deliveryId);
        if ($delivery === null || $delivery->processed_at !== null) {
            return null;
        }

        $app = GitHubApp::current();
        $outcome = match (true) {
            $app === null => 'ignored',
            in_array($delivery->event, ['installation', 'installation_repositories'], true) => self::sync($app),
            $delivery->event === 'push' => DetectUnauthorizedPush::run($actor, $delivery->data()),
            $delivery->event === 'ping' => 'ok',
            default => 'ignored',
        };

        if ($outcome !== OwnMerges::PENDING) {
            GitHubDelivery::query()->whereKey($delivery->id)->whereNull('processed_at')->update(['processed_at' => now(), 'outcome' => $outcome]);
        }

        return $outcome;
    }

    private static function sync(GitHubApp $app): string
    {
        SyncGitHub::pull($app);

        return 'synced';
    }
}
