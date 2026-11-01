<?php

namespace App\RichText;

use App\Models\Project;

/**
 * Where a Markdown text is read: Phase 7 resolves `@handle` and item keys against the project. Phase 4 reads only the
 * standard nodes and needs nothing of it yet.
 */
final readonly class MarkdownContext
{
    public function __construct(public ?Project $project = null) {}
}
