<?php

namespace App\Domain\Agents;

/**
 * A model as a label or a project names it (spec 7.7): the CLI and one of its models, `cli:model` (`claude:haiku`).
 */
final readonly class AgentModel
{
    public function __construct(public AgentCli $cli, public string $model) {}

    /** A model a CLI knows, null for anything else. */
    public static function parse(mixed $value): ?self
    {
        if (! is_string($value) || substr_count($value, ':') !== 1) {
            return null;
        }

        [$cli, $model] = explode(':', $value);
        $known = AgentCli::tryFrom($cli);

        return $known !== null && $known->knows($model) ? new self($known, $model) : null;
    }

    /**
     * Every value there is, CLI by CLI in the order of their models.
     *
     * @return list<string>
     */
    public static function values(): array
    {
        $values = [];
        foreach (AgentCli::cases() as $cli) {
            foreach ($cli->models() as $model) {
                $values[] = "{$cli->value}:{$model}";
            }
        }

        return $values;
    }

    public function value(): string
    {
        return "{$this->cli->value}:{$this->model}";
    }
}
