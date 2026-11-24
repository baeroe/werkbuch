<?php

namespace App\Http\Resources;

use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The GitHub connection (spec 10.2) from GetGitHub: the app without key and secret (A510), its installations and the
 * repos with their project; a project the reader does not see is only `taken`.
 */
final class GitHubResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var array{app: GitHubApp|null, installations: Collection<int, GitHubInstallation>, repositories: Collection<int, GitHubRepository>, visible: list<string>} $status */
        $status = $this->resource;
        $app = $status['app'];

        return [
            'app' => $app === null ? null : [
                'id' => $app->id,
                'app_id' => $app->app_id,
                'slug' => $app->slug,
                'name' => $app->name,
                'owner_login' => $app->owner_login,
                'owner_type' => $app->owner_type,
                'html_url' => $app->html_url,
                'install_url' => Manifest::installUrl($app->slug),
                'permissions' => (object) $app->permissions,
                'events' => $app->events,
                'created_at' => $app->created_at?->toJSON(),
            ],
            'installations' => $status['installations']->map(fn (GitHubInstallation $installation) => [
                'id' => $installation->id,
                'installation_id' => $installation->installation_id,
                'account_login' => $installation->account_login,
                'account_type' => $installation->account_type,
                'repository_selection' => $installation->repository_selection,
                'suspended_at' => $installation->suspended_at?->toJSON(),
                'removed_at' => $installation->removed_at?->toJSON(),
            ])->values()->all(),
            'repositories' => $status['repositories']->map(function (GitHubRepository $repository) use ($status) {
                $link = $repository->link;
                $visible = $link !== null && in_array($link->project_id, $status['visible'], true);

                return [
                    'id' => $repository->id,
                    'installation_id' => $repository->installation_id,
                    'full_name' => $repository->full_name,
                    'private' => $repository->private,
                    'default_branch' => $repository->default_branch,
                    'html_url' => $repository->html_url,
                    'removed_at' => $repository->removed_at?->toJSON(),
                    'taken' => $link !== null,
                    'project' => ! $visible ? null : [
                        'id' => $link->project->id,
                        'identifier' => $link->project->identifier,
                        'name' => $link->project->name,
                        'base_branch' => $link->base_branch,
                        'protected' => $link->protected,
                        'guarded' => $link->guarded(),
                    ],
                ];
            })->values()->all(),
        ];
    }
}
