<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Ends the manifest flow (spec 10.2): GitHub sends the person back with a temporary `code` and the `state` of
 * StartManifest. The state has to be the person's own and is taken once; the code becomes the app (within the hour GitHub
 * allows) through `POST /app-manifests/{code}/conversions`, outside any lock, then its row under the lock of the
 * organization: one app per GitHub account (A680), an account with an app is 409 `github_connected` (the person may
 * have registered under another account than the one StartManifest named). The private key and the webhook secret are
 * stored encrypted; the client secret is dropped (A510). `github.connected` names the app, never a secret.
 */
final class CompleteManifest
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `code`, `state`
     *
     * @throws Problem 403 for a state that is not the person's, 409 `github_connected`, 503 `github_unavailable`
     */
    public function handle(Actor $actor, array $input): GitHubApp
    {
        Authorize::check($actor, 'manageGitHub', Organization::class);

        $code = $input['code'] ?? null;
        $state = $input['state'] ?? null;
        if (! is_string($code) || preg_match('/^[A-Za-z0-9_-]{1,100}\z/', $code) !== 1) {
            throw ValidationException::withMessages(['code' => __('field.code.github')]);
        }
        if (! StartManifest::takeState($state, $actor->user->id)) {
            throw Problem::forbidden(__('problem.detail.github_state'));
        }

        try {
            $app = self::fields(GitHubApi::convertManifest($code));
        } catch (GitHubUnavailable $e) {
            report($e);

            throw Problem::unavailable('github_unavailable');
        }

        return DB::transaction(function () use ($actor, $app): GitHubApp {
            CatalogLock::take();
            StartManifest::refuseTaken((string) $app['owner_login']);

            $created = GitHubApp::query()->create([...$app, 'created_by' => $actor->user->id]);
            EventRecorder::record(EventType::GitHubConnected, $actor, Organization::current(), null, [
                'app' => ['old' => null, 'new' => $created->slug],
            ], ['app_id' => $created->app_id, 'owner' => $created->owner_login]);

            return $created;
        }, 3);
    }

    /**
     * The columns of the app from the answer of the conversion.
     *
     * @param  array<array-key, mixed>  $answer
     * @return array<string, mixed>
     */
    private static function fields(array $answer): array
    {
        $owner = is_array($answer['owner'] ?? null) ? $answer['owner'] : [];
        $fields = [
            'app_id' => $answer['id'] ?? null,
            'slug' => $answer['slug'] ?? null,
            'name' => $answer['name'] ?? null,
            'owner_login' => $owner['login'] ?? null,
            'owner_type' => $owner['type'] ?? null,
            'html_url' => $answer['html_url'] ?? null,
            'private_key' => $answer['pem'] ?? null,
            'webhook_secret' => $answer['webhook_secret'] ?? null,
        ];

        foreach ($fields as $key => $value) {
            if ($key === 'app_id' ? ! is_int($value) : (! is_string($value) || $value === '')) {
                throw new GitHubUnavailable(GitHubUnavailable::GITHUB, "GitHub answered the conversion without {$key}.");
            }
        }

        $permissions = is_array($answer['permissions'] ?? null) ? $answer['permissions'] : [];
        $events = is_array($answer['events'] ?? null) ? array_values(array_filter($answer['events'], 'is_string')) : [];

        return [
            ...$fields,
            'client_id' => is_string($answer['client_id'] ?? null) ? $answer['client_id'] : null,
            'permissions' => array_filter($permissions, 'is_string'),
            'events' => $events,
        ];
    }
}
