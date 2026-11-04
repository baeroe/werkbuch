<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageVersion;
use App\Support\Actor;
use App\Support\ReaderNames;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One kept version of a page with its text (`GET /api/v1/pages/{page}/versions/{pageVersion}`, A315) for whoever sees
 * the project of the page; a version of another page is the 404 of an unknown one. Loaded for PageVersionResource with
 * its text (`with_content`) and the names its reader may see of its mentions and references (ReaderNames).
 */
final class GetPageVersion
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Page $page, PageVersion $version): PageVersion
    {
        Authorize::check($actor, 'view', $page);
        if ($version->page_id !== $page->id) {
            throw Problem::notFound();
        }

        $version->with_content = true;
        $version->rich_names = ReaderNames::of($version->content === null ? [] : [$version->content], $actor->user);

        return $version;
    }
}
