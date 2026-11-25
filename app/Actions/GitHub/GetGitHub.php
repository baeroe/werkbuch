<?php

namespace App\Actions\GitHub;

use App\Access\Visibility;
use App\Models\GitHubApp;
use App\Models\GitHubRepository;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The GitHub connection of the instance (spec 10.2): the apps, one per GitHub account (A680; never their keys or
 * secrets), each with its installations, and the repos they reach, each with its project. Every account reads it (the
 * project settings choose a repo); a project the reader does not see shows only as taken (`project` null, `taken` true).
 */
final class GetGitHub
{
    use AsAction;

    /**
     * @return array{apps: Collection<int, GitHubApp>, repositories: Collection<int, GitHubRepository>, visible: list<string>}
     */
    public function handle(Actor $actor): array
    {
        return [
            'apps' => GitHubApp::query()->with(['installations' => fn ($query) => $query->orderBy('account_login')->orderBy('id')])
                ->orderBy('owner_login')->orderBy('id')->get(),
            'repositories' => GitHubRepository::query()->with('link.project')->orderBy('full_name')->orderBy('id')->get(),
            'visible' => array_values(Visibility::projectIds($actor->user)->map(fn (mixed $id) => (string) $id)->all()),
        ];
    }
}
