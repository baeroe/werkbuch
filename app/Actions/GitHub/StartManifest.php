<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\Organization;
use App\Support\Actor;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Starts the manifest flow of the one app (spec 10.2): what the browser posts to GitHub (`url`, the field `manifest`)
 * and the `state` GitHub sends back, kept an hour and bound to the person (CompleteManifest takes it once). The app is
 * registered under the person's own account, or under a GitHub organization (`organization`, its login). Org admins,
 * only from the session (A397); an instance with an app is 409 `github_connected`.
 */
final class StartManifest
{
    use AsAction;

    public const FIELDS = ['organization'];

    /** A GitHub login: letters, digits and single dashes, at most 39 characters. */
    public const LOGIN = '/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\z/';

    public const STATE_MINUTES = 60;

    /**
     * @param  array<array-key, mixed>  $input
     * @return array{url: string, manifest: array<string, mixed>, state: string}
     */
    public function handle(Actor $actor, array $input): array
    {
        Authorize::check($actor, 'manageGitHub', Organization::class);

        if (GitHubApp::current() !== null) {
            throw Problem::conflict('github_connected');
        }

        $organization = $input['organization'] ?? null;
        $organization = is_string($organization) ? Str::trim($organization) : $organization;
        if ($organization === '') {
            $organization = null;
        }
        if ($organization !== null && (! is_string($organization) || preg_match(self::LOGIN, $organization) !== 1)) {
            throw ValidationException::withMessages(['organization' => __('field.organization.github_login')]);
        }

        $state = Str::random(40);
        Cache::put(self::stateKey($state), $actor->user->id, now()->addMinutes(self::STATE_MINUTES));

        return [
            'url' => Manifest::registerUrl($organization, $state),
            'manifest' => Manifest::for(Organization::current()->name, (string) config('app.url')),
            'state' => $state,
        ];
    }

    public static function stateKey(string $state): string
    {
        return 'github-manifest:'.hash('sha256', $state);
    }
}
