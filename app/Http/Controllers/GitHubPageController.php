<?php

namespace App\Http\Controllers;

use App\Access\Authorize;
use App\Actions\GitHub\CompleteManifest;
use App\Actions\GitHub\GetGitHub;
use App\Actions\GitHub\ReturnFromInstallation;
use App\Actions\GitHub\StartManifest;
use App\GitHub\Manifest;
use App\Models\Organization;
use App\Support\Actor;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The plain page of the GitHub app (WEBU-24, until the settings show it in WEBU-27): its state for every account and,
 * for org admins without an app, the form that posts the manifest to GitHub (no script: the form posts itself). GitHub
 * sends the person back to `manifest` (the app becomes werkbuch's, then on to the installation) and, after installing or
 * changing the installation, to `setup` (installations and repos are read again, only with the state werkbuch gave).
 */
final class GitHubPageController extends Controller
{
    public function show(Request $request): View
    {
        $actor = Actor::fromRequest($request);
        $manages = Authorize::allows($actor, 'manageGitHub', Organization::class);
        $status = GetGitHub::run($actor);
        $start = null;
        $error = null;

        if ($manages && $status['app'] === null) {
            try {
                $start = StartManifest::run($actor, ['organization' => $request->query('organization')]);
            } catch (ValidationException $e) {
                $error = $e->validator->errors()->first();
                $start = StartManifest::run($actor, []);
            }
        }

        $install = $manages && $status['app'] !== null ? Manifest::installUrl($status['app']->slug, StartManifest::issueState($actor->user->id, 'setup')) : null;

        return view('github', ['status' => $status, 'manages' => $manages, 'start' => $start, 'error' => $error, 'install' => $install,
            'organization' => is_string($request->query('organization')) && $error === null ? $request->query('organization') : null]);
    }

    public function manifest(Request $request): RedirectResponse
    {
        $actor = Actor::fromRequest($request);
        $app = CompleteManifest::run($actor, $request->query());

        return redirect()->away(Manifest::installUrl($app->slug, StartManifest::issueState($actor->user->id, 'setup')));
    }

    public function setup(Request $request): RedirectResponse
    {
        ReturnFromInstallation::run(Actor::fromRequest($request), $request->query());

        return redirect()->route('github');
    }
}
