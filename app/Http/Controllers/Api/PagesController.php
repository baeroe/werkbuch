<?php

namespace App\Http\Controllers\Api;

use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\GetPage;
use App\Actions\Pages\ListPages;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\PageNodeResource;
use App\Http\Resources\PageResource;
use App\Models\Page;
use App\Models\Project;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The pages of the wikis. `{project}` is bound by ULID, identifier or a former identifier, `{page}` by its ULID only
 * (routes/api.php); whether the account sees them, the actions decide.
 */
final class PagesController extends Controller
{
    /**
     * The tree of a wiki.
     *
     * The whole tree of the project without text, `{data: PageNode[], meta: {total}}`: the pages of the top level, each with its `children` all the way down, in order. No cursor (A315). Whoever sees the project reads it, also an archived one.
     */
    public function index(Request $request, Project $project): AnonymousResourceCollection
    {
        $pages = ListPages::run(Actor::fromRequest($request), $project);

        return PageNodeResource::tree($pages)->additional(['meta' => ['total' => $pages->count()]]);
    }

    /**
     * Create a page.
     *
     * A new page at the end of its siblings, 201 `{data: Page}`, in version 1.
     */
    #[Body(OperationsSchemas::class, 'pageCreate')]
    public function store(Request $request, Project $project): JsonResponse
    {
        return (new PageResource(CreatePage::run(Actor::fromRequest($request), $project, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Read a page.
     *
     * With its text as Markdown for the reader and as Tiptap JSON. Whoever sees its project.
     */
    public function show(Request $request, Page $page): PageResource
    {
        return new PageResource(GetPage::run(Actor::fromRequest($request), $page));
    }

    /**
     * Save a page.
     *
     * Saves what the body sends; `base_version` guards against an overwrite: when the page has changed meanwhile this is 409 `page_conflict` with the page as it is now in `current`.
     */
    #[Body(OperationsSchemas::class, 'pageUpdate')]
    public function update(Request $request, Page $page): PageResource
    {
        return new PageResource(UpdatePage::run(Actor::fromRequest($request), $page, $request->all()));
    }

    /**
     * Move a page.
     *
     * Moves the page with its subtree under `parent_id`, in front of `before_id` (`null`: at the end), `{data: Page}`.
     */
    #[Body(OperationsSchemas::class, 'pageMove')]
    public function move(Request $request, Page $page): PageResource
    {
        return new PageResource(MovePage::run(Actor::fromRequest($request), $page, $request->all()));
    }

    /**
     * Delete a page.
     *
     * Deletes the page with its whole subtree, 200 `{deleted}` (how many pages went). Pictures and files that another text still shows go to that text.
     */
    #[Answer(200, OperationsSchemas::class, 'pageDeleted', 'How many pages went.')]
    public function destroy(Request $request, Page $page): JsonResponse
    {
        return response()->json(['deleted' => DeletePage::run(Actor::fromRequest($request), $page)]);
    }
}
