<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Models\Project;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The projects the account sees (App\Access\Visibility), by name, then ULID (a unique order for the cursor, P12).
 * Archived projects leave the navigation (spec 4.4), so they only come with `include_archived`.
 */
final class ListProjects
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `include_archived` (bool), `cursor`, `per_page`
     * @return ListResult<Project>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewAny', Project::class);

        $valid = Validator::make($input, [
            'include_archived' => ['nullable', 'boolean'],
        ], [
            'include_archived.boolean' => __('field.include_archived.invalid'),
        ])->validate();

        $query = Project::query()->with('media')->visibleTo($actor->user)
            ->unless((bool) ($valid['include_archived'] ?? false), fn ($query) => $query->whereNull('archived_at'))
            ->orderBy('name')
            ->orderBy('id');

        return ListResult::of($query, PageArgs::from($input));
    }
}
