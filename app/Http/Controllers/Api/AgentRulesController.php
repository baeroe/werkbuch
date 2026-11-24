<?php

namespace App\Http\Controllers\Api;

use App\Actions\Agents\ListAgentRules;
use App\Actions\Agents\SaveAgentRule;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\AgentRuleResource;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AgentRulesController extends Controller
{
    /**
     * List the working rules of the agents.
     *
     * One text per kind of run with the contract of the kind (read only, first in every prompt); every account reads them.
     */
    #[Answer(200, AgentSchemas::class, 'rules', 'The rules of every kind of run.')]
    public function index(Request $request): JsonResponse
    {
        return AgentRuleResource::collection(ListAgentRules::run(Actor::fromRequest($request)))->response();
    }

    /**
     * Set the working rules of a kind of run.
     *
     * `null` or an empty text restores the standard of werkbuch; org admins only.
     */
    #[Body(AgentSchemas::class, 'ruleBody')]
    #[Answer(200, AgentSchemas::class, 'rule', 'The rules of the kind.')]
    public function update(Request $request, string $kind): JsonResponse
    {
        return (new AgentRuleResource(SaveAgentRule::run(Actor::fromRequest($request), $kind, $request->all())))->response();
    }
}
