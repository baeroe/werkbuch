<?php

namespace App\Http\Controllers;

use App\Access\Authorize;
use App\Actions\GitHub\CompleteManifest;
use App\Actions\GitHub\ReturnFromInstallation;
use App\Actions\GitHub\StartManifest;
use App\Exceptions\Problem;
use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\Organization;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The ways between GitHub and the settings (WEBU-27): the screen is Settings → GitHub (`/settings/github`), which posts
 * the manifest to GitHub from the browser. GitHub sends the person back to `manifest` (the app becomes werkbuch's, then
 * on to the installation) and, after installing or changing the installation, to `setup` (installations and repos are
 * read again, only with the state werkbuch gave). `install` sends an org admin to the installation of the app `?app=`
 * (its ULID, A680) with a state of their own. Whatever fails comes back to the settings as a flash error; `/github` itself is an old address of the screen.
 */
final class GitHubPageController extends Controller
{
    public function manifest(Request $request): RedirectResponse
    {
        $actor = Actor::fromRequest($request);

        try {
            $app = CompleteManifest::run($actor, $request->query());
        } catch (ValidationException|Problem $e) {
            return self::back($e);
        }

        return redirect()->away(Manifest::installUrl($app->slug, StartManifest::issueState($actor->user->id, 'setup', $app->id)));
    }

    public function setup(Request $request): RedirectResponse
    {
        try {
            ReturnFromInstallation::run(Actor::fromRequest($request), $request->query());
        } catch (Problem $e) {
            return self::back($e);
        }

        return redirect('/settings/github');
    }

    public function install(Request $request): RedirectResponse
    {
        $actor = Actor::fromRequest($request);
        try {
            Authorize::check($actor, 'manageGitHub', Organization::class);
        } catch (Problem $e) {
            return self::back($e);
        }

        $id = $request->query('app');
        $app = is_string($id) && Str::isUlid(strtolower($id)) ? GitHubApp::query()->find(strtolower($id)) : null;
        if ($app === null) {
            return redirect('/settings/github');
        }

        return redirect()->away(Manifest::installUrl($app->slug, StartManifest::issueState($actor->user->id, 'setup', $app->id)));
    }

    /** Back to the settings with the sentence of the refusal. */
    private static function back(ValidationException|Problem $e): RedirectResponse
    {
        $message = $e instanceof ValidationException
            ? (string) $e->validator->errors()->first()
            : ($e->detail ?? __('problem.reason.'.$e->reason));

        return redirect('/settings/github')->with('error', $message);
    }
}
