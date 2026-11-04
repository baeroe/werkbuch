<?php

use App\Http\Controllers\ChannelBatchController;
use App\Models\User;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Access\MatrixWorld;

/*
 * `POST /broadcasting/batch` (A305): the channels of a tab in one request, each answered as /broadcasting/auth answers
 * it alone (ChannelAuthorizationTest holds the rules of the channels themselves).
 */

beforeEach(fn () => liveChannels());

$batch = fn (array $channels, mixed $socket = '1234.5678'): TestResponse => test()->postJson('/broadcasting/batch', ['socket_id' => $socket, 'channel_names' => $channels]);

it('answers every channel as /broadcasting/auth answers it alone', function (string $column) use ($batch) {
    $w = MatrixWorld::build();
    $account = $w->account($column);
    $this->actingAs($account);
    $channels = [
        'presence-user.'.$account->id,
        'presence-user.'.$w->target->id,
        'private-project.'.$w->web->id,
        'private-project.'.$w->ops->id,
        'private-work-item.'.$w->item($column)->id,
    ];

    $answers = $batch($channels)->assertOk()->json('channels');

    expect(array_keys($answers))->toBe($channels);
    foreach ($channels as $channel) {
        $alone = test()->postJson('/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel]);
        if ($alone->status() === 403) {
            expect($answers[$channel])->toBe(['refused' => true]);
        } else {
            expect($answers[$channel])->toBe($alone->assertOk()->json());
        }
    }
})->with(MatrixWorld::COLUMNS);

it('signs the own channel with its presence data next to a refused one', function () use ($batch) {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $this->actingAs($admin);

    $answers = $batch(['presence-user.'.$admin->id, 'private-user.'.$admin->id, 'project.'.$w->web->id])->assertOk()->json('channels');

    expect($answers['presence-user.'.$admin->id]['auth'])->toStartWith('live-key:')
        ->and(json_decode($answers['presence-user.'.$admin->id]['channel_data'], true))->toBe(['user_id' => $admin->id, 'user_info' => ['id' => $admin->id]])
        // channels of another kind than the three are refused, as GuardChannelAuthorization refuses them alone
        ->and($answers['private-user.'.$admin->id])->toBe(['refused' => true])
        ->and($answers['project.'.$w->web->id])->toBe(['refused' => true]);
});

it('takes up to MAX channels and refuses a body of another form with 403', function () use ($batch) {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $this->actingAs($admin);
    $many = array_map(fn (int $n) => 'private-project.'.$w->web->id.$n, range(1, ChannelBatchController::MAX));

    expect($batch($many)->assertOk()->json('channels'))->toHaveCount(ChannelBatchController::MAX);

    $refused = fn (TestResponse $response) => $response->assertForbidden()->assertHeader('Content-Type', 'application/json')->assertJsonMissingPath('channels');
    $refused($batch([...$many, 'presence-user.'.$admin->id]));
    $refused($batch([]));
    $refused($batch(['a' => 'presence-user.'.$admin->id]));
    $refused($batch(['presence-user.'.$admin->id, ['private-project.'.$w->web->id]]));
    $refused($batch(['presence-user.'.$admin->id], 'abc'));
    $refused($batch(['presence-user.'.$admin->id], ['1.2']));
    $refused(test()->postJson('/broadcasting/batch', ['socket_id' => '1.2', 'channel_names' => 'presence-user.'.$admin->id]));
    $refused(test()->postJson('/broadcasting/batch', ['socket_id' => '1.2']));
});

it('takes JSON only: a form body or a query never smuggles in another channel name', function () {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $this->actingAs($admin);
    $own = 'presence-user.'.$admin->id;

    $this->post('/broadcasting/batch', ['socket_id' => '1.2', 'channel_names' => [$own], 'channel_name' => 'private-user.'.$admin->id], ['Accept' => 'application/json'])
        ->assertForbidden()->assertJsonMissingPath('channels');

    $answers = test()->postJson('/broadcasting/batch?channel_name=private-user.'.$admin->id, ['socket_id' => '1.2', 'channel_names' => [$own]])->assertOk()->json('channels');
    expect(array_keys($answers))->toBe([$own])
        ->and(json_decode($answers[$own]['channel_data'], true)['user_id'])->toBe($admin->id)
        ->and($answers[$own]['auth'])->toBe(test()->postJson('/broadcasting/auth', ['socket_id' => '1.2', 'channel_name' => $own])->json('auth'));
});

it('keeps the flash data of the session, as /broadcasting/auth does', function () use ($batch) {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $this->actingAs($admin);
    $this->withSession(['_flash' => ['old' => ['status'], 'new' => []], 'status' => 'saved']);

    $batch(['presence-user.'.$admin->id])->assertOk();

    expect(session('_flash.old'))->toContain('status')->and(session('status'))->toBe('saved');
});

it('needs a session of an active account, never a token (A283)', function () use ($batch) {
    $w = MatrixWorld::build();
    $admin = $w->account('org_admin');
    $channels = ['presence-user.'.$admin->id, 'private-project.'.$w->web->id];

    $batch($channels)->assertUnauthorized()->assertHeader('Content-Type', 'application/json');
    $this->withToken(apiToken($admin, ['read', 'write', 'mcp']))->postJson('/broadcasting/batch', ['socket_id' => '1234.5678', 'channel_names' => $channels])
        ->assertUnauthorized();

    forgetApiAuth();
    $member = $w->account('project_member');
    $member->forceFill(['disabled_at' => now()])->save();
    $this->actingAs($member);
    $batch(['presence-user.'.$member->id])->assertRedirect(route('login'));
});

it('refuses every channel while no broadcaster signs them', function () use ($batch) {
    $admin = User::factory()->admin()->create();
    config(['broadcasting.default' => 'null']);
    app(BroadcastManager::class)->forgetDrivers();
    $this->actingAs($admin);

    expect($batch(['presence-user.'.$admin->id])->assertOk()->json('channels'))->toBe(['presence-user.'.$admin->id => ['refused' => true]]);
});
