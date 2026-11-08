<?php

namespace App\Jobs;

use App\Actions\WorkItems\LinkReferences;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Relates an item to the items a change of its texts named anew (A452, A453), queued after the commit of the change
 * (ItemReferences::queue()). Carries IDs and flags only, never a text: the item, the items it names, the account that
 * wrote (the person a bot wrote for, when it did), the person the automation acts for and whether quietly.
 * Idempotent: a relation the first try made is a duplicate on the next one, which LinkReferences passes over.
 */
final class LinkReferencesJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60];

    /**
     * @param  list<string>  $targetIds
     */
    public function __construct(
        public string $itemId,
        public array $targetIds,
        public string $writerId,
        public ?string $onBehalfOf,
        public bool $quiet,
    ) {
        $this->onQueue('default');
    }

    public function handle(): void
    {
        // the cause as automationFor() reads it: the person the automation acts for, else the default bot (for nobody)
        $person = $this->onBehalfOf === null ? null : User::query()->find($this->onBehalfOf);
        $cause = Actor::system($person ?? User::defaultBot(), LinkReferences::REASON);

        LinkReferences::run(Actor::automationFor(LinkReferences::REASON, $this->quiet ? $cause->quietly() : $cause), $this->itemId, $this->targetIds, $this->writerId);
    }
}
