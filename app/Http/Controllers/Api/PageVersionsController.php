<?php

namespace App\Http\Controllers\Api;

use App\Actions\Pages\GetPageVersion;
use App\Actions\Pages\ListPageVersions;
use App\Actions\Pages\RestorePageVersion;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\PageResource;
use App\Http\Resources\PageVersionResource;
use App\Models\Page;
use App\Models\PageVersion;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The kept versions of a page. `{page}` and `{pageVersion}` are bound by their ULID only (routes/api.php); whether the
 * account sees them and whether the version belongs to the page, the actions decide.
 */
final class PageVersionsController extends Controller
{
    /**
     * List the versions of a page.
     *
     * Newest first, without text, a page at a time (A315). Whoever sees the page.
     */
    #[ListOf(ListPageVersions::class)]
    public function index(Request $request, Page $page): JsonResponse
    {
        return ApiList::respond(ListPageVersions::run(Actor::fromRequest($request), $page, $request->query()), PageVersionResource::class);
    }

    /**
     * Read a version.
     *
     * One kept version with its text.
     */
    public function show(Request $request, Page $page, PageVersion $pageVersion): PageVersionResource
    {
        return new PageVersionResource(GetPageVersion::run(Actor::fromRequest($request), $page, $pageVersion));
    }

    /**
     * Restore a version.
     *
     * The version as the newest state of the page, `{data: Page}`; the replaced state is kept as a version first. The emoji of the page stays.
     */
    public function restore(Request $request, Page $page, PageVersion $pageVersion): PageResource
    {
        return new PageResource(RestorePageVersion::run(Actor::fromRequest($request), $page, $pageVersion));
    }
}
