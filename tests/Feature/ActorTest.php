<?php

use App\Models\Template;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\TransientToken;

beforeEach(function () {
    Route::middleware('auth:sanctum')->get('_t/actor', function (Request $request) {
        $actor = Actor::fromRequest($request);

        return [
            'user' => $actor->user->id, 'via' => $actor->via, 'token' => $actor->token?->id, 'socket' => $actor->socket, 'meta' => $actor->meta(),
        ];
    });
});

it('acts in the interface for a signed-in session, without a token', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->getJson('/_t/actor')
        ->assertExactJson(['user' => $user->id, 'via' => 'ui', 'token' => null, 'socket' => null, 'meta' => ['via' => 'ui', 'reason' => null]]);
});

it('keeps the socket of the interface (A282)', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->withHeader('X-Socket-ID', '98765.4321')->getJson('/_t/actor')->assertExactJson([
        'user' => $user->id,
        'via' => 'ui',
        'token' => null,
        'socket' => '98765.4321',
        'meta' => ['via' => 'ui', 'reason' => null, 'socket' => '98765.4321'],
    ]);
});

it('takes no socket of another form', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->withHeader('X-Socket-ID', '98765')->getJson('/_t/actor')->assertJsonPath('socket', null)
        ->assertJsonPath('meta', ['via' => 'ui', 'reason' => null]);
});

it('takes no socket from a token', function () {
    $user = User::factory()->create();

    $this->withToken(apiToken($user, ['read']))->withHeader('X-Socket-ID', '98765.4321')->getJson('/_t/actor')
        ->assertJsonPath('via', 'api')->assertJsonPath('socket', null)->assertJsonMissingPath('meta.socket');
});

it('keeps token and socket when a reason is added', function () {
    $user = User::factory()->create();
    $token = $user->createToken('ci')->accessToken;

    $ui = (new Actor($user, Actor::VIA_UI, socket: '1.2'))->withReason('parent_deleted');
    $api = (new Actor($user, Actor::VIA_API, 'old', $token))->withReason('state_removed');

    expect($ui->meta())->toBe(['via' => 'ui', 'reason' => 'parent_deleted', 'socket' => '1.2'])
        ->and($api->meta())->toBe(['via' => 'api', 'reason' => 'state_removed', 'token_id' => $token->id])
        ->and($api->token)->toBe($token)
        ->and($api->user)->toBe($user);
});

it('acts for a template as the default bot via template', function () {
    $actor = Actor::template(Template::factory()->create());

    expect($actor->user->is(User::defaultBot()))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_TEMPLATE)
        ->and($actor->onBehalfOf)->toBeNull()
        ->and($actor->meta())->toBe(['via' => 'template', 'reason' => 'template']);
});

it('notes on_behalf_of in the meta and keeps it with another reason', function () {
    $person = User::factory()->create();
    $token = $person->createToken('ci')->accessToken;

    $actor = Actor::automation('assign_on_start')->onBehalfOf($person);
    $api = (new Actor($person, Actor::VIA_API, null, $token, '1.2'))->onBehalfOf($person)->withReason('close_parent');

    expect($actor->user->is(User::defaultBot()))->toBeTrue()
        ->and($actor->onBehalfOf)->toBe($person->id)
        ->and($actor->meta())->toBe(['via' => 'automation', 'reason' => 'assign_on_start', 'on_behalf_of' => $person->id])
        ->and($actor->withReason('close_parent')->meta())->toBe(['via' => 'automation', 'reason' => 'close_parent', 'on_behalf_of' => $person->id])
        ->and($api->meta())->toBe(['via' => 'api', 'reason' => 'close_parent', 'token_id' => $token->id, 'socket' => '1.2', 'on_behalf_of' => $person->id])
        ->and($api->token)->toBe($token);
});

it('notes quiet in the meta only when quiet, and keeps it with another reason or person (A357)', function () {
    $person = User::factory()->create();

    $night = Actor::automation('auto_close')->quietly();

    expect(Actor::automation('auto_close')->quiet)->toBeFalse()
        ->and($night->meta())->toBe(['via' => 'automation', 'reason' => 'auto_close', 'quiet' => true])
        ->and($night->withReason('close_parent')->meta())->toBe(['via' => 'automation', 'reason' => 'close_parent', 'quiet' => true])
        ->and($night->onBehalfOf($person)->meta())->toBe(['via' => 'automation', 'reason' => 'auto_close', 'on_behalf_of' => $person->id, 'quiet' => true]);
});

it('acts through the api with the bearer token', function () {
    $user = User::factory()->create();
    $token = $user->createToken('ci');

    $this->withToken($token->plainTextToken)->getJson('/_t/actor')->assertExactJson([
        'user' => $user->id,
        'via' => 'api',
        'token' => $token->accessToken->id,
        'socket' => null,
        'meta' => ['via' => 'api', 'reason' => null, 'token_id' => $token->accessToken->id],
    ]);
});

it('needs an account', function () {
    Actor::fromRequest(Request::create('/'));
})->throws(AuthenticationException::class);

it('acts through MCP with the personal access token', function () {
    $user = User::factory()->create();
    $token = $user->createToken('agent', ['read', 'mcp']);
    $user->withAccessToken($token->accessToken);
    $request = Request::create('/mcp', 'POST');
    $request->setUserResolver(fn () => $user);

    $actor = Actor::fromMcp($request);

    expect($actor->user->is($user))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_MCP)
        ->and($actor->token?->id)->toBe($token->accessToken->id)
        ->and($actor->socket)->toBeNull()
        ->and($actor->meta())->toBe(['via' => 'mcp', 'reason' => null, 'token_id' => $token->accessToken->id]);
});

it('acts through MCP only with a personal access token', function (Closure $user) {
    $request = Request::create('/mcp', 'POST');
    $request->setUserResolver($user);

    Actor::fromMcp($request);
})->with([
    'no account' => fn () => fn () => null,
    // a guard that knows the person hands Sanctum a TransientToken (K2)
    'the session' => fn () => fn () => User::factory()->create()->withAccessToken(new TransientToken),
])->throws(AuthenticationException::class);

it('lets automations act as the default bot', function () {
    $bot = User::query()->where('handle', 'automation')->sole();

    $actor = Actor::automation('Automatisierung: Auto-Archiv');

    expect($actor->user->is($bot))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_AUTOMATION)
        ->and($actor->reason)->toBe('Automatisierung: Auto-Archiv')
        ->and($actor->token)->toBeNull();
});

it('lets an automation act for the person a change came from, quiet when the change was', function () {
    $mara = User::factory()->create();
    $bot = User::factory()->bot()->create();
    $person = Actor::automationFor('link_references', actor($mara));
    $forMara = Actor::automationFor('link_references', actor($bot)->onBehalfOf($mara)->quietly());
    $forNobody = Actor::automationFor('link_references', actor($bot));

    expect($person->user->is(User::defaultBot()))->toBeTrue()
        ->and($person->meta())->toBe(['via' => 'automation', 'reason' => 'link_references', 'on_behalf_of' => $mara->id])
        ->and($forMara->meta())->toBe(['via' => 'automation', 'reason' => 'link_references', 'on_behalf_of' => $mara->id, 'quiet' => true])
        ->and($forNobody->meta())->toBe(['via' => 'automation', 'reason' => 'link_references']);
});

it('acts for the system on behalf of an account', function () {
    $user = User::factory()->create();

    $actor = Actor::system($user, 'ensure_admin');

    expect($actor->user->is($user))->toBeTrue()
        ->and($actor->via)->toBe(Actor::VIA_SYSTEM)
        ->and($actor->reason)->toBe('ensure_admin')
        ->and($actor->meta())->toBe(['via' => 'system', 'reason' => 'ensure_admin']);
});

it('names every way an action can be started', function () {
    expect([Actor::VIA_UI, Actor::VIA_API, Actor::VIA_MCP, Actor::VIA_AUTOMATION, Actor::VIA_TEMPLATE, Actor::VIA_SYSTEM])
        ->toBe(['ui', 'api', 'mcp', 'automation', 'template', 'system']);
});
