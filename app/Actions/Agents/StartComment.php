<?php

namespace App\Actions\Agents;

use App\Access\Permission;
use App\Access\Visibility;
use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\Comments\AddComment;
use App\Domain\Agents\RunType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A person asked an agent in a comment (spec 7.1): a `comment` run that only reads and whose answer werkbuch posts as a
 * comment of the bot; never a change of code. Only an author who may edit items of the project sets it off (A603). At
 * an open strand of the bot it continues its session (and its runner). An answer moves no item: the workflow needs no
 * step of the agents (A710). When werkbuch refuses the mention (the bot is no agent here), the default bot says why at
 * the item and who changes that, once for each comment (A711).
 */
final class StartComment
{
    use AsAction;

    public function handle(Actor $actor, WorkItem $item, User $bot, Comment $comment): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $item, $bot, $comment): ?AgentRun {
            // only who may edit items of the project sets an agent to work (A603): a reader of a public project asks nobody
            if (! Visibility::can($comment->author, Permission::ItemEdit, $item->project)) {
                return null;
            }

            $refusal = AgentFlow::refusal($bot, $item->project, steps: false);
            if ($refusal !== null) {
                self::explain($item, $comment, $bot, $refusal);

                return null;
            }

            $thread = AgentThread::query()->where('work_item_id', $item->id)->where('bot_id', $bot->id)->where('status', AgentThread::OPEN)->orderByDesc('id')->first();

            return EnqueueRun::run($actor, $bot, $item->project, $item, RunType::Comment->value, $thread, [
                'comment_id' => $comment->id, 'author' => $comment->author->name, 'question' => $comment->body_text,
            ]);
        }, 3);
    }

    /**
     * The note of the default bot at the item for a comment whose mentions werkbuch refused (A711): one paragraph for
     * each bot of the comment that works here as no agent, with the reason and, where one exists, who changes it with a
     * link to the settings; in the language of the organization. Once for each comment: under the lock of the item the
     * comment row is locked and a note for it looks up (`refused_comment_id`, unique). A comment of the default bot sets
     * off nothing (FollowEvent leaves bots alone). An archived item or project gets no note (nobody can comment there).
     */
    private static function explain(WorkItem $item, Comment $comment, User $bot, string $refusal): void
    {
        try {
            $locked = ItemLock::take($item);
        } catch (Problem) {
            return;
        }

        $project = $locked->project;
        if ($locked->archived_at !== null || $project->archived_at !== null || Comment::query()->lockForUpdate()->find($comment->id) === null
            || Comment::query()->where('refused_comment_id', $comment->id)->exists()) {
            return;
        }

        // the bot of the event first, then every other bot the comment mentions that works here as no agent either
        $ids = Document::fromJson($comment->body)->mentionedUserIds();
        $others = User::query()->whereIn('id', $ids)->where('type', 'bot')->whereKeyNot($bot->id)->get()
            ->sortBy(fn (User $other) => array_search($other->id, $ids, true));
        $paragraphs = [self::paragraph($bot, $refusal, $project->identifier)];
        foreach ($others as $other) {
            $why = AgentFlow::refusal($other, $project, steps: false);
            if ($why !== null) {
                $paragraphs[] = self::paragraph($other, $why, $project->identifier);
            }
        }

        $note = AddComment::run(Actor::agent(User::defaultBot()), $locked, ['body_json' => ['type' => 'doc', 'content' => $paragraphs]]);

        // the marker only (the note keeps its own stamps)
        Comment::query()->whereKey($note->id)->toBase()->update(['refused_comment_id' => $comment->id]);
    }

    /**
     * One paragraph of the note: the bot answers not, why, and who changes it where (Tiptap JSON, never Markdown: the
     * name of a bot is no text to read for mentions or keys).
     *
     * @return array{type: string, content: list<array<string, mixed>>}
     */
    private static function paragraph(User $bot, string $refusal, string $project): array
    {
        $locale = AgentFlow::locale();
        $words = ['bot' => $bot->name, 'project' => $project];
        $reason = match ($refusal) {
            'agent_off' => __('items.agents.refusal.agent_off', $words, $locale),
            'default_bot' => __('items.agents.refusal.default_bot', $words, $locale),
            'disabled' => __('items.agents.refusal.disabled', $words, $locale),
            'no_owner' => __('items.agents.refusal.no_owner', $words, $locale),
            default => __('items.agents.refusal.not_member', $words, $locale),
        };
        $base = rtrim((string) config('app.url'), '/');
        [$who, $label, $path] = match ($refusal) {
            'agent_off', 'no_owner' => [__('agents.mention.fix.org_admin', [], $locale), __('items.agents.refusal.fix_bot', $words, $locale), '/settings/bots?agent='.$bot->id],
            'disabled' => [__('agents.mention.fix.org_admin', [], $locale), __('items.agents.refusal.fix_disabled', [], $locale), '/settings/bots'],
            'default_bot' => [__('agents.mention.fix.default_bot', [], $locale), null, null],
            default => [__('agents.mention.fix.project_admin', [], $locale), __('items.agents.refusal.fix_members', $words, $locale), '/projects/'.rawurlencode($project).'/settings/members'],
        };

        $content = [['type' => 'text', 'text' => __('agents.mention.refused', $words, $locale).' '.$reason.' '.$who]];
        if ($label !== null) {
            $content[0]['text'] .= ' ';
            $content[] = ['type' => 'text', 'text' => $label, 'marks' => [['type' => 'link', 'attrs' => ['href' => $base.$path]]]];
        }

        return ['type' => 'paragraph', 'content' => $content];
    }
}
