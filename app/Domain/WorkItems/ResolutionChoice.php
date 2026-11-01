<?php

namespace App\Domain\WorkItems;

use App\Domain\Workflow\StateCategory;

/**
 * A resolution as `ResolutionRule` sees it: its id, the closed category it is the default for, its place and whether
 * it is archived.
 */
final readonly class ResolutionChoice
{
    public function __construct(
        public string $id,
        public ?StateCategory $defaultFor,
        public int $position,
        public bool $archived,
    ) {}
}
