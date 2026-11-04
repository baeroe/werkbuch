<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Support\Actor;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One page with its text (`GET /api/v1/pages/{page}`) for whoever sees its project; everybody else gets the 404 of an
 * unknown one. Loaded for PageResource with the names its reader may see (Page::loadForResource). The page comes as a
 * model or by its ULID (any case); any other text is no page.
 */
final class GetPage
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Page|string $page): Page
    {
        $page = is_string($page) ? ((Str::isUlid($page) ? Page::query()->find(strtolower($page)) : null) ?? throw Problem::notFound()) : $page;
        Authorize::check($actor, 'view', $page);

        Page::loadForResource($page, $actor->user);

        return $page;
    }
}
