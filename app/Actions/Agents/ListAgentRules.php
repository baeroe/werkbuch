<?php

namespace App\Actions\Agents;

use App\Domain\Agents\RunType;
use App\Support\Actor;
use App\Support\AgentRules;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The working rules of the organization per kind of run (spec 7.3, 10.5): every account reads them, with the contract
 * of the kind (the resource adds it) and whether a text is the standard.
 */
final class ListAgentRules
{
    use AsAction;

    /**
     * @return list<array{type: RunType, body: string, standard: bool}>
     */
    public function handle(Actor $actor): array
    {
        return AgentRules::all();
    }
}
