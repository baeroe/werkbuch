<?php

namespace App\Support;

use App\Domain\Workflow\IssueCode;
use App\Domain\Workflow\State;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Domain\Workflow\TransitionGraph;
use App\Domain\Workflow\WorkflowIssue;
use App\Exceptions\Problem;
use App\Models\Workflow;
use Closure;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The rules, field messages (P9) and the shape of a workflow as a client sends it (spec 4.5, `saveWorkflow` of the
 * clickdummy): name, description, the default mark, free or a matrix, the start state, the states in order and the
 * transitions. New states come with ids of the client (P3); only the states of the workflow itself keep their ULID, any
 * other id (also the ULID of a state of another workflow) is a new state. Writes nothing.
 */
final class WorkflowInput
{
    public const NAME_MAX = CatalogInput::NAME_MAX;

    public const STATE_NAME_MAX = 40;

    public const DESCRIPTION_MAX = CatalogInput::DESCRIPTION_MAX;

    public const STATES_MAX = 30;

    /** The longest id a client may give a state. */
    public const KEY_MAX = 64;

    /** The start of the key of a state sent without an id (`new:<index>`); sent ids never start with it. */
    public const NEW_KEY = 'new:';

    /**
     * The input with its texts trimmed and every ULID in lower case (local ids stay as they came).
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function normalize(array $input): array
    {
        $input = CatalogInput::trim($input, ['name', 'description']);

        if (is_array($input['states'] ?? null)) {
            foreach ($input['states'] as $index => $state) {
                if (is_array($state)) {
                    $input['states'][$index] = CatalogInput::trim($state, ['name']);

                    if (array_key_exists('id', $state)) {
                        $input['states'][$index]['id'] = Ids::normalize($state['id']);
                    }
                }
            }
        }

        foreach (['initial_state_id', 'transitions', 'state_mapping'] as $field) {
            if (array_key_exists($field, $input)) {
                $input[$field] = Ids::normalize($input[$field]);
            }
        }

        return $input;
    }

    /**
     * The workflow as it is to be saved. Every state gets a `key`: the id it was sent with, `new:<index>` without one;
     * `existing` is that id when it is a state of `$existing`, else `null` (a new row). Transitions between unknown keys
     * or from a state to itself fall away, pairs sent twice count once (like the clickdummy). Whether the workflow can
     * be saved (start state, Completed, reachability) is the graph's question, not this one's.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{name: string, description: string, is_default: bool, is_free: bool, initial_state_id: string, states: list<array{key: string, existing: ?string, name: string, icon: StateIcon, category: StateCategory}>, transitions: list<array{0: string, 1: string}>, state_mapping: array<array-key, mixed>}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?Workflow $existing): array
    {
        /** @var array{name: string, description?: ?string, is_default: bool|int|string, is_free: bool|int|string, initial_state_id: string, states: array<array-key, array{id?: ?string, name: string, icon: string, category: string}>, transitions: array<array-key, array{0: string, 1: string}>, state_mapping?: ?array<array-key, mixed>} $valid */
        $valid = Validator::make($input, [
            'name' => CatalogInput::name('workflows', $existing),
            'description' => CatalogInput::description(),
            'is_default' => ['required', 'boolean'],
            'is_free' => ['required', 'boolean'],
            'initial_state_id' => ['required', 'string'],
            'states' => ['present', 'array', 'min:1', 'max:'.self::STATES_MAX],
            // `new:<index>` names a state sent without an id; no id of the client looks like one
            'states.*.id' => ['nullable', 'string', 'max:'.self::KEY_MAX, 'doesnt_start_with:'.self::NEW_KEY],
            'states.*.name' => ['required', 'string', 'max:'.self::STATE_NAME_MAX],
            'states.*.icon' => ['required', Rule::enum(StateIcon::class)],
            'states.*.category' => ['required', Rule::enum(StateCategory::class)],
            'transitions' => ['present', 'array'],
            'transitions.*' => [
                'required',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! is_array($value) || ! array_is_list($value) || count($value) !== 2 || ! is_string($value[0]) || ! is_string($value[1])) {
                        $fail(__('field.transitions.invalid'));
                    }
                },
            ],
            'state_mapping' => ['sometimes', 'nullable', 'array'],
        ], self::messages())->validate();

        $own = $existing?->states->modelKeys() ?? [];
        $states = [];
        $keys = [];
        $position = 0;

        // in the order they were sent: `validated()` puts a state without an id behind those with one
        foreach (array_keys($input['states']) as $index) {
            $state = $valid['states'][$index];
            $key = $state['id'] ?? self::NEW_KEY.$position;

            // a sent id names one state only
            if (isset($keys[$key])) {
                throw ValidationException::withMessages(["states.{$index}.id" => __('field.states.duplicate_id')]);
            }

            $keys[$key] = true;
            $states[] = [
                'key' => $key,
                'existing' => in_array($key, $own, true) ? $key : null,
                'name' => $state['name'],
                'icon' => StateIcon::from($state['icon']),
                'category' => StateCategory::from($state['category']),
            ];
            $position++;
        }

        $transitions = [];

        foreach ($valid['transitions'] as [$from, $to]) {
            if ($from !== $to && isset($keys[$from], $keys[$to])) {
                $transitions[$from."\n".$to] = [$from, $to];
            }
        }

        return [
            'name' => $valid['name'],
            'description' => $valid['description'] ?? '',
            'is_default' => (bool) $valid['is_default'],
            'is_free' => (bool) $valid['is_free'],
            'initial_state_id' => $valid['initial_state_id'],
            'states' => $states,
            'transitions' => array_values($transitions),
            'state_mapping' => $valid['state_mapping'] ?? [],
        ];
    }

    /**
     * The rules of the workflow as it is to be saved, with the keys of the input as state ids and the order as position.
     *
     * @param  array{is_free: bool, initial_state_id: string, states: list<array{key: string, name: string, icon: StateIcon, category: StateCategory}>, transitions: list<array{0: string, 1: string}>}  $valid
     */
    public static function graph(array $valid): TransitionGraph
    {
        $states = array_map(
            fn (array $state, int $position) => new State($state['key'], $state['name'], $state['icon'], $state['category'], $position),
            $valid['states'],
            array_keys($valid['states']),
        );

        return new TransitionGraph($states, $valid['transitions'], $valid['is_free'], $valid['initial_state_id']);
    }

    /**
     * Refuses a workflow that cannot be saved (P22): 422 `invalid_workflow`, a sentence per finding under its code, and
     * the findings with the ids of the input, so the client finds the row.
     *
     * @param  list<WorkflowIssue>  $issues
     * @param  array{states: list<array{key: string, name: string}>}  $valid
     *
     * @throws Problem
     */
    public static function refuse(array $issues, array $valid): never
    {
        $names = array_column($valid['states'], 'name', 'key');
        $errors = [];

        foreach ($issues as $issue) {
            $errors[$issue->code->value][] = match ($issue->code) {
                IssueCode::NoInitialState => __('field.workflow.no_initial_state'),
                IssueCode::NoCompletedState => __('field.workflow.no_completed_state'),
                IssueCode::UnreachableState => __('field.workflow.unreachable_state', ['name' => $names[(string) $issue->stateId]]),
            };
        }

        throw Problem::unprocessable(
            'invalid_workflow',
            $errors,
            ['issues' => array_map(fn (WorkflowIssue $issue) => $issue->toArray(), $issues)],
            __('problem.detail.invalid_workflow'),
        );
    }

    /**
     * What is wrong with a mapping of states (state id → the state that takes over its items): every key must be one
     * of `$from`, every value one of `$to`. The errors stand at `<field>.<id>`.
     *
     * @param  array<array-key, mixed>  $mapping
     * @param  list<string>  $from
     * @param  list<string>  $to
     * @return array<string, list<string>>
     */
    public static function mappingErrors(string $field, array $mapping, array $from, array $to): array
    {
        $errors = [];

        foreach ($mapping as $id => $target) {
            if (! in_array((string) $id, $from, true)) {
                $errors["{$field}.{$id}"] = [__('field.mapping.unknown_state')];
            } elseif (! in_array($target, $to, true)) {
                $errors["{$field}.{$id}"] = [__('field.mapping.target')];
            }
        }

        return $errors;
    }

    /**
     * @return array<string, string>
     */
    private static function messages(): array
    {
        return [
            ...CatalogInput::messages(),
            ...CatalogInput::required(['is_default', 'is_free', 'initial_state_id', 'states', 'transitions']),
            'is_default.boolean' => __('field.boolean'),
            'is_free.boolean' => __('field.boolean'),
            'initial_state_id.string' => __('field.workflow.no_initial_state'),
            'states.array' => __('field.states.required'),
            'states.min' => __('field.states.required'),
            'states.max' => __('field.states.max'),
            // the string rule fills no :max, so the sentence comes filled
            'states.*.id.string' => __('field.states.id_invalid', ['max' => self::KEY_MAX]),
            'states.*.id.max' => __('field.states.id_invalid', ['max' => self::KEY_MAX]),
            'states.*.id.doesnt_start_with' => __('field.states.id_reserved'),
            'states.*.name.required' => __('field.states.name_required'),
            'states.*.name.string' => __('field.states.name_required'),
            'states.*.name.max' => __('field.states.name_max'),
            'states.*.icon.required' => __('field.states.icon'),
            'states.*.icon.enum' => __('field.states.icon'),
            'states.*.category.required' => __('field.states.category'),
            'states.*.category.enum' => __('field.states.category'),
            'transitions.array' => __('field.transitions.invalid'),
            'transitions.*.required' => __('field.transitions.invalid'),
            'state_mapping.array' => __('field.state_mapping.invalid'),
        ];
    }
}
