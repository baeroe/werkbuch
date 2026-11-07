<?php

use App\Access\ProjectRole;
use App\Models\Invitation;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\User;
use App\Support\InvitationLinks;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `people` / `manage-people` (phase 13, task 5b; K6): accounts, bots, invitations and tokens over MCP. That
 * every action answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets:
 * a list filter as a list, the session-only rules that no tool opens, and the refusal of a member.
 */

it('turns a list filter into the comma form of the query', function () {
    $mara = User::factory()->create();
    $bot = User::factory()->bot()->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $both = $mcp->call('people', ['action' => 'list-users', 'filter' => ['type' => ['person', 'bot']], 'per_page' => 100]);
    $bots = $mcp->call('people', ['action' => 'list-users', 'filter' => ['type' => ['bot']], 'per_page' => 100]);

    expect($both['isError'])->toBeFalse((string) json_encode($both));
    $types = array_values(array_unique(array_column($both['structuredContent']['data'], 'type')));
    sort($types);
    expect($types)->toBe(['bot', 'person'])
        ->and(array_column($both['structuredContent']['data'], 'id'))->toContain($mara->id, $bot->id)
        ->and(array_values(array_unique(array_column($bots['structuredContent']['data'], 'type'))))->toBe(['bot']);
});

it('refuses a new e-mail address from a token, as the session-only rule says', function () {
    $admin = User::factory()->admin()->create();
    $mara = User::factory()->create(['email' => 'mara-old@example.com']);
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $result = $mcp->call('manage-people', ['action' => 'update-user', 'id' => $mara->id, 'input' => ['email' => 'mara-new@example.com']]);

    expect($result['isError'])->toBeTrue()
        ->and($result['structuredContent']['status'])->toBe(403)
        ->and($result['structuredContent']['reason'])->toBe('session_required')
        ->and($mara->refresh()->email)->toBe('mara-old@example.com');

    // the name of the same account changes
    $renamed = $mcp->call('manage-people', ['action' => 'update-user', 'id' => $mara->id, 'input' => ['name' => 'Mara Neu']]);
    expect($renamed['isError'])->toBeFalse((string) json_encode($renamed))
        ->and($renamed['structuredContent']['data']['name'])->toBe('Mara Neu');
});

it('answers an invitation with the link and the invitation, as REST does', function () {
    $admin = User::factory()->admin()->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $result = $mcp->call('manage-people', ['action' => 'invite', 'input' => ['email' => 'neu@example.com', 'org_role' => 'member']]);

    expect($result['isError'])->toBeFalse((string) json_encode($result))
        ->and($result['structuredContent'])->toHaveKeys(['link', 'invitation'])
        ->and($result['structuredContent']['link'])->toStartWith(url('/invitations/'))
        ->and($result['structuredContent']['invitation']['email'])->toBe('neu@example.com')
        ->and(Invitation::query()->where('email', 'neu@example.com')->exists())->toBeTrue();
});

it('lists and revokes the own tokens, and offers no way to create one', function () {
    $mara = User::factory()->create();
    $other = User::factory()->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));
    $own = $mara->createToken('Extra', ['read'])->accessToken;
    $foreign = $other->createToken('Foreign', ['read'])->accessToken;

    $list = $mcp->call('people', ['action' => 'list-tokens']);
    $ids = array_column($list['structuredContent']['data'], 'id');
    expect($list['isError'])->toBeFalse((string) json_encode($list))
        ->and($ids)->toContain($own->id)
        ->and(in_array($foreign->id, $ids, true))->toBeFalse();

    // somebody else's token is no token of this account: 404 as over REST
    $refused = $mcp->call('manage-people', ['action' => 'revoke-token', 'id' => $foreign->id]);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(404)
        ->and(PersonalAccessToken::query()->whereKey($foreign->id)->exists())->toBeTrue();

    $revoked = $mcp->call('manage-people', ['action' => 'revoke-token', 'id' => $own->id]);
    expect($revoked['isError'])->toBeFalse((string) json_encode($revoked))
        ->and(PersonalAccessToken::query()->whereKey($own->id)->exists())->toBeFalse();

    // no tool names a way to mint a token (session only, P6); the guard in McpServerTest keeps every tool from a twin behind EnsureSession
    $names = array_column($mcp->tools(), 'name');
    expect($names)->toContain('people')->toContain('manage-people')
        ->and(str_contains(json_encode($mcp->tools()), 'create-token'))->toBeFalse();
});

it('refuses a member who changes accounts and still reads who can be mentioned', function () {
    $mara = User::factory()->create();
    $kira = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    foreach ([
        ['set-role', ['id' => $kira->id, 'input' => ['org_role' => 'admin']]],
        ['deactivate', ['id' => $kira->id]],
        ['create-bot', ['input' => ['name' => 'Bot', 'handle' => 'bot-x']]],
        ['invite', ['input' => ['email' => 'neu@example.com', 'org_role' => 'member']]],
    ] as [$action, $arguments]) {
        $result = $mcp->call('manage-people', ['action' => $action, ...$arguments]);

        expect($result['isError'])->toBeTrue($action)
            ->and($result['structuredContent']['status'])->toBe(403, $action);
    }
    expect($kira->refresh()->disabled_at)->toBeNull();

    $found = $mcp->call('people', ['action' => 'mentionable', 'project' => $web->identifier, 'q' => $mara->handle]);
    expect($found['isError'])->toBeFalse((string) json_encode($found))
        ->and(array_column($found['structuredContent']['data'], 'id'))->toContain($mara->id);
});

it('gives no invitation link to a read token, and a read token cannot invite at all', function () {
    $admin = User::factory()->admin()->create();
    $invitation = Invitation::factory()->create(['invited_by' => $admin->id]);
    $reading = McpClient::for($this, apiToken($admin, ['read', 'mcp']));
    $writing = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $read = $reading->call('people', ['action' => 'list-invitations']);
    $write = $writing->call('people', ['action' => 'list-invitations']);

    expect($read['isError'])->toBeFalse((string) json_encode($read))
        ->and(array_column($read['structuredContent']['data'], 'id'))->toContain($invitation->id)
        ->and(array_column($read['structuredContent']['data'], 'link'))->toBe([null])
        ->and(array_column($write['structuredContent']['data'], 'link'))->toBe([InvitationLinks::for($invitation)])
        // `invite` is a tool of `write`: a token without it does not know it
        ->and(array_column($reading->tools(), 'name'))->not->toContain('manage-people')
        ->and(array_column($writing->tools(), 'name'))->toContain('manage-people');
});
