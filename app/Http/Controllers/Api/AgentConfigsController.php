<?php

namespace App\Http\Controllers\Api;

use App\Actions\Agents\GetAgentConfig;
use App\Actions\Agents\SaveAgentConfig;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\AgentConfigResource;
use App\Models\User;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The agent configuration of a bot (spec 10.4): org admins and the default bot. `{user}` is a bot; a person is 404.
 */
final class AgentConfigsController extends Controller
{
    /**
     * Read the agent configuration of a bot.
     *
     * Without one stored: off, every runner, Claude Code with its default model.
     */
    public function show(Request $request, User $user): AgentConfigResource
    {
        return new AgentConfigResource(GetAgentConfig::run(Actor::fromRequest($request), $user));
    }

    /**
     * Set the agent configuration of a bot.
     *
     * As a whole; switching it on needs an active bot with a responsible person, not the default bot.
     */
    #[Body(AgentSchemas::class, 'agentConfig')]
    public function update(Request $request, User $user): JsonResponse
    {
        // 200 also for the first configuration of a bot: it had one without a row
        return (new AgentConfigResource(SaveAgentConfig::run(Actor::fromRequest($request), $user, $request->all())))->response()->setStatusCode(200);
    }
}
