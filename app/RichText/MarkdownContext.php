<?php

namespace App\RichText;

use App\Models\Project;

/**
 * Where a Markdown text is read. With a lookup, `@handle`, item keys and `[text](item:<ulid>)` become mentions and
 * references (MentionsAndReferences); without one they stay text, as in Phase 4 (seeders, tests without a project).
 * The kept IDs are those of the text before: they stay nodes even when the writer may no longer mention or see them
 * (A229).
 */
final readonly class MarkdownContext
{
    /**
     * @param  list<string>  $keptMentions  IDs of the people the text mentioned before
     * @param  list<string>  $keptRefs  IDs of the items the text referred to before
     */
    public function __construct(
        public ?Project $project = null,
        public ?RichTextLookup $lookup = null,
        public array $keptMentions = [],
        public array $keptRefs = [],
    ) {}
}
