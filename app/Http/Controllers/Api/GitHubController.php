<?php

namespace App\Http\Controllers\Api;

use App\Actions\GitHub\DisconnectGitHub;
use App\Actions\GitHub\GetGitHub;
use App\Actions\GitHub\StartManifest;
use App\Actions\GitHub\SyncGitHub;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\GitHubResource;
use App\OpenApi\GitHubSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The one GitHub app of the instance (spec 10.2): read by every account, synced by org admins; the manifest flow and
 * disconnecting only from the session (A397). Never a private key or a secret (A510).
 */
final class GitHubController extends Controller
{
    /**
     * Read the GitHub connection.
     *
     * The app (or `null`), its installations and the repos they reach with their project.
     */
    #[Answer(200, GitHubSchemas::class, 'status', 'The GitHub connection.')]
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => (new GitHubResource(GetGitHub::run(Actor::fromRequest($request))))->resolve($request)]);
    }

    /**
     * Sync installations and repos.
     *
     * Reads the installations of the app and their repos from GitHub again, and whether a ruleset protects each base branch.
     */
    #[Answer(200, GitHubSchemas::class, 'status', 'The GitHub connection after the sync.')]
    public function sync(Request $request): JsonResponse
    {
        return response()->json(['data' => (new GitHubResource(SyncGitHub::run(Actor::fromRequest($request))))->resolve($request)]);
    }

    /**
     * Start the manifest flow.
     *
     * What the browser posts to GitHub to register the app: the address and the field `manifest`; GitHub sends the
     * person back to `/github/manifest` with the `state`.
     */
    #[Body(GitHubSchemas::class, 'manifestBody')]
    #[Answer(200, GitHubSchemas::class, 'manifest', 'Where to post the manifest.')]
    public function manifest(Request $request): JsonResponse
    {
        return response()->json(['data' => StartManifest::run(Actor::fromRequest($request), $request->all())]);
    }

    /**
     * Disconnect GitHub.
     *
     * werkbuch forgets the app, its installations and repos; the strands of projects with a repo pause and their runs
     * are canceled. The app stays at GitHub.
     */
    #[Answer(200, GitHubSchemas::class, 'disconnected', 'How many runs it canceled.')]
    public function destroy(Request $request): JsonResponse
    {
        return response()->json(['canceled' => DisconnectGitHub::run(Actor::fromRequest($request))]);
    }
}
