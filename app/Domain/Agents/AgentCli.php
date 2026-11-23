<?php

namespace App\Domain\Agents;

/**
 * The CLIs an agent runs with (spec 8.1) and their models (spec 7.7): a fixed list per CLI, kept here and widened with
 * releases, never free names.
 */
enum AgentCli: string
{
    case Claude = 'claude';
    case Codex = 'codex';

    public const VALUES = ['claude', 'codex'];

    /**
     * @return list<string>
     */
    public function models(): array
    {
        return match ($this) {
            self::Claude => ['haiku', 'sonnet', 'opus', 'fable'],
            self::Codex => ['gpt-5-codex', 'gpt-5-codex-mini'],
        };
    }

    /** The model a new agent starts with, and what a change of CLI falls back to. */
    public function defaultModel(): string
    {
        return match ($this) {
            self::Claude => 'sonnet',
            self::Codex => 'gpt-5-codex',
        };
    }

    public function knows(string $model): bool
    {
        return in_array($model, $this->models(), true);
    }
}
