<?php

namespace App\OpenApi;

use App\Actions\RichText\ListMentionables;
use App\Actions\RichText\ResolveReferences;
use App\Actions\Search\QuerySearch;
use App\Http\Controllers\Api\CommentsController;
use App\Http\Controllers\Api\RichTextController;
use App\Http\Controllers\Api\SearchController;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The query strings that no `ListSpec` describes: the search (`GET /search`: `q`, `types`, `limit`, `include_archived`),
 * the people to mention (`GET /mentions`) and the references of a text (`GET /references`), and the `emoji` that
 * `PUT` and `DELETE /comments/{comment}/reactions` also take in the query (the browser sends it there). Each key is one of
 * `QuerySearch::KEYS`, `ListMentionables::KEYS`, `ResolveReferences::KEYS`.
 */
final class ContentDocs extends OperationExtension
{
    /** A flag as Laravel's `boolean` reads it, in a query string. */
    private const QUERY_FLAG = ['type' => 'integer', 'enum' => [1, 0]];

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $parameters = match ($routeInfo->className().'@'.$routeInfo->methodName()) {
            SearchController::class.'@__invoke' => self::search(),
            RichTextController::class.'@mentions' => self::mentions(),
            RichTextController::class.'@references' => self::references(),
            CommentsController::class.'@react' => [self::parameter('emoji', ['type' => 'string'], 'The emoji, instead of `emoji` in the body.')],
            CommentsController::class.'@unreact' => [self::parameter('emoji', ['type' => 'string'], 'The emoji to take back, instead of `emoji` in the body.')],
            default => [],
        };

        $operation->addParameters($parameters);
    }

    /**
     * @return list<Parameter>
     */
    private static function search(): array
    {
        return [
            self::parameter('q', ['type' => 'string', 'minLength' => 1, 'maxLength' => QuerySearch::Q_MAX], 'The words to find; every word has to hit (the last one as a prefix). '
                .'Trimmed. A key (`web-47`, also a former one) puts that item first and names it in `key_match`.', true),
            self::parameter('types', ['type' => 'array', 'items' => ['type' => 'string', 'enum' => QuerySearch::TYPES]],
                'The kinds to search, separated by commas; by default all. An unknown name is 422 at `types`.')->setStyle('form')->setExplode(false),
            self::parameter('limit', ['type' => 'integer', 'minimum' => 1, 'maximum' => QuerySearch::MAX_LIMIT, 'default' => QuerySearch::DEFAULT_LIMIT], 'The most hits of each kind.'),
            self::parameter('include_archived', self::QUERY_FLAG, 'Archived items and projects, and items and pages of archived projects too (`1`).'),
        ];
    }

    /**
     * @return list<Parameter>
     */
    private static function mentions(): array
    {
        return [
            self::parameter('project', ['type' => 'string'], 'The project: ULID, identifier or a former identifier. One the account does not see is 404.', true),
            self::parameter('q', ['type' => 'string', 'maxLength' => ListMentionables::Q_MAX], 'Part of a name or handle; word beginnings first, people before bots. Without it everyone who can take work.'),
            self::parameter('limit', ['type' => 'integer', 'minimum' => 1, 'maximum' => ListMentionables::MAX_LIMIT, 'default' => ListMentionables::DEFAULT_LIMIT], 'The most accounts.'),
        ];
    }

    /**
     * @return list<Parameter>
     */
    private static function references(): array
    {
        $ulids = ['type' => 'array', 'items' => ['type' => 'string', 'pattern' => PathParameters::ULID]];

        return [
            self::parameter('items', $ulids, 'ULIDs of work items, separated by commas. Together with `pages` at least one and at most '.ResolveReferences::MAX_ITEMS.'.')
                ->setStyle('form')->setExplode(false),
            self::parameter('pages', $ulids, 'ULIDs of wiki pages, separated by commas. An ID counts only in its own list.')->setStyle('form')->setExplode(false),
        ];
    }

    /**
     * @param  array<string, mixed>  $schema
     */
    private static function parameter(string $name, array $schema, string $description, bool $required = false): Parameter
    {
        return Parameter::make($name, 'query')->setSchema(Schema::fromType(new JsonSchema($schema)))->description($description)->required($required);
    }
}
