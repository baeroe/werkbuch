<?php

namespace App\Support;

use App\Domain\Agents\Contract;
use App\Domain\Agents\RunPrompt;
use App\Domain\Agents\RunType;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\WorkItem;

/**
 * Builds the prompts of a run when a runner takes it (spec 6.3, 7.3): the system prompt from the layers (the contract,
 * the rules of the organization for the kind, the guidance of the type of the item, the text of the project) and the
 * job of the run from what the flow kept in its context (findings, the comment, the PR). Read fresh at the claim: a
 * change of the rules reaches runs that wait. Texts of people (findings, comments, titles) go in as quoted data.
 */
final class RunPrompts
{
    /**
     * @return array{system_prompt: string, prompt: string}
     */
    public static function for(AgentRun $run): array
    {
        $item = $run->workItem;
        $settings = AgentProjectSettings::of($run->project_id);

        return RunPrompt::build(
            Contract::for($run->type),
            AgentRules::text($run->type),
            $item?->type->agent_guidance,
            $settings->instructions,
            self::job($run, $item),
        );
    }

    private static function job(AgentRun $run, ?WorkItem $item): string
    {
        $thread = $run->thread;
        $subject = $item === null ? 'no item' : "the item {$item->key} ".self::title($item);
        $project = $run->project->identifier;
        $context = $run->context;
        $say = fn (string $key, string $otherwise) => is_string($context[$key] ?? null) ? $context[$key] : $otherwise;

        return match ($run->type) {
            RunType::Task => "Run `task` for {$subject} of the project {$project}.\n\n".self::where($thread).self::epic($thread, $item),
            RunType::Correction => "Run `correction` for {$subject} of the project {$project}.\n\n".self::where($thread)
                ."Findings to work through (from {$say('source', 'werkbuch')}):\n\n".RunPrompt::quote($say('findings', 'Look at the item and the pull request again.')),
            RunType::Conflict => "Run `conflict` for {$subject} of the project {$project}.\n\n".self::where($thread)
                ."The pull request has conflicts with its base branch `{$thread?->base_branch}`: merge it into your branch, resolve them and push.",
            RunType::Review => "Run `review` of the pull request #{$run->pr_number} of `{$say('repository', 'the repository')}` at the commit `{$run->head_sha}` (base branch `{$say('base_branch', $thread?->base_branch ?? 'main')}`).\n\n"
                .($item === null ? 'It names no item of the project.' : "Its item is {$item->key} ".self::title($item).'; read it with `werkbuch-run`.')
                ."\n\nRead the pull request with `gh pr view {$run->pr_number}` and `gh pr diff {$run->pr_number}` in the worktree you are given (checked out at that commit).",
            RunType::Comment => "Run `comment` at {$subject} of the project {$project}.\n\n{$say('author', 'Someone')} asked you in a comment:\n\n"
                .RunPrompt::quote($say('question', ''))."\n\nAnswer the question. werkbuch posts your answer as your comment at the item.",
        };
    }

    /** Where a code run works: its branch, the PR when there is one, or no repo at all. */
    private static function where(?AgentThread $thread): string
    {
        if ($thread === null || $thread->repository_github_id === null) {
            return "This project has no repository: work in the folder you are given; there is no pull request. Your summary becomes a comment at the item.\n\n";
        }

        $pr = $thread->pr_number === null ? 'There is no pull request yet.' : "The pull request is #{$thread->pr_number}.";

        return "Work on the branch `{$thread->branch}` (from the base branch `{$thread->base_branch}`). {$pr}\n\n";
    }

    /** An epic worked child by child on one branch (spec 7.6, rule A). */
    private static function epic(?AgentThread $thread, ?WorkItem $item): string
    {
        $epic = $thread?->work_item_id === null || $thread->work_item_id === $item?->id ? null : WorkItem::query()->find($thread->work_item_id);
        if ($epic === null || $item === null) {
            return '';
        }

        $children = WorkItem::query()->with('state')->where('parent_id', $epic->id)->orderBy('rank')->orderBy('id')->get()
            ->map(fn (WorkItem $child) => "- {$child->key} ".self::title($child)." ({$child->state->name})")->implode("\n");
        $draft = $thread->pr_number === null
            ? 'Once this child is done, open a draft pull request for the epic into the base branch, its body with `Fixes '.$epic->key.'`.'
            : 'Push to the draft pull request of the epic; werkbuch marks it ready when every child is done.';

        return "This item is a child of the epic {$epic->key} ".self::title($epic).', which you work through child by child on its branch. '
            ."Work only on {$item->key} now; you may use a branch of your own for it that you merge into the branch of the epic locally, but push only the branch of the epic. {$draft}\n\nThe children of the epic:\n\n{$children}";
    }

    private static function title(WorkItem $item): string
    {
        return '„'.str_replace(["\n", "\r"], ' ', $item->title).'“';
    }
}
