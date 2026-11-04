<?php

namespace App\Http\Controllers\Api;

use App\Actions\Pages\GetPage;
use App\Actions\Pages\ListPages;
use App\Http\Controllers\Controller;
use App\Http\Resources\PageNodeResource;
use App\Http\Resources\PageResource;
use App\Models\Page;
use App\Models\Project;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The pages of the wikis. `{project}` is bound by ULID, identifier or a former identifier, `{page}` by its ULID only
 * (routes/api.php); whether the account sees them, the actions decide.
 */
final class PagesController extends Controller
{
    /** The whole tree without text, `{data: PageNode[], meta: {total}}` (A315). */
    public function index(Request $request, Project $project): AnonymousResourceCollection
    {
        $pages = ListPages::run(Actor::fromRequest($request), $project);

        return PageNodeResource::tree($pages)->additional(['meta' => ['total' => $pages->count()]]);
    }

    public function show(Request $request, Page $page): PageResource
    {
        return new PageResource(GetPage::run(Actor::fromRequest($request), $page));
    }
}
