<?php

namespace App\Support;

use App\RichText\InvalidDocument;
use RuntimeException;

/**
 * A saved text that Document::fromJson refuses (T13-M3): which owner it belongs to (`work_item` for a description or
 * a rich text value, `comment`), so that whoever reads the texts of a project can skip it and say which one it was.
 */
final class UnreadableText extends RuntimeException
{
    public function __construct(public readonly string $ownerType, public readonly string $ownerId, InvalidDocument $previous)
    {
        parent::__construct("The text of {$ownerType} {$ownerId} cannot be read ({$previous->reason}).", 0, $previous);
    }
}
