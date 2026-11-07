<?php

namespace App\Http\Api;

use App\Support\ListResult;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A list answer (P12): Laravel's cursor format `{data, links, meta: {path, per_page, next_cursor, prev_cursor}}` plus
 * `meta.total`, the number of all matches.
 *
 * The links of a `GET` list keep its query (filter, sort, `per_page`), so that following `links.next` gives the next
 * page of the same list. A list read by `POST` (`/work-items/query`) has no address to follow: its `links.next` and
 * `links.prev` are `null`, the same request with `meta.next_cursor` as `cursor` leads on.
 *
 * The cursors of a list with a `ListSpec` carry the signature of its sort (`_sig`, `ListQuery`, `ListResult`). In the
 * document `ApiList::respond($result, X::class)` is `{data: list<X>, links: ListLinks, meta: ListMeta}`
 * (`App\OpenApi\ApiListReturnType`, `ApiListSchema`); the query of the list comes from `#[ListOf]` (`ListParameters`).
 */
final class ApiList
{
    /**
     * @param  ListResult<covariant Model>  $result
     * @param  class-string<JsonResource>  $resource
     */
    public static function respond(ListResult $result, string $resource): JsonResponse
    {
        return response()->json(self::payload($result, $resource, request()));
    }

    /**
     * The body of a list answer, for the response of an /api route and the result of an MCP tool. The rows and the
     * values in them keep the shape their JSON has: an empty object (`values: {}`) stays one.
     *
     * @param  ListResult<covariant Model>  $result
     * @param  class-string<JsonResource>  $resource
     * @return array{data: list<array<string, mixed>>, links: array<string, mixed>, meta: array<string, mixed>}
     */
    public static function payload(ListResult $result, string $resource, Request $request): array
    {
        $get = $request->isMethodSafe();
        if ($get) {
            $result->page->appends($request->query());
        }
        $response = $resource::collection($result->page)->additional(['meta' => ['total' => $result->total]])->toResponse($request);
        // as objects: an empty object stays one
        /** @var \stdClass&object{data: list<\stdClass>, links: \stdClass, meta: \stdClass} $body */
        $body = $response->getData();
        if (! $get) {
            $body->links->next = null;
            $body->links->prev = null;
        }

        return [
            'data' => array_map(fn (\stdClass $row): array => (array) $row, $body->data),
            'links' => (array) $body->links,
            'meta' => (array) $body->meta,
        ];
    }
}
