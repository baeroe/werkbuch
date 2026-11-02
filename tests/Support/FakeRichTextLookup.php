<?php

namespace Tests\Support;

use App\RichText\RichTextLookup;

/**
 * A RichTextLookup from arrays, for tests of Markdown without a database: who may be mentioned, which accounts exist
 * at all, which keys name an item the writer sees.
 */
final class FakeRichTextLookup implements RichTextLookup
{
    /**
     * @param  array<string, string>  $mentionable  handle → ID of an account the text may mention
     * @param  array<string, string>  $accounts  handle → ID of any other account (no longer a member, deactivated)
     * @param  array<string, string>  $items  key → ID of an item the writer sees (a former key too)
     */
    public function __construct(
        private readonly array $mentionable = [],
        private readonly array $accounts = [],
        private readonly array $items = [],
    ) {}

    public function mentionable(string $handle): ?array
    {
        return isset($this->mentionable[$handle]) ? ['id' => $this->mentionable[$handle], 'handle' => $handle] : null;
    }

    public function account(string $handle): ?array
    {
        $id = $this->mentionable[$handle] ?? $this->accounts[$handle] ?? null;

        return $id === null ? null : ['id' => $id, 'handle' => $handle];
    }

    public function visibleItemByKey(string $key): ?string
    {
        return $this->items[$key] ?? null;
    }

    public function visibleItem(string $id): bool
    {
        return in_array($id, $this->items, true);
    }
}
