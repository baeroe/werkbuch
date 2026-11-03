<?php

namespace App\RichText;

/**
 * Fills a stored document so that it fits Schema::CONTENT, the way ProseMirror fills content it reads (`fillBefore`):
 * a list item or task item that starts with another block gets an empty paragraph first, an empty quote or cell gets
 * one, an empty list or table goes (and what it leaves empty is filled in turn). Until Document checked the content
 * (Phase 7), Markdown such as `- - a` and JSON with empty containers were stored like that; the migration
 * `…_000930_repair_rich_text_content` runs every stored document through this before Document reads it.
 *
 * Only the content is touched; what it does not understand stays as it is, for Document to refuse.
 */
final class ContentRepair
{
    /** Nodes whose content starts with a paragraph (`paragraph block*`). */
    private const ITEMS = ['listItem', 'taskItem'];

    /** Nodes that hold a block at least (`block+`). */
    private const FILLED = ['blockquote', 'tableCell', 'tableHeader'];

    /** Nodes that mean nothing without their content (`listItem+`, `taskItem+`, `tableRow+`). */
    private const DROPPED = ['bulletList', 'orderedList', 'taskList', 'table'];

    private const PARAGRAPH = ['type' => 'paragraph'];

    /**
     * @param  array<mixed>  $json
     * @return array<mixed>
     */
    public static function of(array $json): array
    {
        // the doc itself is never dropped
        return self::node($json) ?? ['type' => 'doc', 'content' => []];
    }

    /**
     * The node with its content filled, or null when it goes.
     *
     * @param  array<mixed>  $node
     * @return array<mixed>|null
     */
    private static function node(array $node): ?array
    {
        $type = $node['type'] ?? null;
        $content = $node['content'] ?? [];
        if (! is_array($content) || ! array_is_list($content)) {
            return $node;
        }
        $children = [];
        foreach ($content as $child) {
            $kept = is_array($child) ? self::node($child) : $child;
            if ($kept !== null) {
                $children[] = $kept;
            }
        }
        if (in_array($type, self::DROPPED, true) && $children === []) {
            return null;
        }
        $first = $children[0] ?? null;
        if (in_array($type, self::ITEMS, true) && (! is_array($first) || ($first['type'] ?? null) !== 'paragraph')) {
            array_unshift($children, self::PARAGRAPH);
        }
        if (in_array($type, self::FILLED, true) && $children === []) {
            $children = [self::PARAGRAPH];
        }
        if (array_key_exists('content', $node) || $children !== []) {
            $node['content'] = $children;
        }

        return $node;
    }
}
