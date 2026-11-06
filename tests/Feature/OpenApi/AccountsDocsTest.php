<?php

use App\Actions\Account\ChangePassword;
use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Invitations\InviteUser;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Tokens\CreateToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Models\Project;
use App\Models\User;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;

/*
 * The account side of the document (Phase 12, Task 8): the organization, the accounts and bots, invitations, tokens
 * and the own account (`/me`, the password, the second factor). What Scramble cannot read from the actions (their
 * validation) the controllers say with `#[Body]`; this file holds that against the actions:
 *  (a) every operation, its success status and its tag are the ones the server answers,
 *  (b) the keys of a body are the ones the action reads (`FIELDS` of the action), the required ones are what it requires,
 *  (c) a client can send every key the document names (a full body per operation, `Contract::sentKeys`, K15),
 *  (d) the answers that are not `{data}` say what they are and what is shown only once.
 * The answers themselves are held against the document by the contract of every test (STRICT_TAGS).
 */

const ACCOUNT_TAGS = ['Organization', 'Users', 'Bots', 'Invitations', 'Tokens', 'Me', 'Password', 'TwoFactor'];

/** The JSON schema of the body of an operation, `$ref`s followed. */
$body = function (string $method, string $path): array {
    $schema = Document::operation($method, $path)['requestBody']['content']['application/json']['schema'] ?? [];

    return $schema;
};

/** The schema of the answer of an operation with this status, `$ref`s not followed. */
$answer = fn (string $method, string $path, int $status): array => Document::operation($method, $path)['responses'][(string) $status]['content']['application/json']['schema'] ?? [];

/** The component a `{data: <ref>}` answer names. */
$component = function (array $schema): ?string {
    $ref = $schema['properties']['data']['$ref'] ?? $schema['$ref'] ?? null;

    return is_string($ref) ? basename($ref) : null;
};

/** The operations of the account tags: `"<METHOD> <path>" => success status`. */
$operations = [
    'GET /organization' => 200, 'PATCH /organization' => 200,
    'GET /users' => 200, 'GET /users/{user}' => 200, 'PATCH /users/{user}' => 200, 'PUT /users/{user}/role' => 200,
    'POST /users/{user}/deactivate' => 200, 'POST /users/{user}/reactivate' => 200,
    'GET /bots' => 200, 'POST /bots' => 201,
    'GET /invitations' => 200, 'POST /invitations' => 201,
    'GET /tokens' => 200, 'POST /tokens' => 201, 'DELETE /tokens/{token}' => 204,
    'GET /me' => 200,
    'PUT /me/password' => 204,
    'GET /me/two-factor' => 200, 'POST /me/two-factor' => 200, 'POST /me/two-factor/confirm' => 200,
    'DELETE /me/two-factor' => 204, 'POST /me/two-factor/recovery-codes' => 200,
];

it('documents the success status the server answers for every account operation', function () use ($operations) {
    foreach ($operations as $key => $status) {
        [$method, $path] = explode(' ', $key, 2);
        $operation = Document::operation($method, $path);
        $success = array_values(array_filter(array_keys($operation['responses']), fn ($s) => (int) $s >= 200 && (int) $s < 300));
        $success = array_map('intval', $success);

        expect($success)->toBe([$status], $key)
            ->and(in_array($operation['tags'][0], ACCOUNT_TAGS, true))->toBeTrue($key);
    }

    $tagged = array_keys(array_filter(Document::operations(), fn ($op) => array_intersect($op['tags'] ?? [], ACCOUNT_TAGS) !== []));
    expect($tagged)->toEqualCanonicalizing(array_keys($operations));
});

it('names the resource every account answer carries', function () use ($answer, $component) {
    foreach ([
        'GET /organization' => 'OrganizationResource', 'PATCH /organization' => 'OrganizationResource',
        'GET /users/{user}' => 'UserResource', 'PATCH /users/{user}' => 'UserResource', 'PUT /users/{user}/role' => 'UserResource',
        'POST /users/{user}/deactivate' => 'UserResource', 'POST /users/{user}/reactivate' => 'UserResource',
        'POST /bots' => 'UserResource', 'GET /me' => 'MeResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);
        $status = $method === 'POST' && $path === '/bots' ? 201 : 200;

        expect($component($answer($method, $path, $status)))->toBe($resource, $key);
    }

    // `GET /me` is the account of `GET /users/{user}` and the rights of its role, still in `data` (P27, K17)
    $schemas = Document::get()['components']['schemas'];
    $user = $schemas['UserResource']['properties'];
    $me = $schemas['MeResource']['properties'];

    expect(array_keys($me))->toBe([...array_keys($user), 'permissions'])
        ->and($me['permissions'])->toMatchArray(['type' => 'array', 'items' => ['type' => 'string']])
        ->and($schemas['MeResource']['required'])->toContain('permissions');
});

it('describes the answers without the data wrapper', function () use ($answer) {
    $invited = $answer('POST', '/invitations', 201);
    $token = $answer('POST', '/tokens', 201);

    // `{link, invitation}`: the link is the one thing the admin copies when no mail goes out
    expect($invited['required'])->toBe(['link', 'invitation'])
        ->and($invited['properties']['link']['type'])->toBe('string')
        ->and($invited['properties']['invitation']['$ref'])->toBe('#/components/schemas/InvitationResource')
        // `{token, plain_text}`: the plain text is shown this once
        ->and($token['required'])->toBe(['token', 'plain_text'])
        ->and($token['properties']['token']['$ref'])->toBe('#/components/schemas/TokenResource')
        ->and($token['properties']['plain_text']['type'])->toBe('string')
        ->and($token['properties']['plain_text']['description'])->toContain('only');
});

it('says that a secret and recovery codes are shown once', function () use ($answer) {
    $setup = $answer('POST', '/me/two-factor', 200);
    $confirmed = $answer('POST', '/me/two-factor/confirm', 200);
    $fresh = $answer('POST', '/me/two-factor/recovery-codes', 200);
    $state = $answer('GET', '/me/two-factor', 200);

    expect($setup['properties']['secret']['type'])->toBe('string')
        ->and($setup['properties']['secret']['description'])->toContain('once')
        ->and($setup['properties']['qr_svg']['description'])->toContain('data:image/svg+xml')
        ->and($setup['required'])->toBe(['secret', 'otpauth_url', 'qr_svg'])
        ->and($confirmed['properties']['recovery_codes']['items']['type'])->toBe('string')
        ->and($confirmed['properties']['recovery_codes']['description'])->toContain('once')
        ->and($fresh['properties']['recovery_codes']['description'])->toContain('once')
        ->and($state['properties']['confirmed_at']['type'])->toBe(['string', 'null'])
        ->and($state['properties']['recovery_codes_left']['type'])->toBe('integer');
});

it('names the images as URIs and says what an upload may be', function () use ($body) {
    $schemas = Document::get()['components']['schemas'];

    // answers: the address of the picture is an absolute URI
    expect($schemas['OrganizationResource']['properties']['logo_url']['format'])->toBe('uri')
        ->and($schemas['UserResource']['properties']['avatar_url']['format'])->toBe('uri');

    // requests: a data URL (or the address that came back) or null to remove the picture
    foreach ([['PATCH', '/organization', 'logo_url'], ['PATCH', '/users/{user}', 'avatar_url']] as [$method, $path, $field]) {
        $property = $body($method, $path)['properties'][$field];

        expect($property['type'])->toBe(['string', 'null'])
            ->and($property['format'])->toBe('uri')
            ->and($property['description'])->toContain('data:image/png;base64')
            ->and($property['description'])->toContain('PNG, JPEG, WebP')
            ->and($property['description'])->toContain('2 MB')
            ->and($property['description'])->toContain('4096');
    }
});

it('says in the text of PATCH /users/{user} that a new e-mail address takes the session', function () {
    $operation = Document::operation('PATCH', '/users/{user}');

    // the route takes tokens (x-werkbuch-session-only stays false), the action refuses the e-mail field (A55)
    expect($operation)->not->toHaveKey('x-werkbuch-session-only')
        ->and($operation['description'])->toContain('e-mail address')
        ->and($operation['description'])->toContain('session_required');
});

/** Per operation with a JSON body: the action, the keys its `FIELDS` name and the required ones of the document. */
$bodies = [
    'PATCH /organization' => [UpdateOrganization::class, [], ['id']],
    'PATCH /users/{user}' => [UpdateUser::class, [], ['id', 'type', 'org_role', 'is_default_bot', 'disabled_at']],
    'PUT /users/{user}/role' => [UpdateUserRole::class, ['org_role'], []],
    'POST /bots' => [CreateBot::class, ['name', 'handle'], []],
    'POST /invitations' => [InviteUser::class, ['email', 'org_role'], []],
    'POST /tokens' => [CreateToken::class, ['name', 'abilities'], []],
    'PUT /me/password' => [ChangePassword::class, ['current_password', 'password', 'password_confirmation'], []],
    'POST /me/two-factor/confirm' => [ConfirmTwoFactor::class, ['code'], []],
];

it('documents the keys an action reads, no more and no fewer', function () use ($bodies, $body) {
    foreach ($bodies as $key => [$action, $required, $echoed]) {
        [$method, $path] = explode(' ', $key, 2);
        $schema = $body($method, $path);
        $properties = $schema['properties'];
        $read = array_keys(array_filter($properties, fn ($p) => ! ($p['readOnly'] ?? false)));
        $echo = array_keys(array_filter($properties, fn ($p) => ($p['readOnly'] ?? false) === true));

        // the keys the action reads (its FIELDS) are the writable ones; what the answer has on top and the action
        // ignores is documented read-only, so a client can send its own answer back (A75)
        expect($read)->toEqualCanonicalizing($action::FIELDS, $key)
            ->and($echo)->toEqualCanonicalizing($echoed, $key)
            ->and($schema['required'] ?? [])->toBe($required, $key)
            // K2: a body is closed only where the action refuses unknown keys with a 422; none of these does (they pass
            // over what they do not read), so every body stays open
            ->and($schema['x-werkbuch-open'] ?? false)->toBeTrue($key);
    }
});

it('takes the answer back for what the action ignores', function () use ($body) {
    // every read-only key of a body is a key of the answer it describes
    $schemas = Document::get()['components']['schemas'];

    foreach ([['PATCH', '/organization', 'OrganizationResource'], ['PATCH', '/users/{user}', 'UserResource']] as [$method, $path, $resource]) {
        foreach ($body($method, $path)['properties'] as $name => $property) {
            expect($schemas[$resource]['properties'])->toHaveKey($name);
        }
    }
});

it('lets a client send every key the document names', function () use ($bodies, $body) {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();
    $project = Project::factory()->create();
    $this->actingAs($admin);

    $organization = $this->getJson('/api/v1/organization')->assertOk()->json('data');
    $this->patchJson('/api/v1/organization', [
        'name' => 'Feldwerk', 'locale' => 'de', 'timezone' => 'Europe/Berlin', 'week_start' => 1, 'logo_url' => imageDataUrl(),
    ])->assertOk();
    $this->patchJson('/api/v1/organization', $organization)->assertOk();

    $this->patchJson("/api/v1/users/{$lene->id}", [
        'name' => 'Lene', 'handle' => 'lene-x', 'email' => 'lene-x@example.com', 'locale' => 'de', 'timezone' => 'Europe/Berlin',
        'avatar_url' => imageDataUrl(),
    ])->assertOk();
    $bot = $this->postJson('/api/v1/bots', [
        'name' => 'Kira', 'handle' => 'kira-x', 'description' => 'Writes the notes.', 'owner_id' => $admin->id,
    ])->assertCreated()->json('data');
    $this->patchJson("/api/v1/users/{$bot['id']}", [
        'name' => 'Kira', 'handle' => 'kira-x', 'description' => 'Writes more notes.', 'owner_id' => $admin->id, 'avatar_url' => null,
    ])->assertOk();
    $this->putJson("/api/v1/users/{$lene->id}/role", ['org_role' => 'admin'])->assertOk();
    $this->postJson('/api/v1/invitations', [
        'email' => 'new@example.com', 'org_role' => 'member', 'projects' => [['project_id' => $project->id, 'role' => 'member']],
    ])->assertCreated();
    $this->postJson('/api/v1/tokens', [
        'user_id' => $admin->id, 'name' => 'CI', 'abilities' => ['read', 'write'], 'expires_at' => now()->addDay()->toJSON(),
    ])->assertCreated();

    $this->putJson('/api/v1/me/password', [
        'current_password' => 'password', 'password' => 'a-new-Password-1', 'password_confirmation' => 'a-new-Password-1',
    ])->assertNoContent();

    $setup = $this->postJson('/api/v1/me/two-factor')->assertOk()->json();
    $this->postJson('/api/v1/me/two-factor/confirm', ['code' => app(Google2FA::class)->getCurrentOtp($setup['secret'])])->assertOk();

    foreach ($bodies as $key => [, , $echoed]) {
        [$method, $path] = explode(' ', $key, 2);
        $named = array_keys(array_filter($body($method, $path)['properties'], fn ($p) => ! ($p['readOnly'] ?? false)));

        expect(array_diff($named, Contract::sentKeys($method, $path)))->toBe([], "{$key} was never sent with: ".implode(', ', array_diff($named, Contract::sentKeys($method, $path))));
    }
});

it('documents the query of DELETE /me/two-factor', function () {
    $parameter = collect(Document::operation('DELETE', '/me/two-factor')['parameters'])->firstWhere('name', 'unconfirmed');

    expect($parameter['in'])->toBe('query')
        ->and($parameter['schema']['type'])->toBe('boolean')
        ->and($parameter['description'])->toContain('not confirmed');
});

it('has no body for the operations that take none', function () {
    foreach ([
        'GET /organization', 'GET /users/{user}', 'POST /users/{user}/deactivate', 'POST /users/{user}/reactivate',
        'DELETE /tokens/{token}', 'GET /me', 'GET /me/two-factor', 'POST /me/two-factor', 'DELETE /me/two-factor', 'POST /me/two-factor/recovery-codes',
    ] as $key) {
        [$method, $path] = explode(' ', $key, 2);

        expect(array_key_exists('requestBody', Document::operation($method, $path)))->toBeFalse($key);
    }
});
