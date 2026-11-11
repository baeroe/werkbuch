<?php

namespace App\RichText;

/**
 * The header row and the header column of a table, which Markdown cannot carry (A455): GFM writes every table with
 * its first row as the header and knows no header column. A text read from Markdown with the text before
 * (MarkdownContext::before, every save of a description, a rich text value, a comment, a page or a template) takes
 * both from the table before it, like the kept mentions and references (A229, K9).
 *
 * Tables count only when they are not inside a table (Markdown reads no table in a cell). With as many tables as
 * before, the n-th table read takes the layout of the n-th table before if both have as many columns (the rows may
 * change: a row added in Markdown keeps the header column). With another number of tables, a table was added or
 * removed somewhere: pairs are taken from the front and from the back only while both tables have as many columns
 * and the same text in their first row; at the first difference matching stops, and the tables in between read as
 * Markdown writes them (no layout ever moves to another table). Only the two switches come back, never a single
 * header cell and never a span.
 */
final class TableLayout
{
    /**
     * Header row: every cell of the first row is a `tableHeader` (an empty row is none). Header column: the first cell
     * of every row below the first is one (a table of one row has none).
     *
     * @param  array<string, mixed>  $table
     * @return array{header_row: bool, header_column: bool}
     */
    public static function of(array $table): array
    {
        $rows = self::rows($table);
        $first = self::cells($rows[0] ?? []);
        $below = array_slice($rows, 1);

        return [
            'header_row' => $first !== [] && array_all($first, fn (array $cell) => self::isHeader($cell)),
            'header_column' => $below !== [] && array_all($below, fn (array $row) => self::isHeader(self::cells($row)[0] ?? [])),
        ];
    }

    /**
     * `$read` with the layout of the tables of `$before` (see above); `$read` itself without a text before or when no
     * table changes.
     *
     * @throws InvalidDocument
     */
    public static function keep(Document $read, ?Document $before): Document
    {
        $old = $before === null ? [] : self::tables($before->toJson());
        if ($old === []) {
            return $read;
        }
        $json = $read->toJson();
        $layouts = self::pairs($old, self::tables($json));
        $changed = false;
        $index = 0;
        $json = self::map($json, function (array $table) use ($layouts, &$index, &$changed): array {
            $layout = $layouts[$index++] ?? null;
            if ($layout === null) {
                return $table;
            }
            $laid = self::laidOut($table, $layout['header_row'], $layout['header_column']);
            $changed = $changed || $laid !== $table;

            return $laid;
        });

        return $changed ? Document::fromJson($json) : $read;
    }

    /**
     * The layout each table read takes from a table before, by the index of the table read (see the class).
     *
     * @param  list<array<string, mixed>>  $before
     * @param  list<array<string, mixed>>  $read
     * @return array<int, array{header_row: bool, header_column: bool}>
     */
    private static function pairs(array $before, array $read): array
    {
        $layouts = [];
        if (count($before) === count($read)) {
            foreach ($read as $i => $table) {
                if (self::columns($before[$i]) === self::columns($table)) {
                    $layouts[$i] = self::of($before[$i]);
                }
            }

            return $layouts;
        }
        $shorter = min(count($before), count($read));
        $front = 0;
        while ($front < $shorter && self::alike($before[$front], $read[$front])) {
            $layouts[$front] = self::of($before[$front]);
            $front++;
        }
        for ($back = 1; $front + $back <= $shorter; $back++) {
            $old = $before[count($before) - $back];
            if (! self::alike($old, $read[count($read) - $back])) {
                break;
            }
            $layouts[count($read) - $back] = self::of($old);
        }

        return $layouts;
    }

    /**
     * Whether two tables are the same table: as many columns and the same text in the first row.
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private static function alike(array $a, array $b): bool
    {
        return self::columns($a) === self::columns($b) && self::heading($a) === self::heading($b);
    }

    /**
     * The text of each cell of the first row, whitespace collapsed (Markdown trims a cell).
     *
     * @param  array<string, mixed>  $table
     * @return list<string>
     */
    private static function heading(array $table): array
    {
        return array_map(
            fn (array $cell) => trim((string) preg_replace('/\s+/u', ' ', self::text($cell))),
            self::cells(self::rows($table)[0] ?? []),
        );
    }

    /**
     * The text of a node: text nodes as they are (marks split them), every other node followed by a space.
     *
     * @param  array<string, mixed>  $node
     */
    private static function text(array $node): string
    {
        if (is_string($node['text'] ?? null)) {
            return $node['text'];
        }

        return implode('', array_map(self::text(...), self::children($node))).' ';
    }

    /**
     * The table with header cells only in the first row (`$row`) and in the first column (`$column`); the cell in both
     * is one if either is (a header column without a header row starts in the first row, as the editor toggles it).
     *
     * @param  array<string, mixed>  $table
     * @return array<string, mixed>
     */
    private static function laidOut(array $table, bool $row, bool $column): array
    {
        foreach (self::rows($table) as $r => $tableRow) {
            foreach (self::cells($tableRow) as $c => $cell) {
                $cell['type'] = ($r === 0 && $row) || ($c === 0 && $column) ? 'tableHeader' : 'tableCell';
                $table['content'][$r]['content'][$c] = $cell;
            }
        }

        return $table;
    }

    /**
     * The tables of a document that are not inside a table, in the order of the text.
     *
     * @param  array<string, mixed>  $node
     * @return list<array<string, mixed>>
     */
    private static function tables(array $node): array
    {
        if (($node['type'] ?? null) === 'table') {
            return [$node];
        }
        $tables = [];
        foreach (self::children($node) as $child) {
            array_push($tables, ...self::tables($child));
        }

        return $tables;
    }

    /**
     * The node with `$map` applied to each table that is not inside a table, in the order of the text.
     *
     * @param  array<string, mixed>  $node
     * @param  callable(array<string, mixed>): array<string, mixed>  $map
     * @return array<string, mixed>
     */
    private static function map(array $node, callable $map): array
    {
        if (($node['type'] ?? null) === 'table') {
            return $map($node);
        }
        if (isset($node['content'])) {
            $node['content'] = array_map(fn (array $child) => self::map($child, $map), self::children($node));
        }

        return $node;
    }

    /**
     * The width of a table: the columns its first row spans.
     *
     * @param  array<string, mixed>  $table
     */
    private static function columns(array $table): int
    {
        return array_sum(array_map(fn (array $cell) => self::span($cell), self::cells(self::rows($table)[0] ?? [])));
    }

    /** @param  array<string, mixed>  $cell */
    private static function span(array $cell): int
    {
        $span = $cell['attrs']['colspan'] ?? 1;

        return is_int($span) ? $span : 1;
    }

    /** @param  array<string, mixed>  $cell */
    private static function isHeader(array $cell): bool
    {
        return ($cell['type'] ?? null) === 'tableHeader';
    }

    /**
     * @param  array<string, mixed>  $table
     * @return list<array<string, mixed>>
     */
    private static function rows(array $table): array
    {
        return self::children($table);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return list<array<string, mixed>>
     */
    private static function cells(array $row): array
    {
        return self::children($row);
    }

    /**
     * @param  array<string, mixed>  $node
     * @return list<array<string, mixed>>
     */
    private static function children(array $node): array
    {
        $content = $node['content'] ?? [];

        return is_array($content) ? array_values(array_filter($content, is_array(...))) : [];
    }
}
