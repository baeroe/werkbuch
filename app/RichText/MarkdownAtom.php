<?php

namespace App\RichText;

use League\CommonMark\Node\Inline\AbstractInline;

/**
 * A node of Phase 7 that MentionsAndReferences found in Markdown, as commonmark holds it until it renders the element
 * tiptap-php reads (App\RichText\Nodes): an empty element, the values only in its attributes.
 */
final class MarkdownAtom extends AbstractInline
{
    /** @param array<string, string> $attributes */
    public function __construct(public readonly string $tag, public readonly array $attributes)
    {
        parent::__construct();
    }
}
