<?php

namespace App\Mcp\Tools;

use App\Actions\Pages\GetPage;
use App\Actions\Pages\GetPageVersion;
use App\Actions\Pages\ListItemPages;
use App\Actions\Pages\ListPages;
use App\Actions\Pages\ListPageVersions;
use App\Http\Resources\PageNodeResource;
use App\Http\Resources\PageResource;
use App\Http\Resources\PageVersionResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Page;
use App\Models\PageVersion;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `pages` (spec 6.2): the wiki of a project as a tree (without text, `{data, meta: {total}}` as REST sends it), one
 * page with its text as Markdown, its versions, and the pages that name a work item (A456). The writes are `manage-pages`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class PagesTool extends ReadTool
{
    protected string $name = 'pages';

    protected string $title = 'Wiki pages';

    protected string $description = 'Reads the wiki of a project: the tree, one page (text as Markdown), the versions of a page and the pages that name an item.';

    protected function actions(): array
    {
        $versions = ToolSchema::list(ListPageVersions::spec());
        $named = ToolSchema::list(ListItemPages::spec());
        $page = ['page' => ToolSchema::reference('page')];

        return [
            new McpAction(
                name: 'tree',
                summary: 'The whole tree of a project, without text.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $pages = ListPages::run($actor, References::project($args->reference('project')));

                    return McpResult::resource(PageNodeResource::tree($pages)->additional(['meta' => ['total' => $pages->count()]]));
                },
                parameters: ['project' => ToolSchema::reference('project')],
                required: ['project'],
                twin: 'GET projects/{project}/pages',
            ),
            new McpAction(
                name: 'get',
                summary: 'One page with its text.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageResource(GetPage::run($actor, self::page($args)))),
                parameters: $page,
                required: ['page'],
                twin: 'GET pages/{page}',
            ),
            new McpAction(
                name: 'versions',
                summary: 'The kept versions of a page, newest first, without text.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListPageVersions::run($actor, self::page($args), $args->query(array_keys($versions))), PageVersionResource::class),
                parameters: [...$page, ...$versions],
                required: ['page'],
                twin: 'GET pages/{page}/versions',
            ),
            new McpAction(
                name: 'version',
                summary: 'One version of a page with its text.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageVersionResource(GetPageVersion::run($actor, self::page($args), self::version($args)))),
                parameters: [...$page, 'page_version' => ToolSchema::reference('pageVersion')],
                required: ['page', 'page_version'],
                twin: 'GET pages/{page}/versions/{pageVersion}',
            ),
            new McpAction(
                name: 'item',
                summary: 'The pages that name a work item, by title, without text.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListItemPages::run($actor, References::item($args->reference('item')), $args->query(array_keys($named))), PageResource::class),
                parameters: ['item' => ToolSchema::reference('item'), ...$named],
                required: ['item'],
                twin: 'GET work-items/{item}/pages',
            ),
        ];
    }

    public static function page(McpArguments $args): Page
    {
        return References::ulid(Page::class, $args->reference('page'));
    }

    public static function version(McpArguments $args): PageVersion
    {
        return References::ulid(PageVersion::class, $args->reference('page_version'));
    }
}
