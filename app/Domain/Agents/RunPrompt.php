<?php

namespace App\Domain\Agents;

/**
 * The prompts of a run from their layers (spec 7.3), in this order: the contract (fixed), the working rules of the
 * organization for the kind, the guidance of the type of the item, the text of the project for agents, then the job.
 * The first four are the system prompt, the job is the prompt; the CLI reads the rules of the repository on its own.
 * There is no instruction per bot. An empty layer leaves its heading out.
 */
final class RunPrompt
{
    /**
     * @return array{system_prompt: string, prompt: string}
     */
    public static function build(string $contract, string $rules, ?string $guidance, ?string $project, string $job): array
    {
        $layers = [
            '# Contract' => $contract,
            '# Working rules of the organization' => $rules,
            '# How to work on items of this type' => $guidance,
            '# The project' => $project,
        ];

        $parts = [];
        foreach ($layers as $heading => $text) {
            $text = trim((string) $text);
            if ($text !== '') {
                $parts[] = "{$heading}\n\n{$text}";
            }
        }

        return ['system_prompt' => implode("\n\n", $parts), 'prompt' => trim($job)];
    }

    /**
     * Data for the prompt (texts of people, logs): fenced so that it reads as quoted, never as an instruction. A fence
     * longer than any run of backticks in the text keeps it closed.
     */
    public static function quote(string $text): string
    {
        preg_match_all('/`+/', $text, $runs);
        $longest = max([0, ...array_map('strlen', $runs[0])]);
        $fence = str_repeat('`', max(3, $longest + 1));

        return "{$fence}text\n".rtrim($text)."\n{$fence}";
    }
}
