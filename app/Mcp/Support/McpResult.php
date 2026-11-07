<?php

namespace App\Mcp\Support;

use App\Http\Api\ApiList;
use App\Support\ListResult;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Resources\Json\JsonResource;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use stdClass;

/**
 * The result of an MCP action: the body the REST twin answers, without `links` (K7). It is kept as decoded JSON with
 * objects, so an empty object (`values: {}`) stays one; only the top level becomes an array for `Response::structured`
 * (the package mirrors it as text). Rich text leaves as Markdown (`Output::markdown`).
 *
 * The paginator of a list names the address of the request (`…/mcp`) as `meta.path`; `at()` sets the path of the twin
 * instead, the one REST names, and drops the key for an action without a twin.
 */
final readonly class McpResult
{
    private function __construct(private stdClass $body, private bool $list = false) {}

    /**
     * A single resource, `{data: …}` as REST sends it (with what the resource adds), resolved against the request.
     */
    public static function resource(JsonResource $resource): self
    {
        return new self(self::object((string) $resource->toResponse(request())->getContent()));
    }

    /**
     * A list `{data, meta}` as REST sends it, without `links`.
     *
     * @param  ListResult<covariant Model>  $result
     * @param  class-string<JsonResource>  $resource
     */
    public static function list(ListResult $result, string $resource): self
    {
        $payload = ApiList::payload($result, $resource, request());
        unset($payload['links']);

        return new self(self::object((string) json_encode((object) $payload)), list: true);
    }

    /**
     * A body REST sends as it is (`{updated, rejected}`, `{outcome}`).
     *
     * @param  array<array-key, mixed>|stdClass  $body
     */
    public static function body(array|stdClass $body): self
    {
        return new self(self::object((string) json_encode(is_array($body) ? (object) $body : $body)));
    }

    /**
     * What REST answers with 204.
     */
    public static function done(): self
    {
        return self::body(['done' => true]);
    }

    /**
     * The result with `meta.path` of a list set to the path of the twin (`null`: the key goes); other results stay.
     */
    public function at(?string $path): self
    {
        if (! $this->list) {
            return $this;
        }

        $body = self::object((string) json_encode($this->body));
        if ($path === null) {
            unset($body->meta->path);
        } else {
            $body->meta->path = $path;
        }

        return new self($body, list: true);
    }

    public function toResponse(): ResponseFactory
    {
        return Response::structured((array) Output::markdown($this->body));
    }

    /**
     * The JSON of an object, decoded with objects (an empty object stays `{}`).
     */
    private static function object(string $json): stdClass
    {
        /** @var stdClass */
        return json_decode($json, flags: JSON_THROW_ON_ERROR);
    }
}
