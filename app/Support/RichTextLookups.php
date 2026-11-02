<?php

namespace App\Support;

use App\Access\Assignable;
use App\Access\Visibility;
use App\Domain\WorkItems\ItemKey;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\RichTextLookup;

/**
 * What a writer's Markdown names, answered from the database (RichTextLookup): who may be mentioned in the project
 * (Assignable, A231), which accounts exist at all (K8), which items the writer sees by key (a former identifier too) or
 * by ID (Visibility, never a project being deleted). Each handle, key and ID is asked once: prepare() loads all a text
 * names with a fixed number of queries (in blocks of CHUNK), a single question asks for that one alone and keeps the
 * answer.
 */
final class RichTextLookups implements RichTextLookup
{
    /** The most values of one `where in` (MariaDB takes at most 65 535 placeholders in a statement). */
    public const CHUNK = 1000;

    /** @var array<string, User|null> handle → account, null for none */
    private array $accounts = [];

    /** @var array<string, true> IDs of the accounts the text may mention */
    private array $mentionable = [];

    /** @var array<string, string|null> key → ID of the item the writer sees, null for none */
    private array $keys = [];

    /** @var array<string, bool> item ID → whether the writer sees it */
    private array $items = [];

    public function __construct(private readonly Project $project, private readonly User $writer) {}

    public function prepare(array $handles, array $keys, array $items): void
    {
        $this->loadAccounts(array_values(array_filter($handles, fn (string $handle) => ! array_key_exists($handle, $this->accounts))));
        $this->loadKeys(array_values(array_filter($keys, fn (string $key) => ! array_key_exists($key, $this->keys))));
        $this->loadItems(array_values(array_filter($items, fn (string $id) => ! array_key_exists($id, $this->items))));
    }

    public function mentionable(string $handle): ?array
    {
        $account = $this->account($handle);

        return $account !== null && isset($this->mentionable[$account['id']]) ? $account : null;
    }

    public function account(string $handle): ?array
    {
        $this->prepare([$handle], [], []);
        $user = $this->accounts[$handle];

        return $user === null ? null : ['id' => $user->id, 'handle' => $user->handle];
    }

    public function visibleItemByKey(string $key): ?string
    {
        $this->prepare([], [$key], []);

        return $this->keys[$key];
    }

    public function visibleItem(string $id): bool
    {
        $this->prepare([], [], [$id]);

        return $this->items[$id];
    }

    /** @param list<string> $handles */
    private function loadAccounts(array $handles): void
    {
        foreach (array_chunk($handles, self::CHUNK) as $chunk) {
            $users = User::query()->whereIn('handle', $chunk)->get();
            $byHandle = $users->keyBy('handle');
            foreach ($chunk as $handle) {
                $this->accounts[$handle] = $byHandle->get($handle);
            }
            foreach (Assignable::among($users, $this->project) as $id) {
                $this->mentionable[$id] = true;
            }
        }
    }

    /** @param list<string> $keys as `IDENTIFIER-NUMBER` */
    private function loadKeys(array $keys): void
    {
        if ($keys === []) {
            return;
        }
        $visible = Visibility::projectIds($this->writer)->all();
        foreach (array_chunk($keys, self::CHUNK) as $chunk) {
            $parsed = array_map(fn (string $key) => ItemKey::parse($key) ?? ['identifier' => '', 'number' => 0], $chunk);
            $identifiers = array_values(array_unique(array_column($parsed, 'identifier')));
            // a current identifier wins over a former one (WorkItem::findByReference)
            $projects = Project::query()->whereIn('identifier', $identifiers)->pluck('id', 'identifier')->all();
            $former = array_values(array_diff($identifiers, array_keys($projects)));
            $projects += $former === [] ? [] : ProjectIdentifier::query()->whereIn('identifier', $former)->pluck('project_id', 'identifier')->all();
            $projects = array_filter($projects, fn (string $id) => in_array($id, $visible, true));

            $found = [];
            if ($projects !== []) {
                $rows = WorkItem::query()->select(['id', 'project_id', 'number'])
                    ->whereIn('project_id', array_values($projects))->whereIn('number', array_column($parsed, 'number'))->toBase()->get();
                foreach ($rows as $row) {
                    $found["{$row->project_id}:{$row->number}"] = (string) $row->id;
                }
            }
            foreach ($chunk as $index => $key) {
                $project = $projects[$parsed[$index]['identifier']] ?? null;
                $this->keys[$key] = $project === null ? null : $found["{$project}:{$parsed[$index]['number']}"] ?? null;
            }
        }
    }

    /** @param list<string> $ids */
    private function loadItems(array $ids): void
    {
        if ($ids === []) {
            return;
        }
        $visible = Visibility::projectIds($this->writer)->all();
        foreach (array_chunk($ids, self::CHUNK) as $chunk) {
            $seen = WorkItem::query()->whereKey($chunk)->whereIn('project_id', $visible)->pluck('id')->all();
            foreach ($chunk as $id) {
                $this->items[$id] = in_array($id, $seen, true);
            }
        }
    }
}
