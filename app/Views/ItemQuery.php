<?php

namespace App\Views;

use App\Access\Visibility;
use App\Domain\Filter\Condition;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\Field;
use App\Domain\Filter\Filter;
use App\Domain\Filter\Op;
use App\Domain\Views\SortSpec;
use App\Domain\WorkItems\ItemKey;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Builder;

/**
 * The one query over items (global constraint "Sichtbarkeit ist der eine Scope"): every list, group and count of items
 * starts here, so it only ever meets items of projects the account sees (WorkItem::visibleTo, never a project being
 * deleted). An id of a project, item or account the account does not see matches nothing, like an unknown one (P3).
 *
 * - The filter that holds: that of the view, the conditions of the request (long and short form) and, without sub-items,
 *   `parent is_empty`, all at once (filterOf).
 * - Without `include_archived`: archived items only when a condition asks about `archived`; items of archived projects
 *   only when a `project` condition with `is` or `in` names the project (P5: the list of an archived project shows its
 *   open items).
 * - `q`: the key of an item the account sees names exactly that item (also with a former identifier); any other text,
 *   a key-shaped one included, is a part of the title with `\`, `%` and `_` taken literally (Phase 4, as `search.ts`
 *   of the clickdummy): a hidden key reads like an unknown one.
 * - `group` (with `group_by`): only the items of that group (Grouping::restrict); `group_by` alone does not change the
 *   items, the order stays the sort.
 * - The order (sortOf): that of the request, else that of the view, else the manual order; ItemOrder applies it.
 *
 * Columns are always qualified (K3): sorts join projects and states.
 */
final class ItemQuery
{
    /**
     * @return Builder<WorkItem>
     */
    public static function for(Actor $actor, ItemQueryInput $input): Builder
    {
        $filter = self::filterOf($input);
        $query = WorkItem::query()->visibleTo($actor->user);

        if (! $input->includeArchived) {
            if (! $filter->mentions(CoreField::Archived->value)) {
                $query->whereNull($query->qualifyColumn('archived_at'));
            }
            $named = $filter->namedProjects();
            $query->whereIn($query->qualifyColumn('project_id'), Project::query()->select('projects.id')
                ->where(fn (Builder $open) => $open->whereNull('projects.archived_at')->orWhereIn('projects.id', $named)));
        }

        FilterQuery::apply($query, $filter, $actor->user);

        if ($input->q !== null) {
            self::search($query, $input->q, $actor->user);
        }
        if ($input->groupBy !== null && $input->group !== null) {
            Grouping::restrict($query, $input->groupBy, $input->group);
        }

        return $query;
    }

    /** The filter that holds: the view, the request, and `parent is_empty` without sub-items. */
    public static function filterOf(ItemQueryInput $input): Filter
    {
        $filter = ($input->view?->filter() ?? Filter::empty())->and($input->filter);

        return $input->showSubItems ? $filter : $filter->and(new Filter([
            new Condition(CoreField::Parent->value, Op::IsEmpty, null, Field::core(CoreField::Parent)),
        ]));
    }

    /** The order that holds: that of the request, else that of the view, else the manual order. */
    public static function sortOf(ItemQueryInput $input): SortSpec
    {
        return $input->sort ?? $input->view?->display()->sort ?? SortSpec::manual();
    }

    /**
     * @param  Builder<WorkItem>  $query
     */
    private static function search(Builder $query, string $q, User $reader): void
    {
        $item = ItemKey::parse($q) === null ? null : WorkItem::findByReference($q);
        if ($item !== null && Visibility::roleIn($reader, $item->project) !== null) {
            $query->whereKey($item->id);

            return;
        }

        $query->where($query->qualifyColumn('title'), 'like', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q).'%');
    }
}
