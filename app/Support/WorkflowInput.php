<?php

namespace App\Support;

use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\IssueCode;
use App\Domain\Workflow\State;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Domain\Workflow\TransitionGraph;
use App\Domain\Workflow\WorkflowIssue;
use App\Exceptions\Problem;
use App\Models\Workflow;
use App\Models\WorkflowState;
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

        foreach (['initial_state_id', 'transitions', 'state_mapping', 'agent_states'] as $field) {
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
     * @return array{name: string, description: string, is_default: bool, is_free: bool, initial_state_id: string, states: list<array{index: array-key, key: string, existing: ?string, name: string, icon: StateIcon, category: StateCategory}>, transitions: list<array{0: string, 1: string}>, state_mapping: array<array-key, mixed>, agent_states: ?array<array-key, mixed>}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?Workflow $existing): array
    {
        /** @var array{name: string, description?: ?string, is_default: bool|int|string, is_free: bool|int|string, initial_state_id: string, states: array<array-key, array{id?: ?string, name: string, icon: string, category: string}>, transitions: array<array-key, array{0: string, 1: string}>, state_mapping?: ?array<array-key, mixed>, agent_states?: ?array<array-key, mixed>} $valid */
        $valid = Validator::make($input, [
            'name' => CatalogInput::name('workflows', $existing),
            'description' => CatalogInput::description(),
            'is_default' => ['required', 'boolean'],
            'is_free' => ['required', 'boolean'],
            'initial_state_id' => ['required', 'string'],
            'states' => ['present', 'array', 'min:1', 'max:'.self::STATES_MAX],
            // `new:<index>` names a state sent without an id; no id of the client looks like one
            'states.*.id' => ['nullable', 'string', 'max:'.ClientKeys::MAX, 'doesnt_start_with:'.ClientKeys::PREFIX],
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
            'agent_states' => ['sometimes', 'nullable', 'array'],
        ], self::messages())->validate();

        $own = $existing?->states->modelKeys() ?? [];
        $states = [];
        $keys = [];
        $position = 0;

        // in the order they were sent: `validated()` puts a state without an id behind those with one
        foreach (array_keys($input['states']) as $index) {
            $state = $valid['states'][$index];
            $key = ClientKeys::keyOf($state, $position);

            // a sent id names one state only
            if (isset($keys[$key])) {
                throw ValidationException::withMessages(["states.{$index}.id" => __('field.states.duplicate_id')]);
            }

            $keys[$key] = true;
            $states[] = [
                'index' => $index,
                'key' => $key,
                'existing' => ClientKeys::resolve($own, [], $key),
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
            'agent_states' => $valid['agent_states'] ?? null,
        ];
    }

    /**
     * The state each step of the agents takes (spec 7.4), as a key of the input: steps sent are taken as sent (every
     * step left out of a sent object is empty); without `agent_states` (or `null`) the stored ones stay, a state that
     * goes hands its step to the state that takes over its items when that state fits the step, else the step is
     * empty. A step on a state of the wrong category is 422 at the step when it was sent, at the category of the state
     * when it was kept.
     *
     * @param  array{states: list<array{index: array-key, key: string, existing: ?string, category: StateCategory}>, state_mapping: array<array-key, mixed>, agent_states: ?array<array-key, mixed>}  $valid
     * @return array{working: ?string, review: ?string, correction: ?string, merged: ?string}
     *
     * @throws Problem 422 with the errors at their steps or states
     */
    public static function agentStates(array $valid, ?Workflow $current): array
    {
        $byKey = array_column($valid['states'], null, 'key');
        $byExisting = array_column(array_filter($valid['states'], fn (array $state) => $state['existing'] !== null), null, 'existing');
        $sent = $valid['agent_states'];
        $stored = AgentStep::read($current?->agent_states);
        $steps = AgentStep::read(null);
        $errors = [];

        foreach (array_keys($sent ?? []) as $name) {
            if (AgentStep::tryFrom((string) $name) === null) {
                $errors["agent_states.{$name}"] = [__('field.agent_states.step')];
            }
        }

        foreach (AgentStep::cases() as $step) {
            $refusal = __('field.agent_states.category', ['step' => $step->label(), 'categories' => $step->categoriesLabel()]);

            if ($sent !== null) {
                $key = $sent[$step->value] ?? null;
                $state = is_string($key) ? ($byKey[$key] ?? null) : null;

                if ($key !== null && $state === null) {
                    $errors["agent_states.{$step->value}"] = [__('field.agent_states.unknown')];
                } elseif ($state !== null && ! $step->fits($state['category'])) {
                    $errors["agent_states.{$step->value}"] = [$refusal];
                } else {
                    $steps[$step->value] = $state['key'] ?? null;
                }
            } elseif (isset($byExisting[$stored[$step->value]])) {
                // a state that stays keeps its step; a new category must still fit it
                $state = $byExisting[$stored[$step->value]];

                if ($step->fits($state['category'])) {
                    $steps[$step->value] = $state['key'];
                } else {
                    $errors["states.{$state['index']}.category"] = [__('field.states.agent_step', ['step' => $step->label(), 'categories' => $step->categoriesLabel()])];
                }
            } else {
                // a state that goes: its step follows the state that takes over its items, when that fits
                $target = $stored[$step->value] === null ? null : ($valid['state_mapping'][$stored[$step->value]] ?? null);
                $state = is_string($target) ? ($byKey[$target] ?? null) : null;
                $steps[$step->value] = $state !== null && $step->fits($state['category']) ? $state['key'] : null;
            }
        }

        if ($errors !== []) {
            throw Problem::invalid($errors);
        }

        return $steps;
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
     * of `$from`, every value one of `$to`. The errors stand at `<field>.<id>`; a key among `$staying` (a state of the
     * workflow that stays) is told so instead of "unknown".
     *
     * @param  array<array-key, mixed>  $mapping
     * @param  list<string>  $from
     * @param  list<string>  $to
     * @param  list<string>  $staying
     * @return array<string, list<string>>
     */
    public static function mappingErrors(string $field, array $mapping, array $from, array $to, array $staying = []): array
    {
        $errors = [];

        foreach ($mapping as $id => $target) {
            if (in_array((string) $id, $staying, true)) {
                $errors["{$field}.{$id}"] = [__('field.state_mapping.stays')];
            } elseif (! in_array((string) $id, $from, true)) {
                $errors["{$field}.{$id}"] = [__('field.mapping.unknown_state')];
            } elseif (! in_array($target, $to, true)) {
                $errors["{$field}.{$id}"] = [__('field.mapping.target')];
            }
        }

        return $errors;
    }

    /**
     * The states that hold items and have no target in the mapping (the mapping passed mappingErrors), in the order
     * given: what a 422 at `mapping.<id>` (AssignWorkflow) and a 409 `state_in_use` (SaveWorkflow) name, with the number
     * of their items.
     *
     * @param  array<array-key, mixed>  $mapping
     * @param  iterable<WorkflowState>  $states  the states that go
     * @param  array<string, int>  $counts  items per state id (ListStateUsage::counts)
     * @return list<array{state_id: string, name: string, items: int}>
     */
    public static function unmapped(array $mapping, iterable $states, array $counts): array
    {
        $unmapped = [];

        foreach ($states as $state) {
            if (($counts[$state->id] ?? 0) > 0 && ! array_key_exists($state->id, $mapping)) {
                $unmapped[] = ['state_id' => $state->id, 'name' => $state->name, 'items' => $counts[$state->id]];
            }
        }

        return $unmapped;
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
            'states.*.id.string' => __('field.states.id_invalid', ['max' => ClientKeys::MAX]),
            'states.*.id.max' => __('field.states.id_invalid', ['max' => ClientKeys::MAX]),
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
            'agent_states.array' => __('field.agent_states.invalid'),
        ];
    }
}
