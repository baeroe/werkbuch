<?php

use App\Actions\Users\UpdateUser;
use App\Enums\Locale;
use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Spatie\MediaLibrary\MediaCollections\Exceptions\FileUnacceptableForCollection;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

/** The shape of `User` in resources/js/types.ts; bots have a description on top. */
const USER_SHAPE = ['id', 'type', 'name', 'handle', 'email', 'org_role', 'is_default_bot', 'owner_id', 'disabled_at', 'avatar_url', 'locale', 'timezone'];

/**
 * The `user.updated` events of an account.
 *
 * @return list<array<string, mixed>|null>
 */
function userUpdates(User $user): array
{
    return Event::query()->where('type', EventType::UserUpdated)->where('subject_id', $user->id)->orderBy('occurred_at')->pluck('changes')->all();
}

it('lists every account, people first, deactivated ones included', function () {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $sven = User::factory()->disabled()->create(['name' => 'Sven']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'description' => 'Sortiert Tickets.']);

    $response = $this->actingAs(User::factory()->create(['name' => 'Lene']))->getJson('/api/v1/users')->assertOk()
        ->assertJsonPath('meta.total', 5)
        ->assertJsonStructure(['data' => ['*' => USER_SHAPE], 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'total']]);

    $data = collect($response->json('data'));
    expect($data->pluck('type')->all())->toBe(['person', 'person', 'person', 'bot', 'bot'])
        ->and($data->firstWhere('id', $sven->id)['disabled_at'])->not->toBeNull()
        ->and($data->firstWhere('id', $kira->id))->toMatchArray(['description' => 'Sortiert Tickets.', 'owner_id' => $mara->id, 'email' => null])
        ->and($data->firstWhere('id', $mara->id))->toMatchArray(['org_role' => 'admin'])->not->toHaveKey('description');
});

it('lists only bots or only people', function (string $type, int $count) {
    User::factory()->count(2)->create();
    User::factory()->bot()->create();

    $response = $this->actingAs(User::factory()->create())->getJson("/api/v1/users?type={$type}")->assertOk()->assertJsonPath('meta.total', $count);

    expect(collect($response->json('data'))->pluck('type')->unique()->all())->toBe([$type]);
})->with([['bot', 2], ['person', 3]]);

it('refuses a type of account that does not exist', function (string $query) {
    $this->actingAs(User::factory()->create())->getJson("/api/v1/users?{$query}")
        ->assertUnprocessable()->assertJsonPath('errors.type.0', __('field.type.unknown'));
})->with(['type=robot', 'type[]=bot']);

it('pages through the accounts with every one exactly once, people before bots', function () {
    User::factory()->count(3)->create();
    User::factory()->count(2)->bot()->create();
    $this->actingAs(User::factory()->create());

    $seen = [];
    $pages = 0;
    $url = '/api/v1/users?per_page=2';

    while ($url !== null) {
        $response = $this->getJson($url)->assertOk()->assertJsonPath('meta.total', 7);
        array_push($seen, ...$response->json('data'));
        $pages++;
        $cursor = $response->json('meta.next_cursor');
        $url = $cursor === null ? null : "/api/v1/users?per_page=2&cursor={$cursor}";
    }

    $ids = array_column($seen, 'id');
    expect($pages)->toBe(4)
        ->and($ids)->toHaveCount(7)->and(array_unique($ids))->toHaveCount(7)
        ->and(array_column($seen, 'type'))->toBe(['person', 'person', 'person', 'person', 'bot', 'bot', 'bot'])
        ->and(collect($ids)->sort()->values()->all())->toBe(User::query()->orderBy('id')->pluck('id')->all());
});

it('lets a person change their own profile and records what changed', function () {
    $lene = User::factory()->create(['name' => 'Lene', 'handle' => 'lene']);

    $response = $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", [
        'name' => ' Lene Lind ', 'handle' => 'lene-lind', 'locale' => 'de', 'timezone' => 'Europe/Berlin', 'avatar_url' => imageDataUrl(),
    ])->assertOk()->assertJsonPath('data.name', 'Lene Lind')->assertJsonPath('data.handle', 'lene-lind')
        ->assertJsonPath('data.locale', 'de')->assertJsonPath('data.timezone', 'Europe/Berlin');

    $avatar = Media::query()->sole();
    expect($response->json('data.avatar_url'))->toBe(url("/media/{$avatar->uuid}"))
        ->and($avatar->collection_name)->toBe('avatar')->and($avatar->model_id)->toBe($lene->id)
        ->and($lene->fresh()?->locale)->toBe(Locale::De)
        ->and(userUpdates($lene))->toBe([[
            'name' => ['old' => 'Lene', 'new' => 'Lene Lind'],
            'handle' => ['old' => 'lene', 'new' => 'lene-lind'],
            'locale' => ['old' => null, 'new' => 'de'],
            'timezone' => ['old' => null, 'new' => 'Europe/Berlin'],
            'avatar_url' => ['old' => null, 'new' => $response->json('data.avatar_url')],
        ]]);
});

it('keeps the avatar when its URL comes back and removes it with null', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $url = $this->patchJson("/api/v1/users/{$lene->id}", ['avatar_url' => imageDataUrl()])->json('data.avatar_url');

    $this->patchJson("/api/v1/users/{$lene->id}", ['avatar_url' => $url])->assertOk()->assertJsonPath('data.avatar_url', $url);
    $this->patchJson("/api/v1/users/{$lene->id}", ['avatar_url' => null])->assertOk()->assertJsonPath('data.avatar_url', null);

    expect(Media::query()->count())->toBe(0)
        ->and(userUpdates($lene))->toBe([['avatar_url' => ['old' => null, 'new' => $url]], ['avatar_url' => ['old' => $url, 'new' => null]]]);
});

it('shows the avatars in the list', function () {
    $lene = User::factory()->create();
    $url = $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", ['avatar_url' => imageDataUrl()])->json('data.avatar_url');

    $data = collect($this->getJson('/api/v1/users')->assertOk()->json('data'));

    expect($data->firstWhere('id', $lene->id)['avatar_url'])->toBe($url)
        ->and($data->where('id', '!=', $lene->id)->pluck('avatar_url')->unique()->all())->toBe([null]);
});

it('lets the avatar collection take only pictures', function () {
    expect(fn () => User::factory()->create()->addMediaFromString('<svg/>')->usingFileName('avatar.svg')->toMediaCollection('avatar'))
        ->toThrow(FileUnacceptableForCollection::class);
});

it('records nothing and writes nothing when nothing changes', function () {
    $lene = User::factory()->create(['name' => 'Lene', 'handle' => 'lene', 'locale' => 'en', 'timezone' => 'UTC']);
    $updatedAt = $lene->updated_at;
    $this->travel(5)->minutes();

    $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", ['name' => 'Lene', 'handle' => 'lene', 'locale' => 'en', 'timezone' => 'UTC', 'avatar_url' => null])
        ->assertOk();

    expect(userUpdates($lene))->toBe([])->and($lene->fresh()?->updated_at?->equalTo($updatedAt))->toBeTrue();
});

it('names the handle that breaks the rules', function (string $handle, string $key) {
    User::factory()->create(['handle' => 'erik']);
    $lene = User::factory()->create();

    $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", ['handle' => $handle])
        ->assertUnprocessable()->assertJsonPath('reason', 'validation_failed')->assertJsonPath('errors.handle', [__($key)]);
})->with([
    'too short' => ['ab', 'field.handle.format'],
    'capitals' => ['Mara', 'field.handle.format'],
    'underscore' => ['mara_l', 'field.handle.format'],
    'too long' => [str_repeat('a', 33), 'field.handle.format'],
    'empty' => ['', 'field.handle.format'],
    'taken' => ['erik', 'field.handle.taken'],
]);

it('explains every invalid value with the sentence of the field', function () {
    app()->setLocale('de');
    $lene = User::factory()->create();

    $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", [
        'name' => str_repeat('x', 121), 'handle' => 'ab', 'locale' => 'fr', 'timezone' => 'Mars/Olympus', 'avatar_url' => 'https://example.com/a.png',
    ])->assertUnprocessable()
        ->assertJsonPath('errors.name.0', 'Der Name darf höchstens 120 Zeichen haben.')
        ->assertJsonPath('errors.handle.0', 'Das Kürzel hat 3 bis 32 Zeichen: a–z, 0–9 und -.')
        ->assertJsonPath('errors.locale.0', 'Diese Sprache gibt es nicht.')
        ->assertJsonPath('errors.timezone.0', 'Diese Zeitzone gibt es nicht.')
        ->assertJsonPath('errors.avatar_url.0', __('field.image.invalid'));

    $this->patchJson("/api/v1/users/{$lene->id}", ['name' => null, 'handle' => 7, 'locale' => null, 'timezone' => 5, 'avatar_url' => ['x']])
        ->assertUnprocessable()
        ->assertJsonPath('errors.name.0', 'Der Name darf nicht leer sein.')
        ->assertJsonPath('errors.handle.0', 'Das Kürzel hat 3 bis 32 Zeichen: a–z, 0–9 und -.')
        ->assertJsonPath('errors.locale.0', 'Diese Sprache gibt es nicht.')
        ->assertJsonPath('errors.timezone.0', 'Diese Zeitzone gibt es nicht.')
        ->assertJsonPath('errors.avatar_url.0', __('field.image.invalid'));
    $this->patchJson("/api/v1/users/{$lene->id}", ['name' => ['Lene']])->assertJsonPath('errors.name.0', 'Der Name muss ein Text sein.');

    expect(userUpdates($lene))->toBe([]);
});

it('lets only org admins change an e-mail address, and keeps it in lower case', function () {
    app()->setLocale('de');
    $lene = User::factory()->create(['email' => 'lene@example.com']);

    $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", ['email' => 'lene.lind@example.com'])
        ->assertForbidden()->assertJsonPath('reason', 'forbidden')->assertJsonPath('detail', 'E-Mail-Adressen ändern nur Org-Admins.');

    $this->actingAs(User::factory()->admin()->create())->patchJson("/api/v1/users/{$lene->id}", ['email' => ' Lene.Lind@Example.COM '])
        ->assertOk()->assertJsonPath('data.email', 'lene.lind@example.com');

    expect($lene->fresh()?->email)->toBe('lene.lind@example.com')
        ->and(userUpdates($lene))->toBe([['email' => ['old' => 'lene@example.com', 'new' => 'lene.lind@example.com']]]);
});

it('changes an e-mail address only from the session, never with a token (P6)', function () {
    $lene = User::factory()->create(['email' => 'lene@example.com', 'name' => 'Lene']);
    $this->withToken(apiToken(User::factory()->admin()->create(), ['read', 'write']));

    $this->patchJson("/api/v1/users/{$lene->id}", ['email' => 'mallory@example.com'])
        ->assertForbidden()->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('reason', 'session_required');
    $this->patchJson("/api/v1/users/{$lene->id}", ['name' => 'Lene Lind', 'email' => ' Lene@Example.com '])
        ->assertOk()->assertJsonPath('data.name', 'Lene Lind')->assertJsonPath('data.email', 'lene@example.com');

    expect($lene->fresh()?->email)->toBe('lene@example.com')
        ->and(userUpdates($lene))->toBe([['name' => ['old' => 'Lene', 'new' => 'Lene Lind']]]);
});

it('refuses the token of the default bot an e-mail change as well', function () {
    $lene = User::factory()->create(['email' => 'lene@example.com']);

    $this->withToken(apiToken(User::defaultBot(), ['write']))->patchJson("/api/v1/users/{$lene->id}", ['email' => 'mallory@example.com'])
        ->assertForbidden()->assertJsonPath('reason', 'session_required');

    expect($lene->fresh()?->email)->toBe('lene@example.com');
});

it('takes the own profile back as a whole and checks the rights only for what really changes', function () {
    $lene = User::factory()->create(['name' => 'Lene', 'email' => 'lene@example.com']);
    $this->actingAs($lene);
    $profile = collect($this->getJson('/api/v1/users')->json('data'))->firstWhere('id', $lene->id);

    $this->patchJson("/api/v1/users/{$lene->id}", [...array_diff_key($profile, ['locale' => true, 'timezone' => true]), 'name' => 'Lene Lind'])
        ->assertOk()->assertJsonPath('data.name', 'Lene Lind');
    $this->patchJson("/api/v1/users/{$lene->id}", ['email' => 'LENE@example.com'])->assertOk();
    $this->patchJson("/api/v1/users/{$lene->id}", ['email' => 'lene.lind@example.com'])->assertForbidden()->assertJsonPath('reason', 'forbidden');

    expect(userUpdates($lene))->toBe([['name' => ['old' => 'Lene', 'new' => 'Lene Lind']]]);
});

it('refuses an e-mail address that is invalid or taken', function (mixed $email, string $key) {
    User::factory()->create(['email' => 'erik@example.com']);
    $lene = User::factory()->create();

    $this->actingAs(User::factory()->admin()->create())->patchJson("/api/v1/users/{$lene->id}", ['email' => $email])
        ->assertUnprocessable()->assertJsonPath('errors.email', [__($key)]);
})->with([
    'no address' => ['lene', 'field.email.invalid'],
    'empty' => [null, 'field.email.invalid'],
    'no text' => [[1], 'field.email.invalid'],
    'too long' => [str_repeat('a', 250).'@example.com', 'field.email.invalid'],
    'taken, in other letters' => ['Erik@Example.com', 'field.email.taken'],
]);

it('gives people neither a description nor a responsible person', function () {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();

    $this->actingAs($admin)->patchJson("/api/v1/users/{$lene->id}", ['description' => 'Schreibt Doku.', 'owner_id' => $admin->id])
        ->assertUnprocessable()
        ->assertJsonPath('errors.description', [__('field.description.people')])
        ->assertJsonPath('errors.owner_id', [__('field.owner_id.people')]);
});

it('refuses a member who changes the profile of somebody else', function () {
    app()->setLocale('de');
    $lene = User::factory()->create(['name' => 'Lene']);

    $this->actingAs(User::factory()->create())->patchJson("/api/v1/users/{$lene->id}", ['name' => 'Fremd'])
        ->assertForbidden()->assertJsonPath('reason', 'forbidden')->assertJsonPath('detail', 'Fremde Profile ändern nur Org-Admins.');

    expect($lene->fresh()?->name)->toBe('Lene');
});

it('lets an org admin change the profile of somebody else', function () {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create(['handle' => 'lene']);

    $this->actingAs($admin)->patchJson("/api/v1/users/{$lene->id}", ['handle' => 'lene-l'])->assertOk()->assertJsonPath('data.handle', 'lene-l');

    expect(Event::query()->where('type', EventType::UserUpdated)->sole())
        ->actor_id->toBe($admin->id)
        ->subject_id->toBe($lene->id)
        ->changes->toBe(['handle' => ['old' => 'lene', 'new' => 'lene-l']]);
});

it('keeps the handle of the account itself free for it', function () {
    $lene = User::factory()->create(['handle' => 'lene', 'name' => 'Lene']);

    $this->actingAs($lene)->patchJson("/api/v1/users/{$lene->id}", ['handle' => 'lene', 'name' => 'Lene L.'])->assertOk();

    expect(userUpdates($lene))->toBe([['name' => ['old' => 'Lene', 'new' => 'Lene L.']]]);
});

it('lets the role change only through an org admin', function () {
    app()->setLocale('de');
    $member = User::factory()->create();
    $lene = User::factory()->create();

    $this->actingAs($member)->putJson("/api/v1/users/{$lene->id}/role", ['org_role' => 'admin'])
        ->assertForbidden()->assertJsonPath('detail', 'Rollen ändern nur Org-Admins.');

    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->putJson("/api/v1/users/{$lene->id}/role", ['org_role' => 'admin'])->assertOk()->assertJsonPath('data.org_role', 'admin');

    expect(Event::query()->where('type', EventType::UserRoleChanged)->sole())
        ->actor_id->toBe($admin->id)
        ->changes->toBe(['org_role' => ['old' => 'member', 'new' => 'admin']]);
});

it('records nothing when the role stays the same', function () {
    $lene = User::factory()->create();

    $this->actingAs(User::factory()->admin()->create())->putJson("/api/v1/users/{$lene->id}/role", ['org_role' => 'member'])->assertOk();

    expect(Event::query()->where('type', EventType::UserRoleChanged)->count())->toBe(0);
});

it('refuses a role that does not exist', function (mixed $role) {
    $lene = User::factory()->create();

    $this->actingAs(User::factory()->admin()->create())->putJson("/api/v1/users/{$lene->id}/role", ['org_role' => $role])
        ->assertUnprocessable()->assertJsonPath('errors.org_role', [__('field.org_role.unknown')]);
})->with(['owner', null, [['admin']]]);

it('updates straight through the action as well', function () {
    $lene = User::factory()->create(['name' => 'Lene']);

    expect(UpdateUser::run(actor($lene), $lene, ['name' => 'Lene Lind'])->name)->toBe('Lene Lind')
        ->and(fn () => UpdateUser::run(actor($lene), $lene, ['avatar_url' => imageDataUrl()."\n"]))->toThrow(ValidationException::class);
});

it('answers 404 for an account that does not exist', function () {
    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/users/01JAAAAAAAAAAAAAAAAAAAAAAA', ['name' => 'X'])->assertNotFound();
});
