<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageVersion;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The kept versions of a page (`GET /api/v1/pages/{page}/versions`, A315) for whoever sees its project: the newest first
 * (`version` descending, then the ULID), a page at a time with a cursor, without their text (`content` is not read; the
 * text of one comes from GetPageVersion).
 */
final class ListPageVersions
{
    use AsAction;

    /** The columns of a listed version: everything but the text. */
    private const COLUMNS = ['id', 'page_id', 'version', 'title', 'author_id', 'created_at'];

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<PageVersion>
     *
     * @throws Problem 404 when the account does not see the page
     * @throws ValidationException at `cursor` or `per_page`
     */
    public function handle(Actor $actor, Page $page, array $query): ListResult
    {
        Authorize::check($actor, 'view', $page);
        $args = PageArgs::from($query);

        $versions = PageVersion::query()->where('page_id', $page->id)
            ->select(array_map(fn (string $column) => "page_versions.{$column}", self::COLUMNS))
            ->orderByDesc('version')->orderBy('id');

        return ListResult::of($versions, $args);
    }
}
