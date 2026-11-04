<?php

use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Pages\GetPage;
use App\Broadcasting\ProjectChannel;
use App\Broadcasting\UserChannel;
use App\Broadcasting\WorkItemChannel;
use App\Enums\ProjectVisibility;
use App\Models\Page;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Access\MatrixWorld;

/*
 * The live channels (spec 7.2, A280) for every column of the MatrixWorld: a channel authorizes through the policies and
 * Visibility, only for the session of the interface (A283), and a refusal is a JSON 403 (never a page).
 */

beforeEach(fn () => liveChannels());

/** The columns that read the project of the column (MatrixWorld::project): everybody but the outsider of OPS and the bot. */
const LIVE_READERS = ['org_admin', 'project_admin', 'project_member', 'project_viewer', 'outsider_public'];

$listen = fn (string $channel): TestResponse => test()->postJson('/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel]);

$refused = function (TestResponse $response): void {
    $response->assertForbidden()->assertHeader('Content-Type', 'application/json')->assertJsonMissingPath('auth');
};

it('lets everyone who reads a project listen to it', function (string $column) use ($listen, $refused) {
    $w = MatrixWorld::build();
    $this->actingAs($w->account($column));

    $response = $listen('private-project.'.$w->project($column)->id);

    if (in_array($column, LIVE_READERS, true)) {
        expect($response->assertOk()->json('auth'))->toStartWith('live-key:');
    } else {
        $refused($response);
    }
})->with(MatrixWorld::COLUMNS);

it('lets only who reads the private project OPS listen to it and its items (T9-M4)', function (string $column) use ($listen, $refused) {
    $w = MatrixWorld::build();
    $this->actingAs($w->account($column));
    $item = WorkItem::factory()->for($w->ops)->create();

    // the org admin without being a member, and the members of every role; nobody else, never a bot
    $readers = ['org_admin', 'project_admin', 'project_member', 'project_viewer'];
    foreach (['private-project.'.$w->ops->id, 'private-work-item.'.$item->id] as $channel) {
        $response = $listen($channel);
        in_array($column, $readers, true) ? $response->assertOk() : $refused($response);
    }
})->with(MatrixWorld::COLUMNS);

it('lets everyone who sees an item listen to it', function (string $column) use ($listen, $refused) {
    $w = MatrixWorld::build();
    $this->actingAs($w->account($column));

    $response = $listen('private-work-item.'.$w->item($column)->id);

    if (in_array($column, LIVE_READERS, true)) {
        expect($response->assertOk()->json('auth'))->toStartWith('live-key:');
    } else {
        $refused($response);
    }
})->with(MatrixWorld::COLUMNS);

it('lets a person join only their own channel, present under their id', function (string $column) use ($listen, $refused) {
    $w = MatrixWorld::build();
    $account = $w->account($column);
    $this->actingAs($account);

    $own = $listen('presence-user.'.$account->id);

    if ($column === 'default_bot') {
        $refused($own);
    } else {
        expect(json_decode($own->assertOk()->json('channel_data'), true))->toBe(['user_id' => $account->id, 'user_info' => ['id' => $account->id]]);
    }

    $refused($listen('presence-user.'.$w->target->id));
    $refused($listen('private-user.'.$w->target->id));
})->with(MatrixWorld::COLUMNS);

it('lets a viewer hear the pages of a public project, on the channel of the project (A318)', function (string $column) use ($listen) {
    $w = MatrixWorld::build();
    $page = Page::factory()->create(['project_id' => $w->web->id]);
    $this->actingAs($w->account($column));

    // the viewer of WEB and the outsider who reads the public project: both read its pages and hear them change
    expect($listen('private-project.'.$w->web->id)->assertOk()->json('auth'))->toStartWith('live-key:')
        ->and(GetPage::run(actor($w->account($column)), $page)->id)->toBe($page->id);
})->with(['project_viewer', 'outsider_public']);

it('refuses the channels of a project being deleted', function () use ($listen, $refused) {
    $w = MatrixWorld::build();
    $item = $w->item('org_admin');
    $w->web->forceFill(['deleting_at' => now()])->save();
    $this->actingAs($w->account('org_admin'));

    $refused($listen('private-project.'.$w->web->id));
    $refused($listen('private-work-item.'.$item->id));
});

it('answers 403 for an unknown project id', function () use ($listen, $refused) {
    $w = MatrixWorld::build();
    $this->actingAs($w->account('org_admin'));

    foreach ([(string) Str::ulid(), 'WEB', strtoupper($w->web->id), $w->web->id.'x', ''] as $id) {
        $refused($listen('private-project.'.$id));
        $refused($listen('private-work-item.'.$id));
    }

    $refused($listen('presence-user.'.strtoupper($w->account('org_admin')->id)));
    $refused($listen('private-unknown.'.$w->web->id));
});

it('refuses a project after the account left it', function () use ($listen, $refused) {
    $w = MatrixWorld::build();
    $member = $w->account('project_member');

    $this->actingAs($member);
    $listen('private-project.'.$w->ops->id)->assertOk();

    app(RoleAssignments::class)->removeFromProject($member, $w->ops);
    Visibility::forget();
    $refused($listen('private-project.'.$w->ops->id));
});

it('refuses a project after it turned private', function () use ($listen, $refused) {
    $w = MatrixWorld::build();
    $item = $w->item('outsider_public');

    $this->actingAs($w->account('outsider_public'));
    $listen('private-work-item.'.$item->id)->assertOk();

    $w->web->update(['visibility' => ProjectVisibility::Private]);
    Visibility::forget();
    $refused($listen('private-project.'.$w->web->id));
    $refused($listen('private-work-item.'.$item->id));
});

it('refuses an account that was disabled', function () use ($listen) {
    $w = MatrixWorld::build();
    $member = $w->account('project_member');
    $member->forceFill(['disabled_at' => now()])->save();

    // the session ends on this request (EnsureAccountIsActive), before any channel is asked
    $this->actingAs($member);
    $listen('private-project.'.$w->web->id)->assertRedirect(route('login'));

    // and the channels themselves refuse it, should a request get that far
    expect(app(ProjectChannel::class)->join($member, $w->web->id))->toBeFalse()
        ->and(app(WorkItemChannel::class)->join($member, $w->item('project_member')->id))->toBeFalse()
        ->and(app(UserChannel::class)->join($member, $member->id))->toBeFalse();
});

it('refuses a bot, even its own channel', function () {
    $w = MatrixWorld::build();
    $bot = User::defaultBot();

    expect(app(ProjectChannel::class)->join($bot, $w->web->id))->toBeFalse()
        ->and(app(WorkItemChannel::class)->join($bot, $w->item('org_admin')->id))->toBeFalse()
        ->and(app(UserChannel::class)->join($bot, $bot->id))->toBeFalse();
});

it('needs a session', function () use ($listen) {
    $w = MatrixWorld::build();

    $listen('private-project.'.$w->web->id)->assertUnauthorized()->assertHeader('Content-Type', 'application/json');
    $listen('presence-user.'.$w->target->id)->assertUnauthorized();
});

it('refuses a token', function () {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $item = WorkItem::factory()->create(['project_id' => $w->web->id]);

    // A283: tokens subscribe to no channel, whatever they may do over REST
    foreach (['private-project.'.$w->web->id, 'private-work-item.'.$item->id, 'presence-user.'.$admin->id] as $channel) {
        $this->withToken(apiToken($admin, ['read', 'write', 'mcp']))
            ->postJson('/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel])
            ->assertUnauthorized()->assertHeader('Content-Type', 'application/json');
    }
});

it('refuses channels of another kind than the three, and a socket id of another form, with 403 (T9-M1, T9-M2)', function () use ($refused) {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $this->actingAs($admin);
    $ask = fn (string $channel, string $socket = '1234.5678') => test()->postJson('/broadcasting/auth', ['socket_id' => $socket, 'channel_name' => $channel]);

    // the channels the app has, as another kind: Reverb would sign them all the same
    $refused($ask('presence-project.'.$w->project('org_admin')->id));
    $refused($ask('private-user.'.$admin->id));
    $refused($ask('project.'.$w->project('org_admin')->id));
    // a socket id Pusher would not sign: refused, not a 500 that is reported
    $refused($ask('private-project.'.$w->project('org_admin')->id, 'abc'));
    $refused(test()->postJson('/broadcasting/auth', ['socket_id' => ['1.2'], 'channel_name' => 'presence-user.'.$admin->id]));
    $refused(test()->postJson('/broadcasting/auth', ['socket_id' => '1.2']));
});
