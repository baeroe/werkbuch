<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\Organization;
use App\Models\User;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The agent configuration of a bot (spec 10.4, org admins): the stored one, else the one a bot has without (off, every
 * runner, Claude Code with its default model). A person is no bot: 404.
 */
final class GetAgentConfig
{
    use AsAction;

    /**
     * @throws Problem 403, 404
     */
    public function handle(Actor $actor, User $bot): AgentConfig
    {
        Authorize::check($actor, 'manageAgents', Organization::class);

        if (! $bot->isBot()) {
            throw Problem::notFound();
        }

        return AgentConfig::query()->where('bot_id', $bot->id)->first() ?? AgentConfig::unsaved($bot);
    }
}
