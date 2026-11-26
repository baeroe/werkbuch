<?php

namespace App\Domain\Workflow;

/**
 * A step of the flow of the agents that sets a state (spec 7.4): every workflow names the state of each, and every
 * project of the workflow uses them, for PRs of people too (spec 12). Each step takes states of its categories only.
 * Agents work in a project only when its workflow names all four.
 */
enum AgentStep: string
{
    case Working = 'working';
    case Review = 'review';
    case Correction = 'correction';
    case Merged = 'merged';
    /** Optional (WEBU-44, A772): where an item waits for its agent; without it an agent starts at once. */
    case Ready = 'ready';

    /** The steps the agents need in the order of the flow (the keys of `workflows.agent_states`); `ready` is optional. */
    public const KEYS = ['working', 'review', 'correction', 'merged'];

    /**
     * The categories a state of this step may have.
     *
     * @return list<StateCategory>
     */
    public function categories(): array
    {
        return match ($this) {
            self::Working, self::Review => [StateCategory::Started],
            self::Correction => [StateCategory::Backlog, StateCategory::Unstarted],
            self::Ready => [StateCategory::Unstarted],
            self::Merged => [StateCategory::Completed],
        };
    }

    /** The name of the step in a sentence, translated (fixed keys, so that the key scan finds them). */
    public function label(): string
    {
        return match ($this) {
            self::Working => __('catalog.agent_step.working'),
            self::Review => __('catalog.agent_step.review'),
            self::Correction => __('catalog.agent_step.correction'),
            self::Merged => __('catalog.agent_step.merged'),
            self::Ready => __('catalog.agent_step.ready'),
        };
    }

    /** The categories of the step in a sentence: `Backlog / Unstarted`. */
    public function categoriesLabel(): string
    {
        return implode(' / ', array_map(fn (StateCategory $category) => $category->label(), $this->categories()));
    }

    public function fits(StateCategory $category): bool
    {
        return in_array($category, $this->categories(), true);
    }

    /**
     * Stored steps as they are to be read: every step once, in order, a state id or null (anything else falls away).
     *
     * @return array{working: ?string, review: ?string, correction: ?string, merged: ?string, ready: ?string}
     */
    public static function read(mixed $stored): array
    {
        $steps = ['working' => null, 'review' => null, 'correction' => null, 'merged' => null, 'ready' => null];

        foreach (array_keys($steps) as $key) {
            $value = is_array($stored) ? ($stored[$key] ?? null) : null;
            $steps[$key] = is_string($value) ? $value : null;
        }

        return $steps;
    }

    /**
     * Whether every step the agents need names a state (`ready` is optional).
     *
     * @param  array<string, ?string>  $steps
     */
    public static function complete(array $steps): bool
    {
        $read = self::read($steps);

        return ! in_array(null, array_map(fn (string $key) => $read[$key], self::KEYS), true);
    }
}
