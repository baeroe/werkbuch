<?php

namespace App\Views;

use App\Access\Visibility;
use App\Domain\Filter\Filter;
use App\Domain\Ulid;
use App\Domain\Views\GroupBy;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The groups of an item list and the columns of a board, counted by the database over the filtered query (plan, table
 * "Gruppen"; `groupItems` and `groupContext` of the clickdummy). The query comes from ItemQuery::for, so it only meets
 * items the reader sees: no group, number or parent name comes from anywhere else (Review Focus 1).
 *
 * - Every key a board needs as a column is a group, also an empty one: all states of the workflow, all categories and
 *   priorities, the enabled types and the project of the one named project, the group `none` of assignee, label and
 *   parent. The rest are the keys that occur, in a fixed order: people before bots and by name, labels and projects by
 *   name, parents by key, `none` last.
 * - "The one named project" is the one project a `project is`/`in` condition names among those the reader sees (K7):
 *   a hidden project names nothing, so its workflow and types stay unread and it reads like an unknown one.
 * - An item with two labels counts in both label groups (the total counts it once); an item without labels counts in
 *   `none`.
 * - A parent group carries its item, read in one query and only when the reader sees it (a visible child's parent is
 *   in the same project, so this holds for every group).
 */
final class Grouping
{
    /** The key of the group of items without a value (no assignee, no label, no parent). */
    public const NONE = 'none';

    /** The key of the one group without a grouping. */
    public const ALL = 'all';

    /**
     * The grouping that holds: by status only while the matches share one workflow (or there are none), otherwise by
     * category (P14).
     *
     * @param  Builder<WorkItem>  $filtered
     */
    public static function effective(Builder $filtered, GroupBy $by): GroupBy
    {
        return $by === GroupBy::State && count(self::workflows($filtered)) > 1 ? GroupBy::Category : $by;
    }

    /**
     * The groups of the matches in display order, with their numbers.
     *
     * @param  Builder<WorkItem>  $filtered
     * @return list<GroupCount>
     */
    public static function counts(Builder $filtered, GroupBy $by, Filter $filter, User $reader): array
    {
        $named = self::namedProject($filter, $reader);

        return match ($by) {
            GroupBy::State => self::states($filtered, $named),
            GroupBy::Category => self::ordered(
                array_map(fn (StateCategory $category) => $category->value, StateCategory::ORDER),
                self::tally($filtered, 'group_states.category', fn (QueryBuilder $query) => $query->join('workflow_states as group_states', 'group_states.id', '=', 'work_items.state_id')),
            ),
            GroupBy::Assignee => self::assignees(self::tally($filtered, 'work_items.assignee_id')),
            GroupBy::Priority => self::ordered(array_map(fn (Priority $priority) => $priority->value, Priority::ORDER), self::tally($filtered, 'work_items.priority')),
            GroupBy::Type => self::types(self::tally($filtered, 'work_items.type_id'), $named),
            GroupBy::Label => self::labels(self::tally(
                $filtered,
                'group_labels.label_id',
                // one row per item and label, one for an item without labels
                fn (QueryBuilder $query) => $query->leftJoin('work_item_labels as group_labels', 'group_labels.work_item_id', '=', 'work_items.id'),
            )),
            GroupBy::Project => self::projects(self::tally($filtered, 'work_items.project_id'), $named),
            GroupBy::Parent => self::parents(self::tally($filtered, 'work_items.parent_id'), $reader),
            GroupBy::None => [new GroupCount(self::ALL, (clone $filtered)->toBase()->getCountForPagination())],
        };
    }

    /**
     * The key of a group in its stored form (ULIDs in small letters), or `null` when no group of the grouping can have
     * it: states, types and projects are ULIDs, assignees, labels and parents ULIDs or `none`, categories and
     * priorities their words, the one group without a grouping `all`.
     */
    public static function key(GroupBy $by, string $key): ?string
    {
        $ulid = Ulid::is($key) ? strtolower($key) : null;

        return match ($by) {
            GroupBy::State, GroupBy::Type, GroupBy::Project => $ulid,
            GroupBy::Assignee, GroupBy::Label, GroupBy::Parent => $key === self::NONE ? $key : $ulid,
            GroupBy::Category => StateCategory::tryFrom($key)?->value,
            GroupBy::Priority => Priority::tryFrom($key)?->value,
            GroupBy::None => $key === self::ALL ? $key : null,
        };
    }

    /**
     * Only the items of one group; a key no group of the grouping can have matches nothing.
     *
     * @param  Builder<WorkItem>  $query
     */
    public static function restrict(Builder $query, GroupBy $by, string $key): void
    {
        $key = self::key($by, $key);
        if ($key === null) {
            $query->whereRaw('0 = 1');

            return;
        }

        $column = fn (string $name): string => $query->qualifyColumn($name);
        $valueOrNone = fn (string $name) => $key === self::NONE ? $query->whereNull($column($name)) : $query->where($column($name), $key);
        match ($by) {
            GroupBy::State => $query->where($column('state_id'), $key),
            GroupBy::Category => $query->whereIn($column('state_id'), WorkflowState::query()->select('workflow_states.id')->where('workflow_states.category', $key)),
            GroupBy::Assignee => $valueOrNone('assignee_id'),
            GroupBy::Priority => $query->where($column('priority'), $key),
            GroupBy::Type => $query->where($column('type_id'), $key),
            GroupBy::Label => $key === self::NONE
                ? $query->whereDoesntHave('labels')
                : $query->whereHas('labels', fn (Builder $labels) => $labels->whereKey($key)),
            GroupBy::Project => $query->where($column('project_id'), $key),
            GroupBy::Parent => $valueOrNone('parent_id'),
            GroupBy::None => $query,
        };
    }

    /**
     * The workflows of the projects of the matches.
     *
     * @param  Builder<WorkItem>  $filtered
     * @return list<string>
     */
    private static function workflows(Builder $filtered): array
    {
        $projects = (clone $filtered)->reorder()->toBase()->select('work_items.project_id');

        return array_values(Project::query()->whereIn('projects.id', $projects)->distinct()->orderBy('workflow_id')->pluck('workflow_id')->all());
    }

    /** The one project the filter names among those the reader sees (K7), else none. */
    private static function namedProject(Filter $filter, User $reader): ?Project
    {
        $visible = array_values(array_intersect($filter->namedProjects(), Visibility::projectIds($reader)->all()));

        return count($visible) === 1 ? Project::query()->find($visible[0]) : null;
    }

    /**
     * The number of matches per value of a column (`none` for no value).
     *
     * @param  Builder<WorkItem>  $filtered
     * @param  (Closure(QueryBuilder): mixed)|null  $join
     * @return array<string, int>
     */
    private static function tally(Builder $filtered, string $column, ?Closure $join = null): array
    {
        $query = (clone $filtered)->reorder()->toBase();
        if ($join !== null) {
            $join($query);
        }

        $counts = [];
        foreach ($query->select($column.' as group_key')->selectRaw('count(*) as group_count')->groupBy($column)->get() as $row) {
            $counts[(string) ($row->group_key ?? self::NONE)] = (int) $row->group_count;
        }

        return $counts;
    }

    /**
     * The groups of the order, then the keys the order does not know (by key), each with its number.
     *
     * @param  list<string>  $order
     * @param  array<string, int>  $counts
     * @param  array<string, WorkItem>  $items
     * @return list<GroupCount>
     */
    private static function ordered(array $order, array $counts, array $items = []): array
    {
        $rest = array_map('strval', array_diff(array_keys($counts), $order));
        sort($rest);

        return array_map(
            fn (string $key) => new GroupCount($key, $counts[$key] ?? 0, $items[$key] ?? null),
            [...$order, ...$rest],
        );
    }

    /**
     * All states of the one workflow of the matches, without matches that of the one named project.
     *
     * @param  Builder<WorkItem>  $filtered
     * @return list<GroupCount>
     */
    private static function states(Builder $filtered, ?Project $named): array
    {
        $workflows = self::workflows($filtered);
        $workflow = count($workflows) === 1 ? $workflows[0] : ($workflows === [] ? $named?->workflow_id : null);
        $order = $workflow === null ? [] : WorkflowState::query()->where('workflow_id', $workflow)->orderBy('position')->orderBy('id')->pluck('id')->all();

        return self::ordered(array_values($order), self::tally($filtered, 'work_items.state_id'));
    }

    /**
     * People before bots, each by name, then `none`.
     *
     * @param  array<string, int>  $counts
     * @return list<GroupCount>
     */
    private static function assignees(array $counts): array
    {
        $users = User::query()->whereKey(array_keys($counts))->orderByDesc('type')->orderBy('name')->orderBy('id')->pluck('id')->all();

        return self::ordered([...array_values($users), self::NONE], $counts);
    }

    /**
     * The types in the order of the catalog: those that occur and the enabled ones of the named project.
     *
     * @param  array<string, int>  $counts
     * @return list<GroupCount>
     */
    private static function types(array $counts, ?Project $named): array
    {
        $enabled = $named?->types()->pluck('work_item_types.id')->all() ?? [];
        $types = WorkItemType::query()->whereKey([...array_keys($counts), ...$enabled])->orderBy('id')->pluck('id')->all();

        return self::ordered(array_values($types), $counts);
    }

    /**
     * The labels that occur by name, then `none`.
     *
     * @param  array<string, int>  $counts
     * @return list<GroupCount>
     */
    private static function labels(array $counts): array
    {
        $labels = Label::query()->whereKey(array_keys($counts))->orderBy('name')->orderBy('id')->pluck('id')->all();

        return self::ordered([...array_values($labels), self::NONE], $counts);
    }

    /**
     * The projects that occur and the named one, by name.
     *
     * @param  array<string, int>  $counts
     * @return list<GroupCount>
     */
    private static function projects(array $counts, ?Project $named): array
    {
        $projects = Project::query()->whereKey(array_filter([...array_keys($counts), $named?->id]))->orderBy('name')->orderBy('id')->pluck('id')->all();

        return self::ordered(array_values($projects), $counts);
    }

    /**
     * The parents by key, each with its item, then `none`. Only a parent the reader sees names a group: a key without
     * one (a parent the reader may not see) counts into `none`, so that no group answers with the ULID of an item the
     * reader may not know. A parent lives in the project of its child (`field.parent_id.project`), so this only guards
     * against rows built by hand.
     *
     * @param  array<string, int>  $counts
     * @return list<GroupCount>
     */
    private static function parents(array $counts, User $reader): array
    {
        $parents = WorkItem::query()->visibleTo($reader)->whereKey(array_keys($counts))
            ->join('projects as group_projects', 'group_projects.id', '=', 'work_items.project_id')
            ->orderBy('group_projects.identifier')->orderBy('work_items.number')
            ->select('work_items.*')->with('project')->get()->keyBy('id')->all();

        $known = [self::NONE => 0];
        foreach ($counts as $key => $count) {
            $group = array_key_exists($key, $parents) ? (string) $key : self::NONE;
            $known[$group] = ($known[$group] ?? 0) + $count;
        }

        return self::ordered([...array_map('strval', array_keys($parents)), self::NONE], $known, $parents);
    }
}
