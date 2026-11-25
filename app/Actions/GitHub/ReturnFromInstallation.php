<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\Organization;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * GitHub sends the person to `/github/setup` after installing the app or changing the installation (spec 10.2). Only a
 * `state` werkbuch gave this person for it (StartManifest::issueState, purpose `setup`) reads GitHub again for the app of the installation (A686): the address
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
        $stated = GitHubApp::query()->exists() ? StartManifest::takeStateOf($input['state'] ?? null, $actor->user->id, 'setup') : false;
        if ($stated === false || ! Authorize::allows($actor, 'manageGitHub', Organization::class)) {
            return false;
        }

        SyncGitHub::run($actor, self::appOf($input['installation_id'] ?? null, $stated));

        return true;
    }

    /**
     * The app the way back is about (A686): the one of the installation GitHub names, if werkbuch knows it, else the
     * one the state was given for (a new installation); null reads every app (a state without an app).
     */
    private static function appOf(mixed $installation, ?string $stated): ?GitHubApp
    {
        $known = is_numeric($installation) ? GitHubInstallation::query()->where('installation_id', (int) $installation)->first() : null;
        $id = $known->github_app_id ?? $stated;

        return $id === null ? null : GitHubApp::query()->find($id);
    }
}
