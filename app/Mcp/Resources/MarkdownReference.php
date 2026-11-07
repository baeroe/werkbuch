<?php

namespace App\Mcp\Resources;

use Laravel\Mcp\Server\Attributes\Uri;

/** The Markdown section of the rich text docs. */
#[Uri('werkbuch://reference/markdown')]
final class MarkdownReference extends DocReference
{
    protected string $title = 'Markdown for rich text';

    protected string $description = 'How descriptions, comments, pages and property values are written and read as Markdown: mentions, references, images, files and the rules when saving.';

    protected function page(): string
    {
        return 'concepts/rich-text.md';
    }
}
