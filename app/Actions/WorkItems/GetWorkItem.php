<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One item the account sees, loaded for WorkItemResource with the account as reader (K5). REST hands over the bound
 * model, a page the reference from its address (ULID or key, also with a former identifier of the project). An item
 * that does not exist, one the account does not see and one of a project being deleted are the same 404. Asked for by
 * a former key, the item says so (`resolved_by_former_identifier`); the caller redirects and decides nothing itself.
 *
 * `include` names what the resource embeds besides the item (`children`: the first CHILDREN_MAX in manual order,
 * archived ones included, A449; `children_progress.total` counts them all, the rest come from the item list with
 * `parent`), `type`, `workflow`, and
 * `relations` as the account reads them: ListRelations::of() with the account as reader, hidden ends blanked, and
 * `attachments`, the files of the file list oldest first, never the pictures and files of the texts); all of it is
 * loaded here, the resource asks nothing.
 */
final class GetWorkItem
{
    use AsAction;

    /** What an item can embed, in the order the resource answers it. */
    public const INCLUDES = ['children', 'type', 'workflow', 'relations', 'attachments'];

    /** How many children `include=children` embeds at most (A449): an epic with thousands of them stays one cheap read. */
    public const CHILDREN_MAX = 100;

    /**
     * @param  array<array-key, mixed>  $include  names out of INCLUDES (blanks around them and empty ones are ignored)
     *
     * @throws Problem 404
     * @throws ValidationException at `include` for anything else
     */
    public function handle(Actor $actor, WorkItem|string $item, array $include = []): WorkItem
    {
        $item = is_string($item) ? (WorkItem::findByReference($item) ?? throw Problem::notFound()) : $item;

        Authorize::check($actor, 'view', $item);

        $include = self::includes($include);

        WorkItem::loadForResource($item, $actor->user);
        $item->includes = $include;

        if (in_array('children', $include, true)) {
            // a query of its own with a limit: `load('children')` would read every child
            $children = $item->children()->limit(self::CHILDREN_MAX)->get();
            $item->setRelation('children', $children);
            WorkItem::loadForResource($children, $actor->user);
        }
        if (in_array('type', $include, true)) {
            $item->load('type.typeProperties');
        }
        if (in_array('workflow', $include, true)) {
            $item->project->load(['workflow.states', 'workflow.transitions']);
        }
        if (in_array('relations', $include, true)) {
            $item->relation_entries = ListRelations::of($item, $actor->user);
        }
        if (in_array('attachments', $include, true)) {
            // the file list only: the pictures and files of the texts are named by the texts themselves
            $item->load(['attachments' => fn (MorphMany $files) => $files->where('kind', 'file')->with('media')]);
        }

        return $item;
    }

    /**
     * @param  array<array-key, mixed>  $include
     * @return list<string> the names in the order of INCLUDES
     *
     * @throws ValidationException
     */
    private static function includes(array $include): array
    {
        $names = [];
        foreach ($include as $name) {
            $name = is_string($name) ? trim($name) : $name;
            if ($name === '') {
                continue;
            }
            if (! is_string($name) || ! in_array($name, self::INCLUDES, true)) {
                throw ValidationException::withMessages(['include' => __('field.include.unknown', [
                    'name' => is_string($name) ? $name : get_debug_type($name),
                    'allowed' => implode(', ', self::INCLUDES),
                ])]);
            }
            $names[] = $name;
        }

        return array_values(array_intersect(self::INCLUDES, $names));
    }
}
