<?php

use App\Actions\Tokens\CreateToken;
use App\Events\EventType;
use App\Models\Event;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\Auth;

/*
 * API tokens (spec 4.2): name, abilities `read`, `write`, `mcp`, an optional expiry, „last used“; the plain text once.
 * People manage their own, org admins also those of the bots.
 */

it('shows the plain text exactly once', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);

    $created = $this->postJson('/api/v1/tokens', ['name' => ' Claude Code ', 'abilities' => ['read']])->assertCreated()
        ->assertJsonPath('token.user_id', $lene->id)->assertJsonPath('token.name', 'Claude Code')
        ->assertJsonPath('token.abilities', ['read'])->assertJsonPath('token.expires_at', null)->assertJsonPath('token.last_used_at', null)
        ->json();
    [$id, $secret] = explode('|', $created['plain_text'], 2);

    expect($id)->toBe($created['token']['id'])
        ->and($secret)->toStartWith('wb_')
        ->and(array_keys($created['token']))->toBe(['id', 'user_id', 'name', 'abilities', 'expires_at', 'last_used_at', 'created_at']);

    $list = $this->getJson('/api/v1/tokens')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $id);
    expect($list->getContent())->not->toContain($secret)
        ->and(array_keys($list->json('data.0')))->toBe(array_keys($created['token']));
});

it('orders the abilities, drops repeats and never grants everything', function () {
    $lene = User::factory()->create();

    $this->actingAs($lene)->postJson('/api/v1/tokens', ['name' => 'CI', 'abilities' => ['mcp', 'read', 'mcp', 'write']])
        ->assertCreated()->assertJsonPath('token.abilities', ['read', 'write', 'mcp']);

    expect(PersonalAccessToken::query()->sole()->abilities)->toBe(['read', 'write', 'mcp']);
});

it('wants a name, known abilities and an expiry in the future', function (array $input, array $errors) {
    app()->setLocale('de');
    $this->freezeSecond();

    $response = $this->actingAs(User::factory()->create())->postJson('/api/v1/tokens', $input)->assertUnprocessable();

    foreach ($errors as $field => $message) {
        $response->assertJsonPath("errors.{$field}", [$message]);
    }
    expect(PersonalAccessToken::query()->count())->toBe(0);
})->with([
    'nothing' => [[], ['name' => 'Der Name darf nicht leer sein.', 'abilities' => 'Wähle mindestens eine Fähigkeit.']],
    'blank name, no abilities' => [['name' => '  ', 'abilities' => []], ['name' => 'Der Name darf nicht leer sein.', 'abilities' => 'Wähle mindestens eine Fähigkeit.']],
    'long name' => [['name' => str_repeat('x', 121), 'abilities' => ['read']], ['name' => 'Der Name darf höchstens 120 Zeichen haben.']],
    'name no text' => [['name' => ['x'], 'abilities' => ['read']], ['name' => 'Der Name muss ein Text sein.']],
    'unknown ability' => [['name' => 'CI', 'abilities' => ['read', 'admin']], ['abilities' => 'Wähle mindestens eine Fähigkeit.']],
    'everything' => [['name' => 'CI', 'abilities' => ['*']], ['abilities' => 'Wähle mindestens eine Fähigkeit.']],
    'abilities no list' => [['name' => 'CI', 'abilities' => 'read'], ['abilities' => 'Wähle mindestens eine Fähigkeit.']],
    'past expiry' => [['name' => 'CI', 'abilities' => ['read'], 'expires_at' => '2020-01-01T00:00:00Z'], ['expires_at' => 'Das Ablaufdatum muss in der Zukunft liegen.']],
    'expiry no date' => [['name' => 'CI', 'abilities' => ['read'], 'expires_at' => 'tomorrow-ish'], ['expires_at' => 'Das Ablaufdatum muss in der Zukunft liegen.']],
]);

it('lets a token that may read only read, and one that may write write', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $read = $this->postJson('/api/v1/tokens', ['name' => 'Lesen', 'abilities' => ['read']])->json('plain_text');
    $write = $this->postJson('/api/v1/tokens', ['name' => 'Schreiben', 'abilities' => ['write']])->json('plain_text');
    Auth::forgetGuards();

    $this->withToken($read)->getJson('/api/v1/organization')->assertOk();
    $this->withToken($read)->patchJson("/api/v1/users/{$lene->id}", ['name' => 'Lene'])->assertForbidden();
    forgetApiAuth();
    $this->withToken($write)->patchJson("/api/v1/users/{$lene->id}", ['name' => 'Lene'])->assertOk();
    $this->withToken($write)->getJson('/api/v1/organization')->assertForbidden();
});

it('refuses a token after its expiry and notes when a token was last used', function () {
    $this->freezeSecond();
    $lene = User::factory()->create();
    $plain = $this->actingAs($lene)->postJson('/api/v1/tokens', ['name' => 'CI', 'abilities' => ['read'], 'expires_at' => now()->addDay()->toJSON()])
        ->assertCreated()->assertJsonPath('token.expires_at', now()->addDay()->toJSON())->json('plain_text');
    Auth::forgetGuards();

    $this->withToken($plain)->getJson('/api/v1/organization')->assertOk();
    expect(PersonalAccessToken::query()->sole()->last_used_at?->toJSON())->toBe(now()->toJSON());
    $this->actingAs($lene)->getJson('/api/v1/tokens')->assertJsonPath('data.0.last_used_at', now()->toJSON());

    $this->travel(2)->days();
    forgetApiAuth();
    $this->withToken($plain)->getJson('/api/v1/organization')->assertUnauthorized();
});

it('lets people manage only their own tokens', function () {
    $lene = User::factory()->create();
    $ida = User::factory()->create();
    $token = $ida->createToken('Idas', ['read'])->accessToken;
    $this->actingAs($lene);

    $this->getJson("/api/v1/tokens?user_id={$ida->id}")->assertForbidden()->assertJsonPath('detail', __('problem.detail.tokens_own_or_bots'));
    $this->postJson('/api/v1/tokens', ['user_id' => $ida->id, 'name' => 'CI', 'abilities' => ['read']])->assertForbidden();
    $this->deleteJson("/api/v1/tokens/{$token->id}")->assertForbidden();
    // the bots are an admin's, even the one a person runs
    $this->getJson('/api/v1/tokens?user_id='.User::factory()->bot($lene)->create()->id)->assertForbidden();

    expect($ida->tokens()->count())->toBe(1);
});

it('lets org admins manage the tokens of bots and of the default bot, not those of other people', function () {
    $admin = User::factory()->admin()->create();
    $kira = User::factory()->bot()->create();
    $this->actingAs($admin);

    foreach ([$kira, User::defaultBot()] as $bot) {
        $id = $this->postJson('/api/v1/tokens', ['user_id' => $bot->id, 'name' => 'Bot', 'abilities' => ['read', 'mcp']])
            ->assertCreated()->assertJsonPath('token.user_id', $bot->id)->json('token.id');
        $this->getJson("/api/v1/tokens?user_id={$bot->id}")->assertOk()->assertJsonPath('data.0.id', $id);
        $this->deleteJson("/api/v1/tokens/{$id}")->assertNoContent();
    }

    $lene = User::factory()->create();
    $this->getJson("/api/v1/tokens?user_id={$lene->id}")->assertForbidden();
    $this->postJson('/api/v1/tokens', ['user_id' => $lene->id, 'name' => 'CI', 'abilities' => ['read']])->assertForbidden();
});

it('lists only the tokens of one account, oldest first', function () {
    $lene = User::factory()->create();
    $first = $lene->createToken('Eins', ['read'])->accessToken;
    $second = $lene->createToken('Zwei', ['write'])->accessToken;
    User::factory()->create()->createToken('Fremd', ['read']);

    $this->actingAs($lene)->getJson("/api/v1/tokens?user_id={$lene->id}")->assertOk()
        ->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.id', $first->id)->assertJsonPath('data.1.id', $second->id);
});

it('answers 404 for an unknown account', function (mixed $id) {
    $this->actingAs(User::factory()->create())->getJson('/api/v1/tokens?'.http_build_query(['user_id' => $id]))->assertNotFound();
    $this->postJson('/api/v1/tokens', ['user_id' => $id, 'name' => 'CI', 'abilities' => ['read']])->assertNotFound();
})->with(['unknown' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'a list' => [['x']]]);

it('creates no token for a deactivated account', function () {
    $kira = User::factory()->bot()->disabled()->create();

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/tokens', ['user_id' => $kira->id, 'name' => 'CI', 'abilities' => ['read']])
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.token_disabled_owner'));

    expect($kira->tokens()->count())->toBe(0);
});

it('revokes a token, which then gets 401, and notes both steps', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $created = $this->postJson('/api/v1/tokens', ['name' => 'CI', 'abilities' => ['read']])->json();
    Auth::forgetGuards();
    $this->withToken($created['plain_text'])->getJson('/api/v1/organization')->assertOk();

    forgetApiAuth();
    $this->actingAs($lene)->deleteJson("/api/v1/tokens/{$created['token']['id']}")->assertNoContent();
    forgetApiAuth();

    $this->withToken($created['plain_text'])->getJson('/api/v1/organization')->assertUnauthorized();
    $events = Event::query()->whereIn('type', [EventType::TokenCreated, EventType::TokenRevoked])->orderBy('occurred_at')->get();
    expect($events->map(fn (Event $event) => [$event->type->value, $event->actor_id, $event->subject_type, $event->subject_id])->all())->toBe([
        ['token.created', $lene->id, 'token', $created['token']['id']],
        ['token.revoked', $lene->id, 'token', $created['token']['id']],
    ])->and(json_encode($events->toArray()))->not->toContain(explode('|', $created['plain_text'])[1]);
});

it('answers 404 for an unknown token', function () {
    $this->actingAs(User::factory()->create())->deleteJson('/api/v1/tokens/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertNotFound();
});

it('can be managed with a token that may write', function () {
    $lene = User::factory()->create();
    $plain = apiToken($lene, ['write']);

    $this->withToken($plain)->postJson('/api/v1/tokens', ['name' => 'CI', 'abilities' => ['read']])->assertCreated();

    expect(Event::query()->where('type', EventType::TokenCreated)->sole()->meta)->toMatchArray(['via' => 'api']);
});

it('passes the abilities to Sanctum explicitly', function () {
    $lene = User::factory()->create();

    $token = CreateToken::run(actor($lene), $lene, ['name' => 'CI', 'abilities' => ['write']])->accessToken;

    expect($token->abilities)->toBe(['write'])->and($token->can('read'))->toBeFalse()->and($token->can('*'))->toBeFalse();
});
