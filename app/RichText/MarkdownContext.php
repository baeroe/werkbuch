<?php

namespace App\RichText;

use App\Models\Project;
use App\Models\User;

/**
 * Where a text is read. With a lookup, `@handle`, item keys, `[text](item:<ulid>)` and `[text](page:<ulid>)` in Markdown
 * become mentions and references (MentionsAndReferences); without one they stay text, as in Phase 4 (seeders, tests
 * without a project).
 * The kept IDs are those of the text before: they stay nodes even when the writer may no longer mention or see them
 * (A229). With a project and a writer, RichTextInput applies the rules of saving (App\Support\RichTextRules) to what it
 * read, JSON or Markdown, against `$before`, the text as it was; App\Support\RichTextRules::context() fills all of it.
 */
final readonly class MarkdownContext
{
    /**
     * @param  list<string>  $keptMentions  IDs of the people the text mentioned before
     * @param  list<string>  $keptRefs  IDs of the items and pages the text referred to before
     */
    public function __construct(
        public ?Project $project = null,
        public ?RichTextLookup $lookup = null,
        public array $keptMentions = [],
        public array $keptRefs = [],
        public ?User $writer = null,
        public ?Document $before = null,
    ) {}
}
