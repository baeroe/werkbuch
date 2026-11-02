<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\EditComment;
use App\Actions\WorkItems\SetSubscription;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use Illuminate\Support\Carbon;
use Tests\Support\RichTextFixtures as F;

/*
 * Editing a comment (Task 9): only its author, marked as edited; the history keeps the old and the new version
 * (`comment.updated`, A228). WEB (public) with Mara as its admin, Lene as a viewer, Jonas and the bot Kira as members.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return compact('mara', 'web', 'lene', 'jonas', 'kira', 'item');
};

$edit = fn (User $user, Comment $comment, array $input): Comment => EditComment::run(actor($user), $comment, $input);

it('marks the comment edited and keeps the old version in the history', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Erster Endwurf.']);
    $old = $comment->body;
    Carbon::setTestNow(now()->addMinutes(3)->startOfSecond());

    $edited = $edit($w['lene'], $comment, ['body' => 'Erster Entwurf.']);

    $event = eventsOf(EventType::CommentUpdated, $w['item'])->sole();
    expect($edited->edited_at?->toJSON())->toBe(now()->toJSON())
        ->and($edited->body)->toBe(F::doc(F::p('Erster Entwurf.')))
        ->and($edited->body_text)->toBe('Erster Entwurf.')
        ->and($comment->fresh()?->body_text)->toBe('Erster Entwurf.')
        ->and($event->actor_id)->toBe($w['lene']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBe(['body' => ['old' => $old, 'new' => F::doc(F::p('Erster Entwurf.'))]])
        ->and($event->meta)->toMatchArray(['comment_id' => $comment->id, 'author_id' => $w['lene']->id])
        ->and($event->meta)->not->toHaveKey('mentioned');
});

it('records nothing for the same text', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Bleibt so.']);
    Carbon::setTestNow(now()->addMinutes(3));

    // the same text, once as JSON and once as Markdown
    $edit($w['lene'], $comment, ['body_json' => F::doc(F::p('Bleibt so.'))]);
    $edited = $edit($w['lene'], $comment, ['body' => 'Bleibt so.']);

    expect($edited->edited_at)->toBeNull()
        ->and($comment->fresh()?->edited_at)->toBeNull()
        ->and(eventsOf(EventType::CommentUpdated))->toBeEmpty();
});

it('lets only the author edit (403 for an admin)', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Meins.']);
    $ida = User::factory()->create();
    $ops = Project::factory()->private()->create();
    $hidden = Comment::factory()->for(WorkItem::factory()->for($ops), 'workItem')->create(['author_id' => $ida->id]);

    $refused = problemOf(fn () => $edit($w['mara'], $comment, ['body' => 'Geändert.']));
    $org = problemOf(fn () => $edit(User::factory()->admin()->create(), $comment, ['body' => 'Geändert.']));

    expect($refused->getStatusCode())->toBe(403)
        ->and($refused->detail)->toBe(__('problem.detail.comment_author_only'))
        ->and($org->getStatusCode())->toBe(403)
        // the author of a comment of a project they no longer see gets the 404 of an unknown one
        ->and(problemOf(fn () => $edit($ida, $hidden, ['body' => 'Geändert.']))->getStatusCode())->toBe(404)
        ->and($comment->fresh()?->body_text)->toBe('Meins.');
});

it('names only people the edit mentions newly', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => '@jonas, schau mal.']);
    SetSubscription::run(actor($w['jonas']), $w['item'], false);

    $edit($w['lene'], $comment, ['body' => '@jonas und @mara und @kira, schaut mal.']);

    $event = eventsOf(EventType::CommentUpdated, $w['item'])->sole();
    $jonas = WorkItemSubscriber::query()->where('work_item_id', $w['item']->id)->where('user_id', $w['jonas']->id)->sole();
    expect($event->meta['mentioned'])->toBe([$w['mara']->id, $w['kira']->id])
        // Jonas was mentioned before: his opt-out stays
        ->and($jonas->unsubscribed_at)->not->toBeNull()
        ->and(eventsOf(EventType::BotMentioned, $w['item'])->sole()->meta)->toMatchArray(['bot_id' => $w['kira']->id, 'source' => 'comment', 'comment_id' => $comment->id]);
});

it('keeps a mention of a former member the comment had before', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => '@jonas, schau mal.']);
    app(RoleAssignments::class)->removeFromProject($w['jonas'], $w['web']);

    $edited = $edit($w['lene'], $comment, ['body' => '@jonas, schau bitte mal.']);

    expect($edited->body)->toBe(F::doc(F::p(F::mention($w['jonas']->id, 'jonas'), ', schau bitte mal.')));
});

it('links new uploads of the writer to the comment', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Gleich mit Bild.']);
    $upload = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);

    $edit($w['lene'], $comment, ['body_json' => F::doc(F::p('Mit Bild:'), F::image($upload->id, 'Skizze'))]);

    expect($upload->fresh()?->attachable_id)->toBe($comment->id);
});

it('refuses an empty edit with 422 at body', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Text.']);

    expect(invalidOf(fn () => $edit($w['lene'], $comment, ['body' => ' '])))->toBe(['body' => [__('field.body.required')]])
        ->and($comment->fresh()?->body_text)->toBe('Text.');
});

it('refuses an archived item and an archived project with 409', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Text.']);

    $w['item']->forceFill(['archived_at' => now()])->save();
    $item = problemOf(fn () => $edit($w['lene'], $comment, ['body' => 'Neu.']));
    $w['item']->forceFill(['archived_at' => null])->save();
    $w['web']->update(['archived_at' => now()]);
    $project = problemOf(fn () => $edit($w['lene'], $comment, ['body' => 'Neu.']));

    expect($item->getStatusCode())->toBe(409)->and($item->reason)->toBe('archived')
        ->and($project->getStatusCode())->toBe(409)->and($project->reason)->toBe('project_archived')
        ->and($comment->fresh()?->body_text)->toBe('Text.');
});

it('answers 404 for a comment deleted meanwhile', function () use ($world, $edit) {
    $w = $world();
    $comment = AddComment::run(actor($w['lene']), $w['item'], ['body' => 'Text.']);
    Comment::query()->whereKey($comment->id)->delete();

    expect(problemOf(fn () => $edit($w['lene'], $comment, ['body' => 'Neu.']))->getStatusCode())->toBe(404);
});
