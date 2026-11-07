<?php

namespace App\Mcp\Support;

use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Mcp\Request as McpRequest;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Tool;
use Throwable;

/**
 * The frame of every tool of werkbuch (spec 6.2): a read tool `<resource>` needs `read`, a write tool
 * `manage-<resource>` needs `write`, both besides `mcp`. A tool is a thin shell around actions (`McpAction`): it picks
 * the action the call names, reads the arguments as clean as REST does, acts as `Actor::fromMcp()` and answers the body
 * of the REST twin; every exception becomes a problem as over REST (`McpProblem`).
 *
 * The ability lives on the personal access token itself (K2): a session's TransientToken says yes to every ability, so it
 * sees no tool. A tool the token may not use is missing from `tools/list` and unknown when called (the package answers
 * -32602 before `handle`, which still refuses it, defence in depth).
 *
 * A tool with one action has no argument `action`; its action is called `call`. The annotations (`IsReadOnly`,
 * `IsDestructive`, `IsOpenWorld`) are class attributes and not inherited: every tool carries its own (K17), and sets
 * `$title` (English, without "Tool").
 */
abstract class WerkbuchTool extends Tool
{
    /** `read` or `write`. */
    abstract public function ability(): string;

    /** @return list<McpAction> */
    abstract protected function actions(): array;

    final public function handle(McpRequest $request): ResponseFactory
    {
        if (! $this->allows(request()->user())) {
            return Response::make(Response::error("Tool [{$this->name()}] not found."));
        }

        try {
            $args = McpArguments::from(request());
            $action = $this->choose($args);
            $args = $args->withDefaults($action);

            return ($action->run)(Actor::fromMcp(request()), $args)->at($action->twinPath($args))->toResponse();
        } catch (Throwable $e) {
            return McpProblem::response($e);
        }
    }

    /**
     * The tool as `tools/list` names it, its input schema built from its actions (`ToolSchema::input`).
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [...parent::toArray(), 'inputSchema' => ToolSchema::input($this->actions())];
    }

    final public function shouldRegister(Request $http): bool
    {
        return $this->allows($http->user());
    }

    /** @return list<string> */
    public function actionNames(): array
    {
        return array_map(fn (McpAction $action): string => $action->name, $this->actions());
    }

    public function actionNamed(string $name): ?McpAction
    {
        foreach ($this->actions() as $action) {
            if ($action->name === $name) {
                return $action;
            }
        }

        return null;
    }

    private function allows(mixed $user): bool
    {
        $token = $user instanceof User ? $user->currentAccessToken() : null;

        return $token instanceof PersonalAccessToken && $token->can($this->ability());
    }

    /**
     * The action the call names; a tool with a single action needs no name.
     *
     * @throws ValidationException
     */
    private function choose(McpArguments $args): McpAction
    {
        $actions = $this->actions();
        if (count($actions) === 1) {
            return $actions[0];
        }

        return $this->actionNamed((string) $args->action())
            ?? throw ValidationException::withMessages(['action' => __('field.mcp.action', ['allowed' => implode(', ', $this->actionNames())])]);
    }
}
