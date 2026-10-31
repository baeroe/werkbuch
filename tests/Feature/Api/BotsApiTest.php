<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

it('creates a bot run by the admin who creates it', function () {
    $admin = User::factory()->admin()->create();

    $response = $this->actingAs($admin)->postJson('/api/v1/bots', ['name' => ' Kira ', 'handle' => 'kira', 'description' => ' Sortiert Tickets. '])
        ->assertCreated()
        ->assertJsonPath('data.type', 'bot')->assertJsonPath('data.name', 'Kira')->assertJsonPath('data.handle', 'kira')
        ->assertJsonPath('data.description', 'Sortiert Tickets.')->assertJsonPath('data.owner_id', $admin->id)
        ->assertJsonPath('data.email', null)->assertJsonPath('data.org_role', 'member')
        ->assertJsonPath('data.is_default_bot', false)->assertJsonPath('data.disabled_at', null)->assertJsonPath('data.avatar_url', null);

    $bot = User::query()->findOrFail($response->json('data.id'));
    expect($bot->isBot())->toBeTrue()->and($bot->password)->toBeNull()
        ->and(Visibility::orgRole($bot))->toBe(OrgRole::Member)
        ->and(Event::query()->where('type', EventType::BotCreated)->where('subject_id', $bot->id)->sole()->actor_id)->toBe($admin->id);
});

it('takes another active person as the responsible one, and a bot without a description', function () {
    $lene = User::factory()->create();

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/bots', ['name' => 'Kira', 'handle' => 'kira', 'owner_id' => $lene->id])
        ->assertCreated()->assertJsonPath('data.owner_id', $lene->id)->assertJsonPath('data.description', '');
});

it('stores the responsible person in lower case, whatever case it came in', function () {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();

    $id = $this->actingAs($admin)->postJson('/api/v1/bots', ['name' => 'Kira', 'handle' => 'kira', 'owner_id' => strtoupper($lene->id)])
        ->assertCreated()->assertJsonPath('data.owner_id', $lene->id)->json('data.id');

    // the same person in upper case is no change
    $this->patchJson("/api/v1/users/{$id}", ['owner_id' => strtoupper($lene->id)])->assertOk()->assertJsonPath('data.owner_id', $lene->id);

    expect(User::query()->findOrFail($id)->owner_id)->toBe($lene->id)
        ->and(Event::query()->where('type', EventType::UserUpdated)->where('subject_id', $id)->count())->toBe(0);
});

it('wants an active person as the responsible one', function (Closure $owner) {
    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/bots', ['name' => 'Kira', 'handle' => 'kira', 'owner_id' => $owner()])
        ->assertUnprocessable()->assertJsonPath('errors.owner_id', [__('field.owner_id.invalid')]);

    expect(User::query()->where('handle', 'kira')->exists())->toBeFalse();
})->with([
    'a bot' => [fn () => User::factory()->bot()->create()->id],
    'a deactivated person' => [fn () => User::factory()->disabled()->create()->id],
    'nobody' => [fn () => '01JAAAAAAAAAAAAAAAAAAAAAAA'],
    'no text' => [fn () => ['x']],
]);

it('wants a name and a free, valid handle', function () {
    app()->setLocale('de');
    User::factory()->create(['handle' => 'kira']);

    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/bots', ['name' => ' ', 'handle' => 'kira', 'description' => str_repeat('x', 501)])
        ->assertUnprocessable()
        ->assertJsonPath('errors.name', ['Der Name darf nicht leer sein.'])
        ->assertJsonPath('errors.handle', ['Dieses Kürzel ist schon vergeben.'])
        ->assertJsonPath('errors.description', ['Die Beschreibung darf höchstens 500 Zeichen haben.']);

    $this->postJson('/api/v1/bots', ['description' => ['x']])->assertUnprocessable()
        ->assertJsonPath('errors.handle', ['Das Kürzel hat 3 bis 32 Zeichen: a–z, 0–9 und -.'])
        ->assertJsonPath('errors.description', ['Die Beschreibung muss ein Text sein.']);
});

it('lets only org admins create bots', function () {
    app()->setLocale('de');

    $this->actingAs(User::factory()->create())->postJson('/api/v1/bots', ['name' => 'Kira', 'handle' => 'kira'])
        ->assertForbidden()->assertJsonPath('detail', 'Bots anlegen nur Org-Admins.');

    expect(User::query()->where('handle', 'kira')->exists())->toBeFalse();
});

it('lists only the bots', function () {
    $mara = User::factory()->admin()->create();
    $kira = User::factory()->bot($mara)->create();

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/bots?type=person&per_page=1')->assertOk()
        ->assertJsonPath('meta.total', 2)->assertJsonPath('meta.per_page', 1);

    $next = $this->getJson('/api/v1/bots?per_page=1&cursor='.$response->json('meta.next_cursor'))->assertOk();
    expect(collect([...$response->json('data'), ...$next->json('data')])->pluck('id')->sort()->values()->all())
        ->toBe(collect([User::defaultBot()->id, $kira->id])->sort()->values()->all());
});

it('lets an org admin change the description and the responsible person of a bot', function () {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();
    $kira = User::factory()->bot($admin)->create(['description' => 'Alt']);

    $this->actingAs($admin)->patchJson("/api/v1/users/{$kira->id}", ['description' => 'Neu', 'owner_id' => $lene->id])
        ->assertOk()->assertJsonPath('data.description', 'Neu')->assertJsonPath('data.owner_id', $lene->id);

    expect(Event::query()->where('type', EventType::UserUpdated)->sole()->changes)->toBe([
        'description' => ['old' => 'Alt', 'new' => 'Neu'],
        'owner_id' => ['old' => $admin->id, 'new' => $lene->id],
    ]);
});

it('lets a bot change its own name, but not what only org admins set', function () {
    app()->setLocale('de');
    $kira = User::factory()->bot(User::factory()->create())->create(['name' => 'Kira']);
    $this->withToken(apiToken($kira, ['write']));

    $this->patchJson("/api/v1/users/{$kira->id}", ['name' => 'Kira 2'])->assertOk()->assertJsonPath('data.name', 'Kira 2');
    $this->patchJson("/api/v1/users/{$kira->id}", ['description' => 'Kann alles.'])
        ->assertForbidden()->assertJsonPath('detail', 'Beschreibung und verantwortliche Person eines Bots ändern nur Org-Admins.');
    $this->patchJson("/api/v1/users/{$kira->id}", ['owner_id' => null])->assertForbidden();
});

it('lets a bot send its description and responsible person back unchanged', function () {
    $owner = User::factory()->create();
    $kira = User::factory()->bot($owner)->create(['name' => 'Kira', 'description' => 'Sortiert Tickets.']);
    $this->withToken(apiToken($kira, ['write']));

    $this->patchJson("/api/v1/users/{$kira->id}", ['name' => 'Kira 2', 'description' => ' Sortiert Tickets. ', 'owner_id' => strtoupper($owner->id)])
        ->assertOk()->assertJsonPath('data.name', 'Kira 2');

    expect(Event::query()->where('type', EventType::UserUpdated)->sole()->changes)->toBe(['name' => ['old' => 'Kira', 'new' => 'Kira 2']]);
});

it('gives bots no e-mail address', function () {
    $kira = User::factory()->bot()->create();

    $this->actingAs(User::factory()->admin()->create())->patchJson("/api/v1/users/{$kira->id}", ['email' => 'kira@example.com'])
        ->assertUnprocessable()->assertJsonPath('errors.email', [__('field.email.bots')]);
});

it('wants an active person as the responsible one of a bot when it changes', function () {
    $kira = User::factory()->bot()->create();

    $this->actingAs(User::factory()->admin()->create())->patchJson("/api/v1/users/{$kira->id}", ['owner_id' => User::factory()->disabled()->create()->id])
        ->assertUnprocessable()->assertJsonPath('errors.owner_id', [__('field.owner_id.invalid')]);
});

it('lets the default bot be renamed and given an avatar', function () {
    $bot = User::defaultBot();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->patchJson("/api/v1/users/{$bot->id}", ['name' => 'Werkbot', 'avatar_url' => imageDataUrl(), 'owner_id' => null])
        ->assertOk()->assertJsonPath('data.name', 'Werkbot')->assertJsonPath('data.is_default_bot', true);

    expect($response->json('data.avatar_url'))->toBe(url('/media/'.Media::query()->sole()->uuid));
});

it('keeps the default bot an admin', function (string $role) {
    app()->setLocale('de');
    $bot = User::defaultBot();

    $this->actingAs(User::factory()->admin()->create())->putJson("/api/v1/users/{$bot->id}/role", ['org_role' => $role])
        ->assertConflict()->assertJsonPath('reason', 'default_bot')->assertJsonPath('detail', 'Der Standard-Bot hat immer die Rolle Admin.');

    expect(Visibility::orgRole($bot))->toBe(OrgRole::Admin)
        ->and(Event::query()->where('type', EventType::UserRoleChanged)->count())->toBe(0);
})->with(['member', 'admin']);
