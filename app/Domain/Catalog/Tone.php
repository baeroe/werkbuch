<?php

namespace App\Domain\Catalog;

/**
 * The tone of a work item type, a label or a relation type: one of six paper colours.
 */
enum Tone: string
{
    case Sky = 'sky';
    case Ochre = 'ochre';
    case Moss = 'moss';
    case Plum = 'plum';
    case Sand = 'sand';
    case Slate = 'slate';
}
