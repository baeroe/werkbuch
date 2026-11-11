<?php

namespace App\Support;

use App\Enums\AccountType;
use App\Models\User;

/**
 * Which accounts are bots, read once per request and job (scoped in the container, T10-M8, K11): a bulk change asks
 * for its assignees with one query before it changes the items (preload), and `bot.assigned` (UpdateWorkItem::
 * announceAssignedBot) answers from here; an id nobody preloaded is asked on its own, as before. Whether an account is
 * a person or a bot never changes, and accounts are never deleted, so an answer holds for the whole request.
 */
final class BotIds
{
    /** @var array<string, bool> account id (lower case) → is a bot (false also for an id without an account) */
    private array $known = [];

    /**
     * Reads with one query which of the ids are bots; ids already known are not asked again. An id counts in any case:
     * the collation finds the account either way, the answer is held under the lower-case id (T13a-M1).
     *
     * @param  list<string>  $ids
     */
    public function preload(array $ids): void
    {
        $ids = array_values(array_diff(array_unique(array_map(strtolower(...), $ids)), array_keys($this->known)));
        if ($ids === []) {
            return;
        }

        $bots = User::query()->whereKey($ids)->where('type', AccountType::Bot)->pluck('id')->all();
        foreach ($ids as $id) {
            $this->known[$id] = in_array($id, $bots, true);
        }
    }

    public function isBot(string $id): bool
    {
        $id = strtolower($id);
        if (! array_key_exists($id, $this->known)) {
            $this->preload([$id]);
        }

        return $this->known[$id];
    }
}
