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
        return self::parameters(self::searchParameters());
    }

    /**
     * @return list<Parameter>
     */
    private static function mentions(): array
    {
        return self::parameters(self::mentionsParameters());
    }

    /**
     * The query of `GET /search` by name.
     *
     * @return array<string, array{schema: array<string, mixed>, description: string, required: bool}>
     */
    public static function searchParameters(): array
    {
        return [
            'q' => ['schema' => ['type' => 'string', 'minLength' => 1, 'maxLength' => QuerySearch::Q_MAX], 'description' => 'The words to find; every word has to hit (the last one as a prefix). '
                .'Trimmed. A key (`web-47`, also a former one) puts that item first and names it in `key_match`.', 'required' => true],
            'types' => ['schema' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => QuerySearch::TYPES]],
                'description' => 'The kinds to search, separated by commas; by default all. An unknown name is 422 at `types`.', 'required' => false],
            'limit' => ['schema' => ['type' => 'integer', 'minimum' => 1, 'maximum' => QuerySearch::MAX_LIMIT, 'default' => QuerySearch::DEFAULT_LIMIT], 'description' => 'The most hits of each kind.', 'required' => false],
            'include_archived' => ['schema' => self::QUERY_FLAG, 'description' => 'Archived items and projects, and items and pages of archived projects too (`1`).', 'required' => false],
        ];
    }

    /**
     * The query of `GET /mentions` by name.
     *
     * @return array<string, array{schema: array<string, mixed>, description: string, required: bool}>
     */
    public static function mentionsParameters(): array
    {
        return [
            'project' => ['schema' => ['type' => 'string'], 'description' => 'The project: ULID, identifier or a former identifier. One the account does not see is 404.', 'required' => true],
            'q' => ['schema' => ['type' => 'string', 'maxLength' => ListMentionables::Q_MAX], 'description' => 'Part of a name or handle; word beginnings first, people before bots. Without it everyone who can take work.', 'required' => false],
            'limit' => ['schema' => ['type' => 'integer', 'minimum' => 1, 'maximum' => ListMentionables::MAX_LIMIT, 'default' => ListMentionables::DEFAULT_LIMIT], 'description' => 'The most accounts.', 'required' => false],
        ];
    }

    /**
     * The parameters of a query by name; a list goes in one parameter, separated by commas.
     *
     * @param  array<string, array{schema: array<string, mixed>, description: string, required: bool}>  $query
     * @return list<Parameter>
     */
    private static function parameters(array $query): array
    {
        $parameters = [];
        foreach ($query as $name => ['schema' => $schema, 'description' => $description, 'required' => $required]) {
            $parameter = self::parameter($name, $schema, $description, $required);
            $parameters[] = ($schema['type'] ?? null) === 'array' ? $parameter->setStyle('form')->setExplode(false) : $parameter;
        }

        return $parameters;
    }

    /**
     * @return list<Parameter>
     */
    private static function references(): array
    {
        return self::parameters(self::referencesParameters());
    }

    /**
     * The query of `GET /references` by name.
     *
     * @return array<string, array{schema: array<string, mixed>, description: string, required: bool}>
     */
    public static function referencesParameters(): array
    {
        $ulids = ['type' => 'array', 'items' => ['type' => 'string', 'pattern' => PathParameters::ULID]];

        return [
            'items' => ['schema' => $ulids, 'description' => 'ULIDs of work items, separated by commas. Together with `pages` at least one and at most '.ResolveReferences::MAX_ITEMS.'.', 'required' => false],
            'pages' => ['schema' => $ulids, 'description' => 'ULIDs of wiki pages, separated by commas. An ID counts only in its own list.', 'required' => false],
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
