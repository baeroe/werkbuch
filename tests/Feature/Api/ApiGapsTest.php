<?php

use App\Access\Grants;
use App\Access\OrgRole;
use App\Access\Permission;
use App\Access\ProjectRole;
use App\Actions\Auth\SetPassword;
use App\Actions\Users\UpdateUser;
use App\Actions\WorkItems\CountWorkItems;
use App\Events\EventType;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\ValidationException;

/*
 * What the API still lacked against the interface and the resource list of spec 6.1, and what earlier phases noted
 * for this one (A391, A392): reading the own account, one account and one entry of every catalog; an inherited setting
 * that comes back unchanged; reset links of deactivated accounts; filters named `0`; the responsible person of a bot.
 */

/** The rights of an org role as the interface knows them (`auth.permissions`). */
$rights = fn (OrgRole $role): array => array_map(fn (Permission $p) => $p->value, Grants::of($role));

it('tells a token who it belongs to', function () use ($rights) {
    $lene = User::factory()->create(['name' => 'Lene']);
    $kira = User::factory()->bot()->create(['name' => 'Kira']);

    $mine = $this->withToken(apiToken($lene, ['read']))->getJson('/api/v1/me')->assertOk();
    $listed = collect($this->getJson('/api/v1/users')->json('data'))->firstWhere('id', $lene->id);

    // the account as every list shows it, and the rights it holds in the organization
    expect($mine->json('data'))->toBe([...$listed, 'permissions' => $rights(OrgRole::Member)])
        ->and($mine->json())->toHaveKeys(['data'])->not->toHaveKey('permissions');

    forgetApiAuth();
    $this->withToken(apiToken($kira, ['read']))->getJson('/api/v1/me')->assertOk()
        ->assertJsonPath('data.id', $kira->id)->assertJsonPath('data.type', 'bot');

    forgetApiAuth();
    $this->withToken(apiToken(User::defaultBot(), ['write']))->getJson('/api/v1/me')->assertForbidden();

    forgetApiAuth();
    $admin = User::factory()->admin()->create();
    $this->withoutToken()->actingAs($admin)->getJson('/api/v1/me')->assertOk()
        ->assertJsonPath('data.id', $admin->id)->assertJsonPath('data.permissions', $rights(OrgRole::Admin));
});

it('answers 401 for /me without an account', function () {
    $this->getJson('/api/v1/me')->assertUnauthorized();
});

it('reads one account, also by an upper-case ULID', function () {
    $lene = User::factory()->create(['name' => 'Lene']);
    $gone = User::factory()->disabled()->create();
    $this->actingAs(User::factory()->create());

    $listed = collect($this->getJson('/api/v1/users')->json('data'));

    $this->getJson("/api/v1/users/{$lene->id}")->assertOk()->assertExactJson(['data' => $listed->firstWhere('id', $lene->id)]);
    $this->getJson('/api/v1/users/'.strtoupper($lene->id))->assertOk()->assertJsonPath('data.id', $lene->id);
    // a deactivated account stays readable, as in the list
    $this->getJson("/api/v1/users/{$gone->id}")->assertOk()->assertJsonPath('data.disabled_at', $gone->disabled_at?->toJSON());

    $this->getJson('/api/v1/users/01jzzzzzzzzzzzzzzzzzzzzzzz')->assertNotFound()->assertJsonMissingPath('detail');
    $this->getJson('/api/v1/users/lene')->assertNotFound();
});

it('reads one entry of every catalog as its list shows it', function (string $path, Closure $entry) {
    $id = $entry()->id;
    // reading is for every account, as the lists
    $this->actingAs(User::factory()->create());

    $listed = collect($this->getJson("/api/v1/{$path}?per_page=100")->assertOk()->json('data'))->firstWhere('id', $id);

    expect($listed)->not->toBeNull();
    $this->getJson("/api/v1/{$path}/{$id}")->assertOk()->assertExactJson(['data' => $listed]);
    $this->getJson("/api/v1/{$path}/".strtoupper($id))->assertOk()->assertJsonPath('data.id', $id);
    $this->getJson("/api/v1/{$path}/01jzzzzzzzzzzzzzzzzzzzzzzz")->assertNotFound()->assertJsonMissingPath('detail');
})->with([
    'workflows' => ['workflows', fn () => Workflow::default()],
    'work item types' => ['work-item-types', fn () => WorkItemType::query()->where('name', 'Bug')->sole()],
    'properties' => ['properties', fn () => Property::factory()->dropdown(['Hoch', 'Tief'])->create()],
    'labels' => ['labels', fn () => Label::factory()->create()],
    'relation types' => ['relation-types', fn () => RelationType::query()->where('built_in', 'blocks')->sole()],
    'resolutions' => ['resolutions', fn () => Resolution::query()->where('default_for', 'completed')->sole()],
]);

it('keeps the inherited language when the own answer comes back', function () {
    $lene = User::factory()->create(['name' => 'Lene', 'locale' => null, 'timezone' => null]);
    $this->actingAs($lene);
    $mine = $this->getJson("/api/v1/users/{$lene->id}")->json('data');

    $this->patchJson("/api/v1/users/{$lene->id}", $mine)->assertOk()->assertExactJson(['data' => $mine]);

    $lene->refresh();
    expect($lene->locale)->toBeNull()->and($lene->timezone)->toBeNull()
        ->and(eventsOf(EventType::UserUpdated, $lene))->toBeEmpty();

    // another setting than the inherited one is the own one from then on
    $other = $mine['locale'] === 'de' ? 'en' : 'de';
    $this->patchJson("/api/v1/users/{$lene->id}", ['locale' => $other, 'timezone' => 'Asia/Kolkata'])->assertOk();
    expect($lene->fresh()?->locale?->value)->toBe($other)->and($lene->fresh()?->timezone)->toBe('Asia/Kolkata');
});

it('pins a setting the account had of its own, also when it equals the inherited one', function () {
    $lene = User::factory()->create(['locale' => 'en', 'timezone' => 'Asia/Kolkata']);
    $inherited = Organization::current()->timezone;

    UpdateUser::run(actor($lene), $lene, ['timezone' => $inherited]);

    expect($lene->fresh()?->timezone)->toBe($inherited);
});

it('drops open reset links of a deactivated account', function () {
    $lene = User::factory()->create(['email' => 'lene@example.com']);
    $erik = User::factory()->create(['email' => 'erik@example.com']);
    Password::createToken($lene);
    Password::createToken($erik);

    $this->actingAs(User::factory()->admin()->create())->postJson("/api/v1/users/{$lene->id}/deactivate")->assertOk();

    expect(DB::table('password_reset_tokens')->pluck('email')->all())->toBe(['erik@example.com']);
});

it('refuses a new password for a deactivated account', function () {
    $lene = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $token = Password::createToken($lene);
    // deactivated in a way that left the link (an account deactivated before the links went with it)
    $lene->update(['disabled_at' => now()]);

    $this->from('/reset-password/'.$token)
        ->post('/reset-password', ['token' => $token, 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertRedirect('/reset-password/'.$token)->assertSessionHasErrors(['email' => __('errors.account_disabled')]);

    expect(Hash::check('old-password', (string) $lene->fresh()?->password))->toBeTrue()
        ->and(eventsOf(EventType::UserPasswordChanged, $lene))->toBeEmpty()
        ->and(fn () => SetPassword::run($lene, 'new-password', refuseDisabled: true))->toThrow(ValidationException::class);

    // the emergency command still sets it (the sign-in stays blocked)
    SetPassword::run($lene, 'new-password');
    expect(Hash::check('new-password', (string) $lene->fresh()?->password))->toBeTrue();
});

it('counts a filter named 0 and trims its values like /query', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    WorkItem::factory()->for($web)->create(['title' => 'Hero bauen']);
    WorkItem::factory()->for($web)->create(['title' => 'Footer']);
    $titled = fn (string $text) => ['version' => 1, 'conditions' => [['field' => 'title', 'op' => 'contains', 'value' => $text]]];
    $this->actingAs($mara);

    // an object of JSON stays an object, whatever its names are
    $this->postJson('/api/v1/work-items/counts', ['filters' => (object) ['0' => $titled('  Hero '), '1' => $titled('Footer')]])
        ->assertOk()->assertExactJson(['data' => ['0' => 1, '1' => 1]]);
    $this->postJson('/api/v1/work-items/query', ['filter' => $titled('  Hero ')])->assertOk()->assertJsonCount(1, 'data');

    // a list of JSON is no object of filters
    $this->postJson('/api/v1/work-items/counts', ['filters' => [$titled('Hero')]])
        ->assertUnprocessable()->assertJsonPath('errors.filters', [__('field.filters.invalid', ['max' => CountWorkItems::MAX_FILTERS])]);

    // the action takes an object the same way, and a PHP list stays no object
    expect(CountWorkItems::run(actor($mara), ['filters' => (object) ['0' => $titled('Hero')]]))->toBe(['0' => 1])
        ->and(fn () => CountWorkItems::run(actor($mara), ['filters' => [$titled('Hero')]]))->toThrow(ValidationException::class);
});

it('names every wrong filter name', function () {
    $mara = User::factory()->create();
    $all = ['version' => 1, 'conditions' => []];

    try {
        CountWorkItems::run(actor($mara), ['filters' => ['open items' => $all, 'ok' => $all, 'a/b' => $all]]);
        $this->fail('no ValidationException');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['filters' => [__('field.filters.names', ['names' => 'open items, a/b'])]]);
    }
});

it('keeps the owner of a bot on null', function () {
    $owner = User::factory()->create();
    $kira = User::factory()->bot($owner)->create();
    $this->actingAs(User::factory()->admin()->create());

    $this->patchJson("/api/v1/users/{$kira->id}", ['owner_id' => null])
        ->assertUnprocessable()->assertJsonPath('errors.owner_id', [__('field.owner_id.required')]);
    // not named: the responsible person stays
    $this->patchJson("/api/v1/users/{$kira->id}", ['name' => 'Kira Neu'])->assertOk()->assertJsonPath('data.owner_id', $owner->id);
    expect($kira->fresh()?->owner_id)->toBe($owner->id);

    // the default bot has none: its own answer comes back unchanged
    $bot = User::defaultBot();
    $this->patchJson("/api/v1/users/{$bot->id}", $this->getJson("/api/v1/users/{$bot->id}")->json('data'))->assertOk()->assertJsonPath('data.owner_id', null);
});
