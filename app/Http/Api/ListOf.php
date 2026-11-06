<?php

namespace App\Http\Api;

use App\Support\ListSpec;
use Attribute;

/**
 * Names the list action of a controller method (`#[ListOf(ListUsers::class)]`, A386), so the document reads the rules
 * of the list from it (`App\OpenApi\ListParameters`): its page and the filters, sorts and includes of its `ListSpec`
 * (`public static function spec(): ListSpec`, or another static method, `#[ListOf(ListUsers::class, 'botSpec')]`).
 */
#[Attribute(Attribute::TARGET_METHOD)]
final readonly class ListOf
{
    /**
     * @param  class-string  $action
     */
    public function __construct(public string $action, public string $method = 'spec') {}

    /**
     * The rules of the list, `null` for an action without them (it takes only the page).
     */
    public function spec(): ?ListSpec
    {
        $spec = method_exists($this->action, $this->method) ? ($this->action)::{$this->method}() : null;

        return $spec instanceof ListSpec ? $spec : null;
    }
}
