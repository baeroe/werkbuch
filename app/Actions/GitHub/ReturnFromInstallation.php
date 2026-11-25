<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Models\GitHubApp;
use App\Models\Organization;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * GitHub sends the person to `/github/setup` after installing the app or changing the installation (spec 10.2). Only a
 * `state` werkbuch gave this person for it (StartManifest::issueState, purpose `setup`) reads GitHub again (every app): the address
 * alone changes nothing, nor does a state of a person who no longer manages GitHub (a link someone else sends does no work, A518). Answers whether it synced.
 */
final class ReturnFromInstallation
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `state`, `installation_id`, `setup_action` of GitHub
     */
    public function handle(Actor $actor, array $input): bool
    {
        if (GitHubApp::query()->doesntExist() || ! StartManifest::takeState($input['state'] ?? null, $actor->user->id, 'setup')
            || ! Authorize::allows($actor, 'manageGitHub', Organization::class)) {
            return false;
        }

        SyncGitHub::run($actor);

        return true;
    }
}
