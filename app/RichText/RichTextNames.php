<?php

namespace App\RichText;

/**
 * What one reader may see of the nodes of a text: the current handles of mentioned people, the key and title of each
 * referenced item the reader sees, the title and project identifier of each referenced page the reader sees, display
 * names by ID (people, and the file names of images for mails). A reference whose ID is missing in `items` (or `pages`
 * for a page) is hidden; nothing here is ever stored.
 */
final readonly class RichTextNames
{
    /**
     * @param  array<string, string>  $handles  id → current handle
     * @param  array<string, array{key: string, title: string}>  $items  id → item the reader sees
     * @param  array<string, string>  $names  id → display name
     * @param  array<string, array{title: string, identifier: string}>  $pages  id → page the reader sees, with the identifier of its project
     */
    public function __construct(public array $handles = [], public array $items = [], public array $names = [], public array $pages = []) {}
}
