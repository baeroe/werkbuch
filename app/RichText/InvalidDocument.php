<?php

namespace App\RichText;

use InvalidArgumentException;

/**
 * A document werkbuch does not store. `reason` says why: `shape` (not a document of nodes, a node in the wrong place,
 * a wrong attribute), `node` (an unknown node), `mark` (an unknown mark), `depth` (nested deeper than
 * Schema::MAX_DEPTH), `size` (larger than Schema::MAX_BYTES).
 */
final class InvalidDocument extends InvalidArgumentException
{
    public const REASONS = ['shape', 'node', 'mark', 'depth', 'size'];

    /** @param value-of<self::REASONS> $reason */
    public function __construct(public readonly string $reason)
    {
        parent::__construct("Invalid rich text document: {$reason}.");
    }
}
