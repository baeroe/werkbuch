<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\SetSubscription;
use App\Events\EventType;
use App\Http\Resources\CommentResource;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use Illuminate\Support\Carbon;
use Tests\Support\RichTextFixtures as F;

/*
 * Adding a comment (Task 9): whoever reads the item may comment (`item.comment`, viewers too); the comment is a row of
 * its own, its event `comment.created` hangs on the item (A227). Who comments watches the item without lifting an
 * opt-out (A246); who the comment mentions watches it and has an opt-out lifted. WEB (public) with Mara as its admin,
 * Lene as a viewer, Jonas as a member and the bot Kira as a member; OPS is private, Ida is in the organization only.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $ida = User::factory()->create(['name' => 'Ida', 'handle' => 'ida']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return compact('mara', 'web', 'ops', 'lene', 'jonas', 'kira', 'ida', 'item');
};

$add = fn (User $user, WorkItem $item, array $input): Comment => AddComment::run(actor($user), $item, $input);

/** The row of the account in the subscribers of the item, or null. */
$watch = fn (WorkItem $item, User $user): ?WorkItemSubscriber => WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $user->id)->first();

it('lets a viewer comment and subscribes them', function () use ($world, $add, $watch) {
    $w = $world();

    $comment = $add($w['lene'], $w['item'], ['body' => 'Sieht **gut** aus.']);

    expect($comment->work_item_id)->toBe($w['item']->id)
        ->and($comment->author_id)->toBe($w['lene']->id)
        ->and($comment->body)->toBe(F::doc(F::p('Sieht ', F::text('gut', 'bold'), ' aus.')))
        ->and($comment->body_text)->toBe('Sieht gut aus.')
        ->and($comment->edited_at)->toBeNull()
        ->and($watch($w['item'], $w['lene'])?->reason)->toBe('commented')
        ->and($watch($w['item'], $w['lene'])?->unsubscribed_at)->toBeNull();
});

it('keeps the watch of someone who watches already, and lets bots watch nothing', function () use ($world, $add, $watch) {
    $w = $world();
    SetSubscription::run(actor($w['jonas']), $w['item'], true);

    $add($w['jonas'], $w['item'], ['body' => 'Mache ich.']);
    $add($w['kira'], $w['item'], ['body' => 'Erledigt.']);

    expect($watch($w['item'], $w['jonas'])?->reason)->toBe('manual')
        ->and($watch($w['item'], $w['kira']))->toBeNull();
});

it('keeps the opt-out of a commenter who unsubscribed', function () use ($world, $add, $watch) {
    $w = $world();
    // an opt-out without watching before (A250)
    SetSubscription::run(actor($w['lene']), $w['item'], false);

    $add($w['lene'], $w['item'], ['body' => 'Nur eine Anmerkung.']);

    expect($watch($w['item'], $w['lene'])?->unsubscribed_at)->not->toBeNull()
        ->and($watch($w['item'], $w['lene'])?->reason)->toBe('manual');
});

it('lifts the opt-out of a person the comment mentions', function () use ($world, $add, $watch) {
    $w = $world();
    SetSubscription::run(actor($w['jonas']), $w['item'], false);

    $add($w['lene'], $w['item'], ['body_json' => F::doc(F::p('Frag mal ', F::mention($w['jonas']->id, 'jonas'), '.'))]);

    expect($watch($w['item'], $w['jonas'])?->unsubscribed_at)->toBeNull()
        ->and($watch($w['item'], $w['jonas'])?->reason)->toBe('mentioned');
});

it('does not count a writer who mentions themselves (A259)', function () use ($world, $add, $watch) {
    $w = $world();
    SetSubscription::run(actor($w['lene']), $w['item'], false);

    $add($w['lene'], $w['item'], ['body' => 'Notiz für @lene und @jonas.']);
    $add($w['kira'], $w['item'], ['body' => '@kira merkt sich das.']);

    [$lene, $kira] = eventsOf(EventType::CommentCreated, $w['item'])->all();
    // Lene stays unsubscribed and is named nowhere; Jonas, the other one she mentions, counts
    expect($watch($w['item'], $w['lene'])?->unsubscribed_at)->not->toBeNull()
        ->and($lene->meta['mentioned'])->toBe([$w['jonas']->id])
        ->and($watch($w['item'], $w['jonas'])?->reason)->toBe('mentioned')
        // a bot that mentions itself hears nothing of it
        ->and($kira->meta)->not->toHaveKey('mentioned')
        ->and(eventsOf(EventType::BotMentioned, $w['item']))->toBeEmpty();
});

it('records comment.created on the item with the comment id and the newly mentioned', function () use ($world, $add) {
    $w = $world();

    $comment = $add($w['lene'], $w['item'], ['body' => '@jonas und @kira, bitte ansehen. @ida bleibt Text.']);

    $event = eventsOf(EventType::CommentCreated, $w['item'])->sole();
    $bot = eventsOf(EventType::BotMentioned, $w['item'])->sole();
    expect($event->actor_id)->toBe($w['lene']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta['comment_id'])->toBe($comment->id)
        ->and($event->meta['mentioned'])->toBe([$w['jonas']->id, $w['kira']->id])
        // the bot hears of it after the comment itself (A243)
        ->and($bot->id > $event->id)->toBeTrue()
        ->and($bot->meta)->toMatchArray(['bot_id' => $w['kira']->id, 'source' => 'comment', 'comment_id' => $comment->id])
        ->and($comment->body_text)->toBe('@jonas und @kira, bitte ansehen. @ida bleibt Text.');
});

it('names nobody when the comment mentions nobody', function () use ($world, $add) {
    $w = $world();

    $add($w['lene'], $w['item'], ['body' => 'Ohne Erwähnung.']);

    expect(eventsOf(EventType::CommentCreated, $w['item'])->sole()->meta)->not->toHaveKey('mentioned')
        ->and(eventsOf(EventType::BotMentioned, $w['item']))->toBeEmpty();
});

it('refuses an empty comment with 422 at body', function (array $input) use ($world, $add) {
    $w = $world();

    expect(invalidOf(fn () => $add($w['lene'], $w['item'], $input)))->toBe(['body' => [__('field.body.required')]])
        ->and(Comment::query()->count())->toBe(0)
        ->and(eventsOf(EventType::CommentCreated))->toBeEmpty();
})->with([
    'nothing' => [[]],
    'blanks in Markdown' => [['body' => "  \n "]],
    'an empty paragraph' => [['body_json' => F::doc(['type' => 'paragraph'])]],
]);

it('takes a comment of only an image', function () use ($world, $add) {
    $w = $world();
    $upload = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);

    $comment = $add($w['lene'], $w['item'], ['body_json' => F::doc(F::image($upload->id, null))]);

    expect($comment->body)->toBe(F::doc(F::image($upload->id, null)));
});

it('refuses an archived item and an archived project with 409', function () use ($world, $add) {
    $w = $world();
    $archived = WorkItem::factory()->for($w['web'])->archived()->create();
    $inArchive = WorkItem::factory()->for($w['ops'])->create();
    $w['ops']->update(['archived_at' => now()]);

    expect(problemOf(fn () => $add($w['mara'], $archived, ['body' => 'Noch was.'])))
        ->status->toBe(409)->reason->toBe('archived')
        ->and(problemOf(fn () => $add($w['mara'], $inArchive, ['body' => 'Noch was.'])))
        ->status->toBe(409)->reason->toBe('project_archived')
        ->and(Comment::query()->count())->toBe(0);
});

it('links the writer\'s unowned uploads to the comment', function () use ($world, $add) {
    $w = $world();
    $mine = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['lene']->id]);
    $theirs = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['jonas']->id]);

    $comment = $add($w['lene'], $w['item'], ['body' => "![Skizze](attachment:{$mine->id})"]);

    expect($mine->fresh()?->attachable_type)->toBe('comment')
        ->and($mine->fresh()?->attachable_id)->toBe($comment->id);

    // someone else's upload is no picture of this comment (A233)
    expect(invalidOf(fn () => $add($w['lene'], $w['item'], ['body_json' => F::doc(F::image($theirs->id, null))])))
        ->toBe(['body_json' => [__('field.rich_text.attachment')]])
        ->and($theirs->fresh()?->attachable_id)->toBeNull();
});

it('hides the item of a private project from an outsider (404)', function () use ($world, $add) {
    $w = $world();
    $item = WorkItem::factory()->for($w['ops'])->create();

    $refused = problemOf(fn () => $add($w['ida'], $item, ['body' => 'Hallo?']));

    expect($refused->getStatusCode())->toBe(404)
        ->and(Comment::query()->count())->toBe(0);
});

it('leaves updated_at of the item alone', function () use ($world, $add) {
    $w = $world();
    $before = $w['item']->fresh()?->updated_at?->toJSON();
    Carbon::setTestNow(now()->addHour()->startOfSecond());

    $comment = $add($w['lene'], $w['item'], ['body' => 'Später.']);

    expect($w['item']->fresh()?->updated_at?->toJSON())->toBe($before)
        ->and($comment->created_at?->toJSON())->toBe(now()->toJSON());
});

it('writes mentions and references in Markdown with the current names for the reader', function () use ($world, $add) {
    $w = $world();
    $other = WorkItem::factory()->for($w['web'])->create();
    $hidden = WorkItem::factory()->for($w['ops'])->create();

    // Mara sees OPS: her reference to its item stays a node
    $comment = $add($w['mara'], $w['item'], ['body_json' => F::doc(F::p(F::mention($w['jonas']->id, 'alt'), ' siehe ', F::reference($other->id), ' und ', F::reference($hidden->id)))]);
    $w['jonas']->update(['handle' => 'jonas-neu']);

    $read = fn (User $reader) => (new CommentResource(tap($comment->fresh(), fn (Comment $fresh) => Comment::loadForResource($fresh, $reader))))->resolve();

    expect($read($w['mara'])['body'])->toBe("@jonas-neu siehe {$other->key} und {$hidden->key}")
        ->and($read($w['lene'])['body'])->toBe("@jonas-neu siehe {$other->key} und [hidden](item:{$hidden->id})");
});
