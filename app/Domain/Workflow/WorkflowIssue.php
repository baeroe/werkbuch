<?php

namespace App\Domain\Workflow;

final readonly class WorkflowIssue
{
    public function __construct(
        public IssueCode $code,
        /** Set for `unreachable_state`. */
        public ?string $stateId = null,
    ) {}

    /**
     * @return array{code: string, state_id?: string}
     */
    public function toArray(): array
    {
        return $this->stateId === null
            ? ['code' => $this->code->value]
            : ['code' => $this->code->value, 'state_id' => $this->stateId];
    }
}
