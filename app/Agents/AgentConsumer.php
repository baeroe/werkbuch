<?php

namespace App\Agents;

use App\Actions\Agents\FollowEvent;
use App\Events\EventConsumer;
use App\Events\EventType;
use App\Events\RetriesConsumption;
use App\Models\Event;
use App\Models\User;
use App\Support\Actor;

/**
 * The flow of the agents (spec 7) hears the events of werkbuch: assignments to bots, mentions of bots in comments,
 * assignments and moves of people, the start and the end of runs, the confirmation of the guard (FollowEvent). In the
 * transaction of the claim it only writes the database; GitHub is asked in jobs after the commit. Every other event
 * passes at once without a query.
 */
final class AgentConsumer implements EventConsumer, RetriesConsumption
{
    /** The events the flow looks at. */
    public const TYPES = [
        EventType::BotAssigned, EventType::BotMentioned, EventType::WorkItemAssigned, EventType::WorkItemStateChanged,
        EventType::AgentRunStarted, EventType::AgentRunFinished, EventType::ProjectMergeGuardConfirmed,
    ];

    public function key(): string
    {
        return 'agents';
    }

    public function queue(): string
    {
        return 'default';
    }

    /** 5 tries like the default (a deadlock with a claim is tried again), then failed_jobs. */
    public function tries(): int
    {
        return 5;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 60, 300];
    }

    public function consume(Event $event): void
    {
        if (in_array($event->type, self::TYPES, true)) {
            FollowEvent::run(Actor::system(User::defaultBot(), 'agents'), $event);
        }
    }
}
