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
 * Starts the manifest flow of the app of a GitHub account (spec 10.2, A680): what the browser posts to GitHub (`url`,
 * the field `manifest`) and the `state` GitHub sends back, kept an hour and bound to the person (CompleteManifest takes
 * it once). The account is `owner` (its login) of `owner_type` `User` (the person's own account at GitHub) or
 * `Organization`; the app is named after it. Org admins, only from the session (A397); an account that has an app
 * already is 409 `github_connected`.
 */
final class StartManifest
{
    use AsAction;

    public const FIELDS = ['owner', 'owner_type'];

    /** The kinds of GitHub accounts, as GitHub names them. */
    public const OWNER_TYPES = ['User', 'Organization'];

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

        $owner = $input['owner'] ?? null;
        $owner = is_string($owner) ? Str::trim($owner) : $owner;
        $type = $input['owner_type'] ?? null;

        $errors = [];
        if (! is_string($owner) || preg_match(self::LOGIN, $owner) !== 1) {
            $errors['owner'] = __($owner === null || $owner === '' ? 'field.owner.required' : 'field.owner.github_login');
        }
        if (! in_array($type, self::OWNER_TYPES, true)) {
            $errors['owner_type'] = __('field.owner_type.github');
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        /** @var string $owner */
        /** @var string $type */
        self::refuseTaken($owner);
        $state = self::issueState($actor->user->id);

        return [
            'url' => Manifest::registerUrl($type === 'Organization' ? $owner : null, $state),
            'manifest' => Manifest::for($owner, (string) config('app.url')),
            'state' => $state,
        ];
    }

    /** One app per GitHub account (A680): an account that has one is 409 `github_connected`. Logins are case-insensitive. */
    public static function refuseTaken(string $owner): void
    {
        if (GitHubApp::query()->where('owner_login', $owner)->exists()) {
            throw Problem::conflict('github_connected', detail: __('problem.detail.github_account_connected', ['login' => $owner]));
        }
    }

    /**
     * A state for a way back from GitHub (registering, installing; `purpose`), good for an hour and once, bound to the
     * person and, for the way back from installing, to the app it installs (A686).
     */
    public static function issueState(string $userId, string $purpose = 'manifest', ?string $appId = null): string
    {
        $state = Str::random(40);
        Cache::put(self::stateKey($state, $purpose), $appId === null ? $userId : $userId.'|'.$appId, now()->addMinutes(self::STATE_MINUTES));

        return $state;
    }

    /** Whether the state is the person's for this purpose; it is taken either way. */
    public static function takeState(mixed $state, string $userId, string $purpose = 'manifest'): bool
    {
        return self::takeStateOf($state, $userId, $purpose) !== false;
    }

    /**
     * Takes the state: `false` when it is not the person's for this purpose, else the ULID of the app it was given for
     * (null for none).
     */
    public static function takeStateOf(mixed $state, string $userId, string $purpose = 'manifest'): string|false|null
    {
        $value = is_string($state) ? Cache::pull(self::stateKey($state, $purpose)) : null;
        if (! is_string($value)) {
            return false;
        }
        [$owner, $app] = array_pad(explode('|', $value, 2), 2, null);

        return $owner === $userId ? $app : false;
    }

    public static function stateKey(string $state, string $purpose = 'manifest'): string
    {
        return 'github-'.$purpose.':'.hash('sha256', $state);
    }
}
