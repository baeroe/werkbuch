<?php

namespace App\Domain\Workflow;

/**
 * What stops a workflow from being saved.
 */
enum IssueCode: string
{
    case NoInitialState = 'no_initial_state';
    case NoCompletedState = 'no_completed_state';
    case UnreachableState = 'unreachable_state';
}
