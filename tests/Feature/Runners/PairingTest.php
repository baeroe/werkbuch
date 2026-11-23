<?php

use App\Actions\Runners\CreatePairingCode;
use App\Events\EventType;
use App\Models\Runner;
use App\Models\RunnerPairingCode;
use App\Models\User;
use Tests\Support\AgentWorld;

/*
 * Pairing a runner (spec 6.2, A472, A473): an org admin makes a one-time code in the session, the runner redeems it at
 * /api/runner/pair for a token of its own; an unknown, used or expired code is a clear 422.
 */

$pair = fn (string $code, array $body = []) => test()->withHeaders(['X-Werkbuch-Protocol' => '1'])->postJson('/api/runner/pair', [
    'code' => $code, 'name' => 'mac-mini-buero', 'os' => 'darwin', 'arch' => 'arm64', 'version' => '0.3.2', ...$body,
]);

it('pairs a runner with a one-time code and answers its token once', function () use ($pair) {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    $made = $this->postJson('/api/v1/runner-pairings')->assertCreated();
    $code = $made->json('data.code');
    expect($code)->toMatch('/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\z/')
        ->and($made->json('data.command'))->toBe('curl -fsSL '.config('app.url')."/runner/install.sh | sh -s -- --code {$code}")
        ->and($made->json('data.runner_id'))->toBeNull()
        ->and(RunnerPairingCode::query()->sole()->code_hash)->not->toContain($code);

    $paired = $pair(strtolower(str_replace('-', '', $code)))->assertCreated();
    $token = $paired->json('token');
    $runner = Runner::query()->sole();

    expect($token)->toStartWith('wbr_')
        ->and($runner->token_hash)->toBe(Runner::hashToken($token))
        ->and($paired->json('runner'))->toBe(['id' => $runner->id, 'name' => 'mac-mini-buero'])
        ->and($paired->json('places'))->toBe(['total' => 2, 'per_repo' => 1, 'light' => 2, 'used' => ['total' => 0, 'per_repo' => 0, 'light' => 0]])
        ->and($paired->json('version'))->toBe(config('werkbuch.version'))
        ->and($paired->json('protocol'))->toBe(1)
        ->and([$runner->os, $runner->arch, $runner->version, $runner->protocol, $runner->created_by])->toBe(['darwin', 'arm64', '0.3.2', 1, $admin->id])
        ->and(eventsOf(EventType::RunnerPaired, $runner)->sole()->actor_id)->toBe($admin->id);

    $this->getJson('/api/v1/runner-pairings/'.$made->json('data.id'))->assertOk()
        ->assertJsonPath('data.runner_id', $runner->id)->assertJsonMissingPath('data.code');
});

it('refuses an unknown, used or expired code with a clear sentence', function () use ($pair) {
    $admin = User::factory()->admin()->create();
    $code = CreatePairingCode::run(actor($admin))['code'];

    $pair('ABCD-EFGH')->assertUnprocessable()->assertJsonPath('errors.code.0', __('field.code.runner_unknown'));
    $pair('not a code')->assertUnprocessable()->assertJsonPath('errors.code.0', __('field.code.runner_unknown'));
    $pair($code)->assertCreated();
    $pair($code)->assertUnprocessable()->assertJsonPath('errors.code.0', __('field.code.runner_used'));

    $late = CreatePairingCode::run(actor($admin))['code'];
    $this->travel(11)->minutes();
    $pair($late)->assertUnprocessable()->assertJsonPath('errors.code.0', __('field.code.runner_expired'));
    $pair(CreatePairingCode::run(actor($admin))['code'], ['os' => 'windows', 'arch' => 'x86', 'version' => null])->assertUnprocessable()
        ->assertJsonValidationErrors(['os', 'arch', 'version']);
});

it('lets a new code end the ones not redeemed yet and names a second runner of one host apart', function () use ($pair) {
    $admin = User::factory()->admin()->create();
    $first = CreatePairingCode::run(actor($admin))['code'];
    $second = CreatePairingCode::run(actor($admin))['code'];

    $pair($first)->assertUnprocessable()->assertJsonPath('errors.code.0', __('field.code.runner_unknown'));
    $pair($second)->assertCreated()->assertJsonPath('runner.name', 'mac-mini-buero');
    $pair(CreatePairingCode::run(actor($admin))['code'])->assertCreated()->assertJsonPath('runner.name', 'mac-mini-buero-2');
    $pair(CreatePairingCode::run(actor($admin))['code'], ['name' => '  '])->assertCreated()->assertJsonPath('runner.name', 'runner');
});

it('makes codes only for org admins and only in the session', function () {
    $member = User::factory()->create();
    $this->actingAs($member)->postJson('/api/v1/runner-pairings')->assertForbidden();

    $admin = User::factory()->admin()->create();
    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read', 'write']))->postJson('/api/v1/runner-pairings')->assertForbidden()->assertJsonPath('reason', 'session_required');
});

it('takes only the token of an active runner on the protocol', function () {
    [$runner, $token] = AgentWorld::runner();
    $person = apiToken(User::factory()->admin()->create(), ['read', 'write']);

    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertOk();
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($person))->assertUnauthorized()->assertJsonPath('reason', 'unauthenticated');
    $this->postJson('/api/runner/claim')->assertUnauthorized();

    $runner->forceFill(['revoked_at' => now()])->save();
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertUnauthorized();
});

it('throttles a runner per runner and a stranger per address', function () {
    [, $token] = AgentWorld::runner();

    for ($i = 0; $i < 60; $i++) {
        $this->postJson('/api/runner/claim', [], ['Authorization' => 'Bearer wbr_unknown'])->assertUnauthorized();
    }
    $this->postJson('/api/runner/claim', [], ['Authorization' => 'Bearer wbr_unknown'])->assertTooManyRequests();
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertOk();

    for ($i = 0; $i < 10; $i++) {
        $this->postJson('/api/runner/pair', ['code' => 'ABCD-EFGH'])->assertUnprocessable();
    }
    $this->postJson('/api/runner/pair', ['code' => 'ABCD-EFGH'])->assertTooManyRequests();
});
