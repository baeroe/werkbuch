<?php

namespace App\Actions\Agents;

use App\Access\Permission;
use App\Access\Visibility;
use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\Comments\AddComment;
use App\Domain\Agents\RunType;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
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
                self::explain($item, $comment, $bot);

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
     * each bot of the comment that is set up as an agent of the runner but works here as none, with the reason and who
     * changes it with a link to the settings; in the language of the organization. A bot without an agent config gets
     * no note: it may wake by a webhook (A364). Under the lock of the item the reasons are read again, the comment row
     * is locked and a note for it is looked up with a locking read (`refused_comment_id`, unique): once for each
     * comment, also when two deliveries meet. The note is an ordinary `comment.created` of the default bot (watchers
     * hear it); it sets off nothing (FollowEvent leaves bots alone). An archived item or project gets no note.
     */
    private static function explain(WorkItem $item, Comment $comment, User $bot): void
    {
        try {
            $locked = ItemLock::take($item);
        } catch (Problem) {
            return;
        }

        $project = $locked->project;
        if ($locked->archived_at !== null || $project->archived_at !== null || Comment::query()->lockForUpdate()->find($comment->id) === null
            || Comment::query()->where('refused_comment_id', $comment->id)->lockForUpdate()->first() !== null) {
            return;
        }

        $refusal = self::refusalToNote($bot, $project);
        if ($refusal === null) {
            return;
        }

        // the bot of the event first, then every other bot the comment mentions that is refused the same way
        $ids = Document::fromJson($comment->body)->mentionedUserIds();
        $others = User::query()->whereIn('id', $ids)->where('type', 'bot')->whereKeyNot($bot->id)->get()
            ->sortBy(fn (User $other) => array_search($other->id, $ids, true));
        $paragraphs = [self::paragraph($bot, $refusal, $project->identifier)];
        foreach ($others as $other) {
            $why = self::refusalToNote($other, $project);
            if ($why !== null) {
                $paragraphs[] = self::paragraph($other, $why, $project->identifier);
            }
        }

        $note = AddComment::run(Actor::agent(User::defaultBot()), $locked, ['body_json' => ['type' => 'doc', 'content' => $paragraphs]]);

        // the marker only (the note keeps its own stamps)
        Comment::query()->whereKey($note->id)->toBase()->update(['refused_comment_id' => $comment->id]);
    }

    /**
     * Why werkbuch refuses a mention of a bot set up as an agent of the runner (an agent config, switched on or off);
     * null for an agent that works here and for a bot that never was one (A711). The default bot never has a config.
     */
    private static function refusalToNote(User $bot, Project $project): ?string
    {
        return AgentConfig::query()->where('bot_id', $bot->id)->exists() ? AgentFlow::refusal($bot, $project, steps: false) : null;
    }

    /**
     * One paragraph of the note: the bot answers not, why, who changes it and where (the refusals of a bot with an agent
     * config: switched off, deactivated, no responsible person, no member that may edit). Tiptap JSON, never Markdown: the
     * name of a bot is no text to read for mentions or keys.
     *
     * @return array{type: string, content: list<array<string, mixed>>}
     */
    private static function paragraph(User $bot, string $refusal, string $project): array
    {
        $locale = AgentFlow::locale();
        $words = ['bot' => $bot->name, 'project' => $project];
        $reason = match ($refusal) {
            'agent_off' => __('items.agents.refusal.agent_off', $words, $locale),
            'disabled' => __('items.agents.refusal.disabled', $words, $locale),
            'no_owner' => __('items.agents.refusal.no_owner', $words, $locale),
            default => __('items.agents.refusal.not_member', $words, $locale),
        };
        $base = rtrim((string) config('app.url'), '/');
        [$who, $label, $path] = match ($refusal) {
            'agent_off', 'no_owner' => [__('agents.mention.fix.org_admin', [], $locale), __('items.agents.refusal.fix_bot', $words, $locale), '/settings/bots?agent='.$bot->id],
            'disabled' => [__('agents.mention.fix.org_admin', [], $locale), __('items.agents.refusal.fix_disabled', [], $locale), '/settings/bots'],
            default => [__('agents.mention.fix.project_admin', [], $locale), __('items.agents.refusal.fix_members', $words, $locale), '/projects/'.rawurlencode($project).'/settings/members'],
        };

        return ['type' => 'paragraph', 'content' => [
            ['type' => 'text', 'text' => __('agents.mention.refused', $words, $locale).' '.$reason.' '.$who.' '],
            ['type' => 'text', 'text' => $label, 'marks' => [['type' => 'link', 'attrs' => ['href' => $base.$path]]]],
        ]];
    }
}
