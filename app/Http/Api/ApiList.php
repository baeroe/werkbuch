<?php

namespace App\Http\Api;

use App\Support\ListResult;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A list answer (P12): Laravel's cursor format `{data, links, meta: {path, per_page, next_cursor, prev_cursor}}` plus
 * `meta.total`, the number of all matches.
 */
final class ApiList
{
    /**
     * @param  ListResult<covariant Model>  $result
     * @param  class-string<JsonResource>  $resource
     */
    public static function respond(ListResult $result, string $resource): JsonResponse
    {
        return $resource::collection($result->page)->additional(['meta' => ['total' => $result->total]])->response();
    }
}
