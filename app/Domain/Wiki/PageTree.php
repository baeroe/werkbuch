<?php

namespace App\Domain\Wiki;

/**
 * The page tree of a wiki as parent links (spec 4.15): which pages lie below a page, and whether a move would put a page
 * into itself or its own subtree. Pure: the caller reads the links of one project under its lock and asks here.
 */
final class PageTree
{
    /** @param array<string, ?string> $parents page id => parent id (null: top level), in the order of the siblings */
    public function __construct(private readonly array $parents) {}

    /**
     * The page and every page below it: the page first, then level by level in the order of `$parents`. A page that is
     * not in the tree gives an empty list; a broken tree (a loop) never runs forever.
     *
     * @return list<string>
     */
    public function subtree(string $id): array
    {
        if (! array_key_exists($id, $this->parents)) {
            return [];
        }
        $children = [];
        foreach ($this->parents as $child => $parent) {
            if ($parent !== null) {
                $children[$parent][] = (string) $child;
            }
        }
        $found = [];
        $queue = [$id];
        while ($queue !== []) {
            $next = array_shift($queue);
            if (isset($found[$next])) {
                continue;
            }
            $found[$next] = true;
            foreach ($children[$next] ?? [] as $child) {
                $queue[] = $child;
            }
        }

        return array_keys($found);
    }

    /** Whether `$id` under `$parent` would stand in itself or its own subtree (or `$parent` hangs in a loop). */
    public function wouldCycle(string $id, ?string $parent): bool
    {
        $seen = [];
        for ($cursor = $parent; $cursor !== null; $cursor = $this->parents[$cursor] ?? null) {
            if ($cursor === $id || isset($seen[$cursor])) {
                return true;
            }
            $seen[$cursor] = true;
        }

        return false;
    }
}
