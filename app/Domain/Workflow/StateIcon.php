<?php

namespace App\Domain\Workflow;

/**
 * The shape of a state's icon; the interface draws it in the colour of the category.
 */
enum StateIcon: string
{
    case Dashed = 'dashed';
    case Circle = 'circle';
    case Half = 'half';
    case ThreeQuarter = 'three-quarter';
    case Pause = 'pause';
    case Check = 'check';
    case Cross = 'cross';
}
