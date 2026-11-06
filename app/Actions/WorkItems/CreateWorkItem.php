<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\Ranking\Rank;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\MoveStamps;
use App\Domain\WorkItems\ResolutionChoice;
use App\Domain\WorkItems\ResolutionRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\Template;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\CatalogLock;
use App\Support\ItemInput;
use App\Support\ItemValues;
use App\Support\MemberInput;
use App\Support\Mentions;
use App\Support\TemplateAttachments;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a work item (members and admins of the project, `item.create`) in the initial state of the project's
 * workflow: the next number of the project (never used again, even when the item goes), a rank after its last item,
 * labels, values, the creator (a person) and the assignee (a person) as watchers, and the event `work_item.created`.
 * The description and the rich text values went through the rules of saving before the locks (ItemInput::documents());
 * their uploads now belong to the item (AttachmentLinks), the people they mention watch it, `meta.mentioned` names
 * everyone they mention and each bot among them gets `bot.mentioned` (Mentions, A244).
 * Another state named in the input is a move from the initial one, checked before anything is written and made after
 * the creation (TransitionWorkItem::move(), P32). The rich text is read before any lock; then the organization shared
 * (no type or property goes meanwhile), then the project `for update` (one number and one last rank at a time, P1), a
 * parent shared (ItemInput), and every field checked under them. A refusal leaves nothing behind: no item, no number
 * used up, no event. With `template_id` the item is made from a template of the project: the texts name copies of the
 * template's pictures, made before any lock (A337), the item keeps the template and its event names it (A352). The
 * work before the locks is prepare(), the one under them insert() (K1: a run of a template locks in between).
 *
 * The transaction runs up to three times (`DB::transaction(…, 3)`), defensively: it holds the project `for update`, so
 * a deletion (which needs the project shared) cannot meet it; the retry is there for any change that locks the parent
 * row between the share lock of the organization and the parent's shared lock.
 */
final class CreateWorkItem
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `project_id` (ULID, identifier or former identifier), `type_id`, `title`, `description` or `description_json`, `assignee_id`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id` (ULID or key), `values` (property key → value), `state_id` (the initial state unless named), `template_id` (a template of the project the item is made from)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, array $input): WorkItem
    {
        $prepared = self::prepare($actor, $input);

        return self::insert($actor, $prepared['project'], $prepared);
    }

    /**
     * What happens before any lock (K1): the project (unknown 404) and the right to create items in it, the rich text
     * read through the rules of saving (ItemInput::documents(), it may take a second) and, with `template_id`, the
     * template of the project (otherwise `field.template_id.unknown`, reported with every other field error under the
     * locks) and copies of its pictures and files for the texts (TemplateAttachments::copy(), A337: files are never
     * copied under the project lock), only for an input not refused yet (T6-M2).
     *
     * @param  array<array-key, mixed>  $input  as handle() takes it
     * @return array{project: Project, input: array<array-key, mixed>, refused: array<string, list<string>>, texts: array<string, Document>, template: ?Template}
     *
     * @throws ValidationException
     * @throws Problem
     */
    public static function prepare(Actor $actor, array $input): array
    {
        $reference = $input['project_id'] ?? null;
        if (! is_string($reference)) {
            throw ValidationException::withMessages(['project_id' => __('field.required')]);
        }

        $project = Project::findByReference($reference) ?? throw Problem::notFound();
        Authorize::check($actor, 'create', WorkItem::class, $project);

        // reading Markdown is the expensive step: never under a lock
        [$input, $refused, $texts] = ItemInput::documents($input, $project, $actor);

        $template = null;
        if (($input['template_id'] ?? null) !== null) {
            $template = ItemInput::template($input['template_id'], $project, function (string $field, string $message) use (&$refused): void {
                $refused[$field] ??= [$message];
            });
        }
        // an input already refused copies nothing: its copies would be left without owner for certain (T6-M2)
        if ($template !== null && $texts !== [] && $refused === []) {
            $copied = TemplateAttachments::copy($template, $texts, $actor->user);
            $texts = [];
            foreach ($copied as $key => $text) {
                // a text whose only picture vanished from the template is no text any more
                $text = $text === null || $text->isEmpty() ? null : $text;
                if (str_starts_with($key, 'values.')) {
                    $input['values'][substr($key, strlen('values.'))] = $text;
                } else {
                    $input['description'] = $text;
                }
                if ($text !== null) {
                    $texts[$key] = $text;
                }
            }
        }

        return ['project' => $project, 'input' => $input, 'refused' => $refused, 'texts' => $texts, 'template' => $template];
    }

    /**
     * The item, under the locks (in a transaction of its own, a savepoint inside a caller's one): what prepare() read
     * and copied before them. The template it is made from is read again, shared, after the project: one deleted
     * meanwhile is `field.template_id.unknown` with every other field error (the copies keep no owner, A337). The item
     * notes it (`template_id`) and its `work_item.created` names it as it is then (`meta.template` with `id` and `name`,
     * A352); `$meta` adds to the meta of that event.
     *
     * @param  array{input: array<array-key, mixed>, refused: array<string, list<string>>, texts: array<string, Document>, template: ?Template}  $prepared
     * @param  array<string, mixed>  $meta
     *
     * @throws ValidationException
     * @throws Problem
     */
    public static function insert(Actor $actor, Project $project, array $prepared, array $meta = []): WorkItem
    {
        ['input' => $input, 'refused' => $refused, 'texts' => $texts] = $prepared;

        return DB::transaction(function () use ($actor, $project, $input, $refused, $texts, $prepared, $meta): WorkItem {
            CatalogLock::share();
            $project = MemberInput::lock($project);

            if ($project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            $template = null;
            if ($prepared['template'] !== null) {
                $template = Template::query()->where('project_id', $project->id)->sharedLock()->find($prepared['template']->id);
                if ($template === null) {
                    $refused['template_id'] ??= [__('field.template_id.unknown')];
                }
            }

            $fields = ItemInput::create($input, $project, $actor->user, $refused);
            ItemInput::assertTwoLevels($fields['type'], $fields['parent']);

            $workflow = Workflow::query()->with(['states', 'transitions'])->findOrFail($project->workflow_id);
            $initial = $workflow->states->firstOrFail(fn (WorkflowState $state) => $state->id === $workflow->initial_state_id);
            $target = self::target($input['state_id'] ?? null, $workflow, $initial);

            $number = $project->next_number + 1;
            // the counter only, without touching the project's updated_at
            Project::query()->whereKey($project->id)->toBase()->update(['next_number' => $number]);
            $last = WorkItem::query()->where('project_id', $project->id)->max('rank');

            $now = new DateTimeImmutable;
            // a new item comes from nowhere into its initial state, as from the backlog
            $stamps = MoveStamps::after(StateCategory::Backlog, $initial->category, null, null, $now);
            $choices = Resolution::query()->get()->map(fn (Resolution $resolution) => new ResolutionChoice(
                $resolution->id,
                StateCategory::tryFrom((string) $resolution->default_for),
                $resolution->position,
                $resolution->archived_at !== null,
            ));

            $item = WorkItem::query()->create([
                'project_id' => $project->id,
                'number' => $number,
                'type_id' => $fields['type']->id,
                'title' => $fields['title'],
                'description' => $fields['description']?->toJson(),
                'description_text' => $fields['description']?->toText(),
                'description_version' => 1,
                'state_id' => $initial->id,
                'resolution_id' => ResolutionRule::after(StateCategory::Backlog, $initial->category, null, null, array_values($choices->all())),
                'assignee_id' => $fields['assignee_id'],
                'priority' => $fields['priority'],
                'start_date' => $fields['start_date'],
                'due_date' => $fields['due_date'],
                'parent_id' => $fields['parent']?->id,
                'template_id' => $template?->id,
                'rank' => Rank::between(is_string($last) ? $last : null, null),
                'created_by' => $actor->user->id,
                'started_at' => $stamps['started_at'],
                'closed_at' => $stamps['closed_at'],
            ]);
            $item->setRelation('project', $project);

            $item->labels()->sync($fields['label_ids']);
            ItemValues::store($item, $fields['values'], []);
            AttachmentLinks::link($item, $project, $actor->user, $texts);

            self::watch($item, $actor->user, 'created');
            if ($fields['assignee_id'] !== null && $fields['assignee_id'] !== $actor->user->id) {
                self::watch($item, User::query()->findOrFail($fields['assignee_id']), 'assigned');
            }
            $mentioned = Mentions::anew($item, [], $texts, $actor->user);

            $noted = $template === null ? [] : ['template' => ['id' => $template->id, 'name' => $template->name]];
            EventRecorder::record(EventType::WorkItemCreated, $actor, $item, $project, ['title' => ['old' => null, 'new' => $item->title]], [...Mentions::meta($mentioned), ...$noted, ...$meta]);
            UpdateWorkItem::announceBots($actor, $item, $mentioned);
            UpdateWorkItem::announceAssignedBot($actor, $item);

            // another state is a move from the initial one, after the creation: the history shows both (P32)
            if ($target->id !== $initial->id) {
                TransitionWorkItem::move($actor, $item, $target->id, null, checkTransition: false);
            }

            return $item;
        }, 3);
    }

    /**
     * The state the new item is to end up in: the initial state unless named. Another one must be a state of the
     * workflow (422 `state_id`) that the initial state may move to (409 `transition_not_allowed`), checked before the
     * item takes a number.
     *
     * @throws ValidationException
     * @throws Problem
     */
    private static function target(mixed $id, Workflow $workflow, WorkflowState $initial): WorkflowState
    {
        if ($id === null) {
            return $initial;
        }

        $id = is_string($id) && Str::isUlid($id) ? strtolower($id) : null;
        $target = $workflow->states->first(fn (WorkflowState $state) => $state->id === $id)
            ?? throw ValidationException::withMessages(['state_id' => __('field.state_id.unknown')]);

        if (! $workflow->graph()->canTransition($initial->id, $target->id)) {
            throw Problem::conflict('transition_not_allowed', [], __('problem.detail.transition_from_start', [
                'initial' => $initial->name, 'target' => $target->name, 'workflow' => $workflow->name,
            ]));
        }

        return $target;
    }

    /** People watch the items they created or were given; bots get no notifications and watch nothing. */
    private static function watch(WorkItem $item, User $user, string $reason): void
    {
        if ($user->isPerson()) {
            WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $user->id, 'reason' => $reason]);
        }
    }
}
