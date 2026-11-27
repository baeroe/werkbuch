<?php

namespace App\Domain\Views;

/**
 * How a view shows its items (spec 4.11, P20): grouping, order, the fields of a row or card, and whether sub-items
 * show under their parent. The layout is no part of it any more (WEBU-68): each list remembers its own in the browser.
 */
final readonly class Display
{
    /**
     * @param  list<string>  $fields  of `DisplaySchema::FIELDS` and `property:<key>`, in the order they show
     */
    public function __construct(
        public GroupBy $groupBy,
        public SortSpec $sort,
        public array $fields,
        public bool $showSubItems,
    ) {}

    /**
     * The normal form, as views store it.
     *
     * @return array{group_by: string, sort: array{field: string, direction: 'asc'|'desc'}, fields: list<string>, show_sub_items: bool}
     */
    public function toArray(): array
    {
        return [
            'group_by' => $this->groupBy->value,
            'sort' => $this->sort->toArray(),
            'fields' => $this->fields,
            'show_sub_items' => $this->showSubItems,
        ];
    }
}
