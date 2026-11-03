<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\RemoveReaction;
use App\Actions\WorkItems\ListHistory;
use App\Events\EventType;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Validation\ValidationException;

/*
 * Reactions to comments (Task 10, K16): one emoji per person and comment, compared byte by byte (P14). WEB (public)
 * with Mara as its admin, Jonas as a member and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    $comment = AddComment::run(actor($mara), $item, ['body' => 'Text.']);

    return compact('mara', 'web', 'jonas', 'lene', 'item', 'comment');
};

$add = fn (User $user, Comment $comment, string $emoji): Comment => AddReaction::run(actor($user), $comment, ['emoji' => $emoji]);
$remove = fn (User $user, Comment $comment, string $emoji): Comment => RemoveReaction::run(actor($user), $comment, ['emoji' => $emoji]);

it('adds a reaction once per person and emoji', function () use ($world, $add) {
    $w = $world();

    $first = $add($w['jonas'], $w['comment'], '👍');
    $again = $add($w['jonas'], $w['comment'], '👍');

    expect(CommentReaction::query()->count())->toBe(1)
        ->and(eventsOf(EventType::CommentReactionAdded, $w['item']))->toHaveCount(1)
        ->and($first->reactions)->toHaveCount(1)->and($again->reactions)->toHaveCount(1);
    $event = eventsOf(EventType::CommentReactionAdded, $w['item'])->sole();
    expect($event->meta)->toMatchArray(['comment_id' => $w['comment']->id, 'emoji' => '👍'])
        ->and($event->actor_id)->toBe($w['jonas']->id);
});

it('adds reactions of three people to one comment', function () use ($world, $add) {
    $w = $world();

    $add($w['mara'], $w['comment'], '🎉');
    $add($w['jonas'], $w['comment'], '🎉');
    $add($w['lene'], $w['comment'], '🎉');

    expect(CommentReaction::query()->count())->toBe(3)
        ->and(CommentReaction::query()->pluck('id')->filter()->unique())->toHaveCount(3)
        ->and(eventsOf(EventType::CommentReactionAdded, $w['item']))->toHaveCount(3);
});

it('removes only the own reaction', function () use ($world, $add, $remove) {
    $w = $world();
    $add($w['jonas'], $w['comment'], '👍');
    $add($w['lene'], $w['comment'], '👍');

    $result = $remove($w['jonas'], $w['comment'], '👍');
    $remove($w['jonas'], $w['comment'], '👍');

    expect(CommentReaction::query()->sole()->user_id)->toBe($w['lene']->id)
        ->and($result->reactions)->toHaveCount(1)
        ->and(eventsOf(EventType::CommentReactionRemoved, $w['item']))->toHaveCount(1)
        ->and(eventsOf(EventType::CommentReactionRemoved, $w['item'])->sole()->meta)->toMatchArray(['comment_id' => $w['comment']->id, 'emoji' => '👍']);
});

it('keeps 👍 and 👍🏽 apart', function () use ($world, $add) {
    $w = $world();

    $add($w['jonas'], $w['comment'], '👍');
    $add($w['jonas'], $w['comment'], '👍🏽');

    expect(CommentReaction::query()->pluck('emoji')->all())->toEqualCanonicalizing(['👍', '👍🏽']);
});

it('refuses text as emoji with 422', function (mixed $emoji) use ($world) {
    $w = $world();

    foreach ([AddReaction::class, RemoveReaction::class] as $action) {
        try {
            $action::run(actor($w['jonas']), $w['comment'], ['emoji' => $emoji]);
            $this->fail('expected a 422');
        } catch (ValidationException $e) {
            expect($e->errors()['emoji'])->toBe([__('field.emoji.invalid')]);
        }
    }
    expect(CommentReaction::query()->count())->toBe(0);
})->with(['text' => 'ok', 'two' => '👍👍', 'empty' => '', 'null' => null, 'list' => [['👍']], 'number' => 5]);

it('lets a viewer react', function () use ($world, $add) {
    $w = $world();

    $add($w['lene'], $w['comment'], '❤️');

    expect(CommentReaction::query()->sole()->user_id)->toBe($w['lene']->id);
});

it('answers 404 for a comment of an item the account does not see', function () use ($world) {
    $w = $world();
    $w['web']->update(['visibility' => 'private']);
    $stranger = User::factory()->create();

    $problem = problemOf(fn () => AddReaction::run(actor($stranger), $w['comment'], ['emoji' => '👍']));

    expect($problem->getStatusCode())->toBe(404);
});

it('refuses an archived item and an archived project with 409', function () use ($world, $add, $remove) {
    $w = $world();
    $add($w['jonas'], $w['comment'], '👍');

    $w['item']->forceFill(['archived_at' => now()])->save();
    $item = problemOf(fn () => $add($w['lene'], $w['comment'], '👍'));
    $itemRemove = problemOf(fn () => $remove($w['jonas'], $w['comment'], '👍'));
    $w['item']->forceFill(['archived_at' => null])->save();
    $w['web']->update(['archived_at' => now()]);
    $project = problemOf(fn () => $add($w['lene'], $w['comment'], '👍'));
    $projectRemove = problemOf(fn () => $remove($w['jonas'], $w['comment'], '👍'));

    expect($item->getStatusCode())->toBe(409)->and($item->reason)->toBe('archived')
        ->and($itemRemove->getStatusCode())->toBe(409)->and($itemRemove->reason)->toBe('archived')
        ->and($project->getStatusCode())->toBe(409)->and($project->reason)->toBe('project_archived')
        ->and($projectRemove->getStatusCode())->toBe(409)->and($projectRemove->reason)->toBe('project_archived')
        ->and(CommentReaction::query()->count())->toBe(1);
});

it('answers 404 for a comment deleted meanwhile', function () use ($world, $add) {
    $w = $world();
    $stale = Comment::query()->find($w['comment']->id);
    $w['comment']->delete();

    expect(problemOf(fn () => $add($w['jonas'], $stale, '👍'))->getStatusCode())->toBe(404)
        ->and(eventsOf(EventType::CommentReactionAdded))->toHaveCount(0);
});

it('records the events, which the history leaves out', function () use ($world, $add, $remove) {
    $w = $world();
    $add($w['jonas'], $w['comment'], '👍');
    $remove($w['jonas'], $w['comment'], '👍');

    $types = collect(ListHistory::run(actor($w['mara']), $w['item'], [])->page->items())->map(fn ($e) => $e->type->value);

    expect(eventsOf(EventType::CommentReactionAdded))->toHaveCount(1)
        ->and(eventsOf(EventType::CommentReactionRemoved))->toHaveCount(1)
        ->and($types->filter(fn ($t) => str_starts_with($t, 'comment.reaction')))->toBeEmpty()
        ->and(EventType::CommentReactionAdded->webhook())->toBeFalse()
        ->and(EventType::CommentReactionRemoved->webhook())->toBeFalse();
});

it('reads the comment and the person of a reaction, and the author of a comment', function () use ($world, $add) {
    $w = $world();
    $add($w['jonas'], $w['comment'], '👍');
    $reaction = CommentReaction::query()->sole();

    expect($reaction->comment->is($w['comment']))->toBeTrue()
        ->and($reaction->user->is($w['jonas']))->toBeTrue()
        ->and($w['comment']->author->is($w['mara']))->toBeTrue();
});
