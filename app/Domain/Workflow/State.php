<?php

namespace App\Domain\Workflow;

/**
 * A state of a workflow as the rules see it: no row, only what the graph needs.
 */
final readonly class State
{
    public function __construct(
        public string $id,
        public string $name,
        public StateIcon $icon,
        public StateCategory $category,
        public int $position,
    ) {}
}
