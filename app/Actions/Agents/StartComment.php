<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A person asked an agent in a comment (spec 7.1): a `comment` run that only reads and whose answer werkbuch posts as a
 * comment of the bot; never a change of code. At an open strand of the bot it continues its session (and its runner).
 */
final class StartComment
{
    use AsAction;

    public function handle(Actor $actor, WorkItem $item, User $bot, Comment $comment): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $item, $bot, $comment): ?AgentRun {
            if (AgentFlow::refusal($bot, $item->project) !== null) {
                return null;
            }

            $thread = AgentThread::query()->where('work_item_id', $item->id)->where('bot_id', $bot->id)->where('status', AgentThread::OPEN)->orderByDesc('id')->first();

            return EnqueueRun::run($actor, $bot, $item->project, $item, RunType::Comment->value, $thread, [
                'comment_id' => $comment->id, 'author' => $comment->author->name, 'question' => $comment->body_text,
            ]);
        }, 3);
    }
}
