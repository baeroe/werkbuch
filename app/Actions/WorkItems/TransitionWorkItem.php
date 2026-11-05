<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Actions\Automations\RunMoveAutomations;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\MoveStamps;
use App\Domain\WorkItems\ResolutionChoice;
use App\Domain\WorkItems\ResolutionRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Resolution;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use App\Support\StateSnapshot;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Moves a work item to another state of its project's workflow (members and admins of the project, `item.edit`), with
 * the resolution that goes with it (spec 4.5, 4.7): the workflow must allow the move (409 `transition_not_allowed`
 * naming both states and the workflow), a closed category sets the chosen resolution or the default of the category,
 * an open one clears it; `started_at` is set on the first start, `closed_at` on closing and cleared on reopening. The
 * locks of P1 (ItemLock::take), then everything checked against the item as locked; an archived project and an
 * archived item are read-only (409 `project_archived`, `archived`).
 *
 * The transaction runs up to three times (`DB::transaction(…, 3)`) like every change that locks items: "Eltern
 * schließen" locks the parent after the item and then its children shared, so two moves of children of one parent can
 * deadlock (RunMoveAutomations).
 */
final class TransitionWorkItem
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `to_state_id`, `resolution_id` (optional; only for a closed state)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item, array $input): WorkItem
    {
        Authorize::check($actor, 'update', $item);

        $item = DB::transaction(function () use ($actor, $item, $input): WorkItem {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            $to = $input['to_state_id'] ?? null;
            self::move($actor, $locked, is_string($to) ? $to : '', self::resolutionOf($input['resolution_id'] ?? null));

            return $locked;
        }, 3);

        WorkItem::loadForResource($item, $actor->user);

        return $item;
    }

    /**
     * Moves an item the caller has locked (ItemLock) and may change: no right and no lock here. An archived item is
     * read-only (409 `archived`); then check() decides. Staying in the state with the same resolution changes nothing;
     * staying with another resolution is a `work_item.updated` with `changes.resolution_id`; any other move is a
     * `work_item.state_changed` with `changes.state_id` (and `resolution_id` when it changes) and both states in
     * `meta.states` (StateSnapshot, so the history names them after a rename or removal). `$reason` notes why in
     * the event (an automation); without `$checkTransition` the workflow is not asked (the caller did, CreateWorkItem).
     * After a move into another state the automations of a move run in the same transaction (RunMoveAutomations:
     * Assignee beim Start, Eltern schließen, whose move of the parent comes back here with `$chain` one higher);
     * `$assigneeNamed`: the same change named the assignee, even as nobody (UpdateWorkItem), so Assignee beim Start
     * leaves it as it is (T11-M1).
     *
     * @return bool whether anything changed
     *
     * @throws ValidationException
     * @throws Problem
     */
    public static function move(Actor $actor, WorkItem $locked, string $toStateId, ?string $resolutionId, ?string $reason = null, bool $checkTransition = true, int $chain = 0, bool $assigneeNamed = false): bool
    {
        if ($locked->archived_at !== null) {
            throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $locked->key]));
        }

        [$from, $to, $resolution] = self::check($locked, $toStateId, $resolutionId, $checkTransition);
        $same = $from->id === $to->id;
        if ($same && $resolution === $locked->resolution_id) {
            return false;
        }

        $changes = [];
        if (! $same) {
            $changes['state_id'] = ['old' => $from->id, 'new' => $to->id];
        }
        if ($resolution !== $locked->resolution_id) {
            $changes['resolution_id'] = ['old' => $locked->resolution_id, 'new' => $resolution];
        }

        $now = $locked->freshTimestamp();
        $stamps = MoveStamps::after($from->category, $to->category, $locked->started_at?->toDateTimeImmutable(), $locked->closed_at?->toDateTimeImmutable(), $now->toDateTimeImmutable());
        $locked->state_id = $to->id;
        $locked->resolution_id = $resolution;
        $locked->setAttribute('started_at', $stamps['started_at']);
        $locked->setAttribute('closed_at', $stamps['closed_at']);
        $locked->updated_at = $now;
        $locked->save();

        $actor = $reason === null ? $actor : $actor->withReason($reason);
        EventRecorder::record($same ? EventType::WorkItemUpdated : EventType::WorkItemStateChanged, $actor, $locked, $locked->project, $changes, $same ? [] : ['states' => StateSnapshot::of($from, $to)]);
        RunMoveAutomations::run($actor, $locked, $from, $to, $chain, $assigneeNamed);

        return true;
    }

    /**
     * Checks a move of the item without changing anything (UpdateWorkItem asks before its first change): the target
     * must be a state of the project's workflow (422 `state_id`), the workflow must allow the move (409
     * `transition_not_allowed`, unless `$checkTransition` is off), and a chosen resolution must exist and be in use
     * (422 `resolution_id`). Answers the state of the item, the target and the resolution after the move.
     *
     * @return array{0: WorkflowState, 1: WorkflowState, 2: ?string}
     *
     * @throws ValidationException
     * @throws Problem
     */
    public static function check(WorkItem $locked, string $toStateId, ?string $resolutionId, bool $checkTransition = true): array
    {
        $workflow = Workflow::query()->with(['states', 'transitions'])->findOrFail($locked->project->workflow_id);
        $toStateId = Str::isUlid($toStateId) ? strtolower($toStateId) : $toStateId;
        $from = $workflow->states->firstOrFail(fn (WorkflowState $state) => $state->id === $locked->state_id);
        $to = $workflow->states->first(fn (WorkflowState $state) => $state->id === $toStateId)
            ?? throw ValidationException::withMessages(['state_id' => __('field.state_id.unknown')]);

        if ($checkTransition && ! $workflow->graph()->canTransition($from->id, $to->id)) {
            throw Problem::conflict('transition_not_allowed', [], __('problem.detail.transition_not_allowed', [
                'from' => $from->name, 'to' => $to->name, 'workflow' => $workflow->name,
            ]));
        }

        $resolutions = Resolution::query()->get();
        if ($resolutionId !== null) {
            $chosen = $resolutions->find($resolutionId);
            if ($chosen === null) {
                throw ValidationException::withMessages(['resolution_id' => __('field.resolution_id.unknown')]);
            }
            if ($chosen->archived_at !== null) {
                throw ValidationException::withMessages(['resolution_id' => __('field.resolution_id.archived')]);
            }
        }

        return [$from, $to, ResolutionRule::after($from->category, $to->category, $locked->resolution_id, $resolutionId, self::choices($resolutions))];
    }

    /**
     * The resolutions as ResolutionRule weighs them.
     *
     * @param  Collection<int, Resolution>  $resolutions
     * @return list<ResolutionChoice>
     */
    public static function choices(Collection $resolutions): array
    {
        return array_values($resolutions->map(fn (Resolution $resolution) => new ResolutionChoice(
            $resolution->id,
            StateCategory::tryFrom((string) $resolution->default_for),
            $resolution->position,
            $resolution->archived_at !== null,
        ))->all());
    }

    /**
     * The resolution a client chose: `null` for none, a ULID in lower case; anything else is no resolution there is
     * (an empty string from a form included).
     */
    public static function resolutionOf(mixed $id): ?string
    {
        if ($id === null) {
            return null;
        }

        return is_string($id) && Str::isUlid($id) ? strtolower($id) : '';
    }
}
