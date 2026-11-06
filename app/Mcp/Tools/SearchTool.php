<?php

namespace App\Mcp\Tools;

use App\Actions\Search\QuerySearch;
use App\Http\Resources\SearchResultsResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\OpenApi\ContentDocs;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `search`: the one search of `GET /api/v1/search` (spec 4.17) over items, wiki pages, projects, people and views, with
 * the filters of items (K13). The arguments are the query of the twin, its lists as JSON arrays (K6).
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class SearchTool extends ReadTool
{
    protected string $name = 'search';

    protected string $title = 'Search';

    protected string $description = 'Searches work items, wiki pages, projects, people and views at once (GET /search); every word has to hit, '
        .'a key (`WEB-47`) puts its item first. `type_id`, `state_category`, `assignee_id` (`none` alone: without assignee) and `label_id` narrow the items. '
        .'Hits are lean; read an item or page with its own tool.';

    protected function actions(): array
    {
        $parameters = [];
        foreach (ContentDocs::searchParameters() as $name => ['schema' => $schema, 'description' => $description]) {
            $parameters[$name] = [...$schema, 'description' => $description];
        }

        return [new McpAction(
            name: 'call',
            summary: 'Search.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => (new SearchResultsResource(QuerySearch::run($actor, self::query($args))))->resolve()]),
            parameters: $parameters,
            required: ['q'],
            twin: 'GET search',
        )];
    }

    /**
     * The query of the twin. A list of kinds that names nothing (`[]`, `[""]`) stays `[]`: the query of REST would drop
     * it and search every kind, the action refuses it (`field.types.empty`).
     *
     * @return array<string, mixed>
     */
    private static function query(McpArguments $args): array
    {
        $query = $args->query(QuerySearch::KEYS);

        return is_array($args->get('types')) && ! array_key_exists('types', $query) ? [...$query, 'types' => []] : $query;
    }
}
