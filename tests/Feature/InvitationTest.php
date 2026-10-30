<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Auth\AcceptInvitation;
use App\Actions\Invitations\InviteUser;
use App\Enums\Locale;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Notifications\InvitationNotification;
use App\Support\InvitationLinks;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;
use Inertia\Testing\AssertableInertia as Assert;

/** Invites `lea@example.com` as the given admin, with the projects of `$projects` (`[project, role]`). */
function invite(?User $admin = null, string $email = 'lea@example.com', array $projects = [], string $role = 'member'): Invitation
{
    return InviteUser::run(actor($admin ?? User::factory()->admin()->create()), [
        'email' => $email,
        'org_role' => $role,
        'projects' => array_map(fn (array $entry) => ['project_id' => $entry[0]->id, 'role' => $entry[1]], $projects),
    ]);
}

/** The state the page of the link shows. */
function stateOf(Invitation $invitation): string
{
    return test()->get(InvitationLinks::for($invitation))->viewData('page')['props']['state'];
}

it('replaces the open invitation to an address, so the old link closes', function () {
    $admin = User::factory()->admin()->create();
    $first = InviteUser::run(actor($admin), ['email' => 'neu@example.com', 'org_role' => 'member']);
    $second = InviteUser::run(actor($admin), ['email' => 'NEU@example.com ', 'org_role' => 'admin']);

    $this->get(InvitationLinks::for($first))->assertInertia(fn (Assert $p) => $p->component('Auth/Invitation')->where('state', 'closed')->where('email', null));
    $this->get(InvitationLinks::for($second))->assertInertia(fn (Assert $p) => $p->component('Auth/Invitation')->where('state', 'open')->where('email', 'neu@example.com'));

    expect(Invitation::query()->pluck('email')->all())->toBe(['neu@example.com'])
        ->and($second->org_role)->toBe(OrgRole::Admin);
});

it('accepts once, signs the person in and joins the invited projects', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->create();
    $invitation = InviteUser::run(actor($admin), ['email' => 'lea@example.com', 'org_role' => 'member', 'projects' => [['project_id' => $web->id, 'role' => 'viewer']]]);

    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea Sommer', 'password' => 'secret-pass'])
        ->assertRedirect('/my-items')
        ->assertSessionHas('status', __('invitation.welcome', ['name' => 'Lea Sommer', 'organization' => Organization::current()->name]));
    $lea = User::query()->where('email', 'lea@example.com')->sole();
    $this->assertAuthenticatedAs($lea);
    expect(Visibility::roleIn($lea, $web))->toBe(ProjectRole::Viewer)
        ->and(Visibility::isMember($lea, $web))->toBeTrue()
        ->and(Visibility::orgRole($lea))->toBe(OrgRole::Member)
        ->and($lea->handle)->toBe('lea-sommer')
        ->and($lea->isPerson())->toBeTrue()
        ->and(Invitation::query()->sole()->accepted_at)->not->toBeNull();

    auth()->logout();
    $this->post(InvitationLinks::for($invitation), ['name' => 'Again', 'password' => 'secret-pass'])->assertSessionHasErrors('invitation');
    expect(User::query()->where('email', 'lea@example.com')->count())->toBe(1);
});

it('gives the person the role of the invitation and a free handle, and trims the name', function () {
    User::factory()->create(['handle' => 'lea-sommer']);
    $invitation = invite(role: 'admin');

    $this->post(InvitationLinks::for($invitation), ['name' => '  Lea Sommer ', 'password' => 'secret-pass'])->assertRedirect('/my-items');

    $lea = User::query()->where('email', 'lea@example.com')->sole();
    expect($lea->name)->toBe('Lea Sommer')->and($lea->handle)->toBe('lea-sommer-2')->and(Visibility::orgRole($lea))->toBe(OrgRole::Admin);
});

it('keeps the language of the request for the new account', function (string $cookie, ?Locale $expected) {
    $invitation = invite();

    $this->withUnencryptedCookie('locale', $cookie)->post(InvitationLinks::for($invitation), ['name' => 'Lea Sommer', 'password' => 'secret-pass']);

    expect(User::query()->where('email', 'lea@example.com')->sole()->locale)->toBe($expected);
})->with([['de', Locale::De], ['en', Locale::En]]);

it('expires after seven days', function () {
    $invitation = invite();

    $this->travelTo(now()->addDays(7)->subSecond());
    expect(stateOf($invitation))->toBe('open');

    $this->travelTo(now()->addSeconds(2));
    expect(stateOf($invitation))->toBe('expired');
    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['invitation' => __('invitation.expired')]);
    $this->assertGuest();
    expect(User::query()->where('email', 'lea@example.com')->exists())->toBeFalse();
});

it('closes when the inviter is no longer an active admin', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $invitation = invite($admin);
    expect(stateOf($invitation))->toBe('open');

    $change($admin);
    Visibility::forget();

    expect(stateOf($invitation))->toBe('closed');
    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['invitation' => __('invitation.closed')]);
    expect(User::query()->where('email', 'lea@example.com')->exists())->toBeFalse();
})->with([
    'demoted' => [fn (User $admin) => app(RoleAssignments::class)->setOrgRole($admin, OrgRole::Member)],
    'deactivated' => [fn (User $admin) => $admin->update(['disabled_at' => now()])],
]);

it('stays open when the default bot invited', function () {
    $invitation = invite(User::defaultBot());

    expect(stateOf($invitation))->toBe('open');
});

it('closes without an inviter, after it was accepted and for an address that has an account', function () {
    $orphan = Invitation::factory()->create(['invited_by' => null]);
    $accepted = Invitation::factory()->accepted()->create();
    $taken = invite(email: 'lea@example.com');
    User::factory()->create(['email' => 'lea@example.com']);

    expect(stateOf($orphan))->toBe('closed')->and(stateOf($accepted))->toBe('closed')->and(stateOf($taken))->toBe('closed');
    $this->get(InvitationLinks::for($taken))->assertInertia(fn (Assert $p) => $p->where('email', null));
});

it('treats an unknown invitation as a closed link, for the page and for the form', function () {
    $invitation = invite();
    $link = InvitationLinks::for($invitation);
    $invitation->delete();

    $this->get($link)->assertInertia(fn (Assert $p) => $p->component('Auth/Invitation')->where('state', 'closed')->where('email', null));
    $this->post($link, ['name' => 'Lea', 'password' => 'secret-pass'])->assertSessionHasErrors(['invitation' => __('invitation.closed')]);
    $this->assertGuest();
});

it('refuses a link with a broken or missing signature', function (Closure $break) {
    $invitation = invite();
    $link = $break(InvitationLinks::for($invitation), $invitation);

    $this->get($link)->assertForbidden()->assertInertia(fn (Assert $p) => $p->component('Errors/Error')->where('status', 403));
    $this->post($link, ['name' => 'Lea', 'password' => 'secret-pass'])->assertForbidden();
    expect(User::query()->where('email', 'lea@example.com')->exists())->toBeFalse();
})->with([
    'a changed signature' => [fn (string $link) => substr($link, 0, -1).(str_ends_with($link, 'a') ? 'b' : 'a')],
    'no signature' => [fn (string $link, Invitation $i) => rtrim((string) config('app.url'), '/').'/invitations/'.$i->id],
    'another invitation' => [fn (string $link, Invitation $i) => str_replace($i->id, Invitation::factory()->create()->id, $link)],
]);

it('builds the link from APP_URL, not from the host of the request', function () {
    config(['app.url' => 'https://pm.example.com/']);
    $admin = User::factory()->admin()->create();

    $link = $this->withHeader('Host', 'evil.example.net')->actingAs($admin)->postJson('/api/v1/invitations', ['email' => 'lea@example.com', 'org_role' => 'member'])
        ->assertCreated()->json('link');

    expect($link)->toStartWith('https://pm.example.com/invitations/'.Invitation::query()->sole()->id.'?signature=')
        ->and(InvitationLinks::for(Invitation::query()->sole()))->toBe($link);
});

it('opens the link on whatever host reaches the app, the signature is relative', function () {
    config(['app.url' => 'https://pm.example.com']);
    $link = InvitationLinks::for(invite());
    $relative = parse_url($link, PHP_URL_PATH).'?'.parse_url($link, PHP_URL_QUERY);

    $this->withHeader('Host', 'localhost:8080')->get($relative)->assertOk()->assertInertia(fn (Assert $p) => $p->where('state', 'open'));
});

it('mails the link when mail is configured, and only then', function () {
    Notification::fake();
    $admin = User::factory()->admin()->create(['name' => 'Mara Lindqvist']);
    Organization::current()->update(['name' => 'Feldwerk', 'locale' => Locale::De]);

    invite($admin, 'nomail@example.com');
    Notification::assertNothingSent();

    config(['mail.default' => 'smtp']);
    $invitation = invite($admin, 'lea@example.com');

    Notification::assertSentOnDemand(InvitationNotification::class, function (InvitationNotification $notification, array $channels, $notifiable) use ($invitation) {
        $mail = $notification->toMail($notifiable);

        return $notifiable->routes['mail'] === 'lea@example.com'
            && $channels === ['mail']
            && $notification->queue === 'notifications' && $notification->afterCommit === true && $notification->locale === 'de'
            && $mail->actionUrl === InvitationLinks::for($invitation);
    });
    Notification::assertSentOnDemandTimes(InvitationNotification::class, 1);
});

it('writes the mail with the texts of the app in the language of the organization', function (Locale $locale) {
    app()->setLocale($locale->value);
    $mail = (new InvitationNotification('https://pm.example.com/invitations/x', 'Feldwerk', 'Mara Lindqvist'))->toMail(Notification::route('mail', 'lea@example.com'));
    $html = (string) $mail->render();

    expect($mail->subject)->toBe(trans('mail.invitation.subject', ['organization' => 'Feldwerk'], $locale->value))
        ->and($mail->actionText)->toBe(trans('mail.invitation.action', [], $locale->value))
        ->and($html)->toContain(e(trans('mail.invitation.intro', ['inviter' => 'Mara Lindqvist', 'organization' => 'Feldwerk'], $locale->value)))
        ->toContain(e(trans('mail.invitation.expiry', ['days' => 7], $locale->value)))
        ->toContain(e(trans('mail.layout.regards', [], $locale->value)))
        ->not->toContain('Regards,')->not->toContain('All rights reserved');
})->with([Locale::En, Locale::De]);

it('skips projects that are gone or being deleted by the time the invitation is accepted', function () {
    $web = Project::factory()->identifier('WEB')->create();
    $ops = Project::factory()->identifier('OPS')->create();
    $gone = Project::factory()->identifier('OLD')->create();
    $invitation = invite(projects: [[$web, 'member'], [$ops, 'admin'], [$gone, 'viewer']]);
    $ops->update(['deleting_at' => now()]);
    $gone->delete();

    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea Sommer', 'password' => 'secret-pass'])->assertRedirect('/my-items');

    $lea = User::query()->where('email', 'lea@example.com')->sole();
    expect(Visibility::roleIn($lea, $web))->toBe(ProjectRole::Member)
        ->and(Visibility::isMember($lea, $ops))->toBeFalse()
        ->and(Visibility::projectIds($lea)->all())->toBe([$web->id]);
    expect(Event::query()->where('type', EventType::ProjectMemberAdded)->pluck('project_id')->all())->toBe([$web->id]);
});

it('names the empty name and a short password at their fields and creates nothing', function (array $input, array $fields) {
    $invitation = invite();

    $this->from('/somewhere')->post(InvitationLinks::for($invitation), $input)->assertRedirect('/somewhere')->assertSessionHasErrors($fields);
    $this->assertGuest();
    expect(User::query()->where('email', 'lea@example.com')->exists())->toBeFalse()
        ->and(Invitation::query()->sole()->accepted_at)->toBeNull();
})->with([
    'nothing' => [[], ['name', 'password']],
    'blank name' => [['name' => '   ', 'password' => 'secret-pass'], ['name']],
    'long name' => [['name' => str_repeat('x', 121), 'password' => 'secret-pass'], ['name']],
    'no text' => [['name' => ['x'], 'password' => 'secret-pass'], ['name']],
    'short password' => [['name' => 'Lea', 'password' => 'short'], ['password']],
]);

it('says at the fields what is wrong, in the language of the request', function () {
    $link = InvitationLinks::for(invite());

    $this->withUnencryptedCookie('locale', 'de')->post($link, ['name' => ' ', 'password' => 'short'])->assertSessionHasErrors([
        'name' => 'Der Name darf nicht leer sein.',
        'password' => trans('validation.min.string', ['attribute' => trans('validation.attributes.password'), 'min' => 8], 'de'),
    ]);
});

it('notes who created the account and who joined the projects as the system, with the reason', function () {
    $web = Project::factory()->identifier('WEB')->create();
    $invitation = invite(projects: [[$web, 'member']]);

    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea Sommer', 'password' => 'secret-pass']);

    $lea = User::query()->where('email', 'lea@example.com')->sole();
    $created = Event::query()->where('type', EventType::UserCreated)->where('subject_id', $lea->id)->sole();
    $joined = Event::query()->where('type', EventType::ProjectMemberAdded)->sole();

    expect($created->actor_id)->toBe($lea->id)->and($created->meta)->toMatchArray(['via' => 'system', 'reason' => 'invitation'])
        ->and($joined->actor_id)->toBe($lea->id)->and($joined->subject_id)->toBe($web->id)->and($joined->project_id)->toBe($web->id)
        ->and($joined->meta)->toMatchArray(['via' => 'system', 'reason' => 'invitation'])
        ->and($joined->changes)->toBe(['member' => ['old' => null, 'new' => ['user_id' => $lea->id, 'role' => 'member']]]);
});

it('notes the invitation with the address and the inviter', function () {
    $admin = User::factory()->admin()->create();
    $invitation = invite($admin, 'Lea@Example.com');

    $event = Event::query()->where('type', EventType::UserInvited)->sole();

    expect($event->actor_id)->toBe($admin->id)->and($event->subject_type)->toBe('invitation')->and($event->subject_id)->toBe($invitation->id)
        ->and($event->changes)->toBe(['email' => ['old' => null, 'new' => 'lea@example.com']])
        ->and($event->project_id)->toBeNull();
});

it('lets only one of two requests with the same link create the account', function () {
    $invitation = invite();
    $input = ['name' => 'Lea Sommer', 'password' => 'secret-pass'];

    AcceptInvitation::run($invitation, $input);

    // the second request still holds the model it loaded before the first one finished
    expect(fn () => AcceptInvitation::run($invitation, $input))->toThrow(ValidationException::class);
    expect(User::query()->where('email', 'lea@example.com')->count())->toBe(1);
});

it('limits accepting to ten attempts per IP and shows the limit at the invitation', function () {
    $this->freezeTime();
    $invitation = invite();
    $link = InvitationLinks::for($invitation);

    foreach (range(1, 10) as $attempt) {
        $this->from($link)->post($link, [])->assertSessionHasErrors(['name']);
    }

    $this->from($link)->post($link, ['name' => 'Lea Sommer', 'password' => 'secret-pass'])
        ->assertRedirect($link)->assertSessionHasErrors(['invitation' => __('auth.throttle', ['seconds' => 60])]);
    $this->assertGuest();

    // another IP has its own budget
    $this->withServerVariables(['REMOTE_ADDR' => '10.9.9.9'])->post($link, ['name' => 'Lea Sommer', 'password' => 'secret-pass'])->assertRedirect('/my-items');
});

it('sends signed-in people to their items instead of the invitation', function () {
    $invitation = invite();

    $this->actingAs(User::factory()->create())->get(InvitationLinks::for($invitation))->assertRedirect('/my-items');
});
