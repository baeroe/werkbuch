<?php

namespace App\RichText;

/**
 * What reading Markdown needs to know of the writer's world (Phase 7): whom a `@handle` names, which item a key or an
 * `item:<ulid>` link names, each only as far as the writer may know it (App\Support\RichTextLookups answers from the
 * database). Reading a text names all it will ask about to prepare() first, so the answers can come with a few queries
 * for the whole text instead of one per word.
 */
interface RichTextLookup
{
    /**
     * Everything a text is about to ask: the handles after an `@`, the keys and the IDs of `item:` links (each once).
     *
     * @param  list<string>  $handles
     * @param  list<string>  $keys  as `IDENTIFIER-NUMBER`
     * @param  list<string>  $items  ULIDs in lower case
     */
    public function prepare(array $handles, array $keys, array $items): void;

    /**
     * The account behind a handle, if the text may mention it (active, may be mentioned in the text's project).
     *
     * @return array{id: string, handle: string}|null
     */
    public function mentionable(string $handle): ?array;

    /**
     * The account behind a handle, whoever it is (no longer a member, deactivated): a person mentioned in the text before
     * stays mentioned (MarkdownContext::$keptMentions, K8).
     *
     * @return array{id: string, handle: string}|null
     */
    public function account(string $handle): ?array;

    /** The ID of the item a key names (as `IDENTIFIER-NUMBER`, a former identifier too), if the writer sees it. */
    public function visibleItemByKey(string $key): ?string;

    /** Whether the item exists and the writer sees it. */
    public function visibleItem(string $id): bool;
}
