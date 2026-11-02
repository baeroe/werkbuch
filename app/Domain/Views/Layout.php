<?php

namespace App\Domain\Views;

/**
 * How a view shows its items (spec 4.11).
 */
enum Layout: string
{
    case List = 'list';
    case Board = 'board';
    case Table = 'table';
    case Timeline = 'timeline';
}
