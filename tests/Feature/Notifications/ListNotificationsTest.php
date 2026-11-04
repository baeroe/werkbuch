<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Notifications\ListNotifications;
use App\Domain\Notifications\NotificationKind;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

/*
 * The inbox (Task 6): only the own notifications shown in the inbox (A271), only while the person sees what they are
 * about (K5, Review Focus 3), newest first. WEB (public) with Tom as its admin and lead, Mara and Ida as members; OPS
 * is private with Tom and Mara as members (Ida is none).
 */

$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom', 'handle' => 'tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara Feld', 'handle' => 'mara']);
    app(RoleAssignments::class)->setProjectRole($mara, $ops, ProjectRole::Member);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id, 'title' => 'Kontaktformular']);
    $secret = WorkItem::factory()->for($ops)->create(['created_by' => $tom->id, 'title' => 'Geheimer Umzug']);

    return compact('tom', 'web', 'ops', 'mara', 'ida', 'item', 'secret');
};

/** The ids of a page, in its order. */
$ids = fn ($result) => array_map(fn (Notification $n) => $n->id, $result->page->items());

it('lists my notifications newest first and pages them without losing one in the same second', function () use ($world, $ids) {
    $w = $world();
    $at = fn (string $moment) => Carbon::parse($moment, 'UTC');
    $make = fn (string $moment) => Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id, 'created_at' => $at($moment)]);
    $older = $make('2026-11-03 09:00:00.000001');
    $sameA = $make('2026-11-03 10:00:00.250000');
    $sameB = $make('2026-11-03 10:00:00.250000');
    $within = $make('2026-11-03 10:00:00.750000');
    $newest = $make('2026-11-03 11:00:00.000000');
    // someone else's
    Notification::factory()->forItem($w['item'])->create(['user_id' => $w['ida']->id, 'created_at' => $at('2026-11-03 12:00:00')]);

    // the same microsecond: the higher ULID first
    [$first, $second] = strcmp($sameA->id, $sameB->id) > 0 ? [$sameA, $sameB] : [$sameB, $sameA];
    $expected = [$newest->id, $within->id, $first->id, $second->id, $older->id];

    $seen = [];
    $cursor = null;
    do {
        $page = ListNotifications::run(actor($w['mara']), ['per_page' => 2, 'cursor' => $cursor]);
        expect($page->total)->toBe(5);
        array_push($seen, ...$ids($page));
        $cursor = $page->page->nextCursor()?->encode();
    } while ($cursor !== null);

    expect($seen)->toBe($expected);
});

it('hides the notifications of a project I lost, and shows them again when I am back', function () use ($world, $ids) {
    $w = $world();
    $onWeb = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $onOps = Notification::factory()->forItem($w['secret'])->create(['user_id' => $w['mara']->id]);

    expect($ids(ListNotifications::run(actor($w['mara']), [])))->toEqualCanonicalizing([$onWeb->id, $onOps->id]);

    app(RoleAssignments::class)->removeFromProject($w['mara'], $w['ops']);
    Visibility::forget();
    expect($ids(ListNotifications::run(actor($w['mara']), [])))->toBe([$onWeb->id]);

    app(RoleAssignments::class)->setProjectRole($w['mara'], $w['ops'], ProjectRole::Member);
    Visibility::forget();
    expect($ids(ListNotifications::run(actor($w['mara']), [])))->toEqualCanonicalizing([$onWeb->id, $onOps->id]);

    // a deactivated account sees nothing
    $w['mara']->forceFill(['disabled_at' => now()])->save();
    Visibility::forget();
    expect(ListNotifications::run(actor($w['mara']), [])->total)->toBe(0);
});

it('hides an organization notification once the person is no org admin', function () use ($ids) {
    $admin = User::factory()->admin()->create();
    $webhook = Notification::factory()->kind(NotificationKind::WebhookDisabled, ['webhook_id' => '01jcwebh00k000000000000000'])
        ->create(['user_id' => $admin->id, 'work_item_id' => null, 'project_id' => null]);

    $page = ListNotifications::run(actor($admin), []);
    expect($ids($page))->toBe([$webhook->id])
        ->and($page->page->items()[0]->excerpt)->toBeNull();

    app(RoleAssignments::class)->setOrgRole($admin, OrgRole::Member);
    Visibility::forget();
    expect(ListNotifications::run(actor($admin), [])->total)->toBe(0);
});

it('hides mail-only notifications', function () use ($world, $ids) {
    $w = $world();
    $shown = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    Notification::factory()->forItem($w['item'])->mailOnly()->create(['user_id' => $w['mara']->id]);

    expect($ids(ListNotifications::run(actor($w['mara']), [])))->toBe([$shown->id]);
});

it('filters unread and mentions', function () use ($world, $ids) {
    $w = $world();
    $make = fn (NotificationKind $kind, bool $read, string $moment) => Notification::factory()->forItem($w['item'])
        ->kind($kind, $kind === NotificationKind::Mentioned ? ['source' => 'values'] : [])
        ->state(['read_at' => $read ? now() : null, 'created_at' => Carbon::parse($moment, 'UTC')])
        ->create(['user_id' => $w['mara']->id]);
    $unreadMention = $make(NotificationKind::Mentioned, false, '2026-11-03 10:00:04');
    $readMention = $make(NotificationKind::Mentioned, true, '2026-11-03 10:00:03');
    $unreadChange = $make(NotificationKind::ItemChanged, false, '2026-11-03 10:00:02');
    $readChange = $make(NotificationKind::ItemChanged, true, '2026-11-03 10:00:01');
    $list = fn (array $query) => $ids(ListNotifications::run(actor($w['mara']), $query));

    expect($list([]))->toBe([$unreadMention->id, $readMention->id, $unreadChange->id, $readChange->id])
        ->and($list(['unread_only' => '1']))->toBe([$unreadMention->id, $unreadChange->id])
        ->and($list(['mentions_only' => true]))->toBe([$unreadMention->id, $readMention->id])
        ->and($list(['unread_only' => 1, 'mentions_only' => '1']))->toBe([$unreadMention->id])
        ->and($list(['unread_only' => '0', 'mentions_only' => false]))->toHaveCount(4);

    try {
        ListNotifications::run(actor($w['mara']), ['unread_only' => 'ja', 'mentions_only' => ['x']]);
        $this->fail('expected a 422');
    } catch (ValidationException $invalid) {
        expect($invalid->errors())->toBe([
            'unread_only' => [__('field.boolean')],
            'mentions_only' => [__('field.boolean')],
        ]);
    }
});

it('shows the current comment as excerpt, nothing once it is deleted', function () use ($world) {
    $w = $world();
    $comment = Comment::factory()->for($w['item'], 'workItem')->create(['author_id' => $w['tom']->id]);
    $byComment = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment, ['comment_id' => $comment->id])
        ->create(['user_id' => $w['mara']->id]);
    $mentioned = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'comment', 'comment_id' => $comment->id])
        ->create(['user_id' => $w['mara']->id]);
    $inDescription = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'description'])
        ->create(['user_id' => $w['mara']->id]);
    $inValues = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'values'])
        ->create(['user_id' => $w['mara']->id]);
    $changed = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    // by id: the order of the inbox is not the point here
    $excerpts = fn () => collect(ListNotifications::run(actor($w['mara']), [])->page->items())
        ->mapWithKeys(fn (Notification $n) => [$n->id => $n->excerpt])->sortKeys()->all();

    // the text as it is now, 160 characters at most
    $long = str_repeat('Lang ', 40);
    $comment->update(['body' => F::doc(F::p('Jetzt geändert, ', F::mention($w['mara']->id, 'mara-alt'), '.'), F::p($long))]);
    $w['item']->update(['description' => F::doc(F::p('Bitte ', F::mention($w['mara']->id, 'mara'), ' prüfen.'))]);
    $text = mb_substr("Jetzt geändert, @Mara Feld.\n".trim($long), 0, 160);

    expect($excerpts())->toBe(collect([
        $byComment->id => $text,
        $mentioned->id => $text,
        $inDescription->id => 'Bitte @Mara Feld prüfen.',
        $inValues->id => null,
        $changed->id => null,
    ])->sortKeys()->all())->and(mb_strlen($text))->toBe(160);

    $comment->delete();
    $w['item']->update(['description' => null]);

    expect(array_values($excerpts()))->toBe([null, null, null, null, null]);
});

it('gives Ida no key or title of an item she cannot see in the excerpt', function () use ($world) {
    $w = $world();
    $comment = Comment::factory()->for($w['item'], 'workItem')->create([
        'author_id' => $w['tom']->id,
        'body' => F::doc(F::p('Hängt mit ', F::reference($w['secret']->id), ' zusammen.')),
    ]);
    foreach ([$w['ida'], $w['mara']] as $reader) {
        Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment, ['comment_id' => $comment->id])->create(['user_id' => $reader->id]);
    }
    $excerpt = fn (User $reader) => ListNotifications::run(actor($reader), [])->page->items()[0]->excerpt;

    expect($excerpt($w['ida']))->toBe('Hängt mit '.__('richtext.hidden').' zusammen.')
        ->not->toContain('OPS-')->not->toContain('Geheim')->not->toContain($w['secret']->id)
        // Mara sees OPS: key and title
        ->and($excerpt($w['mara']))->toBe("Hängt mit {$w['secret']->key} Geheimer Umzug zusammen.");
});

it('lists an empty inbox for a bot', function () {
    $page = ListNotifications::run(actor(User::defaultBot()), []);

    expect($page->total)->toBe(0)->and($page->page->items())->toBe([]);
});

it('asks the database a fixed number of times for 5 and 50 notifications', function () use ($world) {
    $w = $world();
    $count = function (int $notifications) use ($w): int {
        Notification::query()->delete();
        NotificationMail::query()->delete();
        foreach (range(1, $notifications) as $n) {
            $item = WorkItem::factory()->for($n % 2 === 0 ? $w['web'] : $w['ops'])->create(['description' => F::doc(F::p(F::mention($w['mara']->id, 'mara'), " {$n}"))]);
            if ($n % 2 === 0) {
                Notification::factory()->forItem($item)->kind(NotificationKind::Mentioned, ['source' => 'description'])->create(['user_id' => $w['mara']->id]);

                continue;
            }
            $comment = Comment::factory()->for($item, 'workItem')->create(['body' => F::doc(F::p(F::mention($w['tom']->id, 'tom'), ' ', F::reference($w['secret']->id)))]);
            $mail = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'sent_at' => now()]);
            Notification::factory()->forItem($item)->kind(NotificationKind::Comment, ['comment_id' => $comment->id])->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id]);
        }

        // the first run reads the models' boot; then the roles forgotten, so the count holds their queries too (T6-M4)
        ListNotifications::run(actor($w['mara']), []);
        Visibility::forget();
        DB::enableQueryLog();
        DB::flushQueryLog();
        $page = ListNotifications::run(actor($w['mara']), []);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        expect($page->total)->toBe($notifications)
            ->and(collect($page->page->items())->every(fn (Notification $n) => $n->excerpt !== null))->toBeTrue();

        return $queries;
    };

    expect($count(50))->toBe($count(5));
});
