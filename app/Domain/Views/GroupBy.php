<?php

namespace App\Domain\Views;

/**
 * How a list groups its items and a board its columns (spec 4.11, plan, table "Gruppen").
 */
enum GroupBy: string
{
    case State = 'state';
    case Category = 'category';
    case Assignee = 'assignee';
    case Priority = 'priority';
    case Type = 'type';
    case Label = 'label';
    case Project = 'project';
    case Parent = 'parent';
    case None = 'none';
}
