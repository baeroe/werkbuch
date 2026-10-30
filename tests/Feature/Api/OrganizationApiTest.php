<?php

use App\Actions\Organization\UpdateOrganization;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

/**
 * The events of changes to the organization (the default bot brings its own `bot.created` from the migration).
 *
 * @return Builder<Event>
 */
function organizationEvents(): Builder
{
    return Event::query()->where('type', EventType::OrganizationUpdated);
}

it('lets an org admin change the organization and records what changed', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->patchJson('/api/v1/organization', ['name' => ' Feldwerk ', 'timezone' => 'Europe/Berlin', 'week_start' => 0])
        ->assertOk()->assertJsonPath('data.name', 'Feldwerk')->assertJsonPath('data.week_start', 0);
    $event = organizationEvents()->sole();
    expect($event->type)->toBe(EventType::OrganizationUpdated)
        ->and($event->changes)->toMatchArray(['name' => ['old' => config('app.name'), 'new' => 'Feldwerk'], 'timezone' => ['old' => 'UTC', 'new' => 'Europe/Berlin']]);
});

it('names the field of every invalid value', function (array $input, string $field) {
    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/organization', $input)
        ->assertUnprocessable()->assertJsonPath('reason', 'validation_failed')->assertJsonValidationErrors([$field]);
})->with([[['name' => ' '], 'name'], [['locale' => 'fr'], 'locale'], [['timezone' => 'Mars/Olympus'], 'timezone'], [['week_start' => 3], 'week_start'], [['logo_url' => 'data:image/svg+xml;base64,PHN2Zy8+'], 'logo_url']]);

it('explains every invalid value with the sentence of the field', function () {
    app()->setLocale('de');

    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/organization', [
        'name' => str_repeat('x', 121), 'locale' => 'fr', 'timezone' => 'Mars/Olympus', 'week_start' => 3,
        'logo_url' => 'data:image/png;base64,'.base64_encode('no picture'),
    ])->assertUnprocessable()
        ->assertJsonPath('errors.name.0', 'Der Name darf höchstens 120 Zeichen haben.')
        ->assertJsonPath('errors.locale.0', 'Diese Sprache gibt es nicht.')
        ->assertJsonPath('errors.timezone.0', 'Diese Zeitzone gibt es nicht.')
        ->assertJsonPath('errors.week_start.0', 'Die Woche beginnt am Montag oder Sonntag.')
        ->assertJsonPath('errors.logo_url.0', __('field.image.invalid'));

    $this->patchJson('/api/v1/organization', ['name' => null])->assertJsonPath('errors.name.0', 'Der Name darf nicht leer sein.');
    expect(organizationEvents()->count())->toBe(0);
});

it('refuses members with the sentence of the clickdummy', function () {
    app()->setLocale('de');

    $this->actingAs(User::factory()->create())->patchJson('/api/v1/organization', ['name' => 'Mine'])
        ->assertForbidden()->assertJsonPath('reason', 'forbidden')
        ->assertJsonPath('detail', 'Die Organisation ändern nur Org-Admins.');
    expect(Organization::current()->name)->toBe(config('app.name'));
});

it('shows the organization to every account', function (Closure $account) {
    $org = Organization::current();

    $this->actingAs($account())->getJson('/api/v1/organization')->assertOk()->assertExactJson(['data' => [
        'id' => $org->id, 'name' => $org->name, 'locale' => 'en', 'timezone' => 'UTC', 'week_start' => 1, 'logo_url' => null,
    ]]);
})->with([
    'member' => [fn () => User::factory()->create()],
    'admin' => [fn () => User::factory()->admin()->create()],
    'bot' => [fn () => User::factory()->bot()->create()],
]);

it('records nothing and writes nothing when nothing changes', function () {
    $org = Organization::current();
    $updatedAt = $org->updated_at;

    $this->travel(5)->minutes();
    $this->actingAs(User::factory()->admin()->create())
        ->patchJson('/api/v1/organization', ['name' => $org->name, 'locale' => 'en', 'timezone' => 'UTC', 'week_start' => 1, 'logo_url' => null])
        ->assertOk()->assertJsonPath('data.name', $org->name);

    expect(organizationEvents()->count())->toBe(0)->and($org->fresh()?->updated_at?->equalTo($updatedAt))->toBeTrue();
});

it('sets the logo from a data URL, keeps it when the URL comes back and removes it with null', function () {
    $this->actingAs(User::factory()->admin()->create());

    $url = $this->patchJson('/api/v1/organization', ['logo_url' => imageDataUrl()])->assertOk()->json('data.logo_url');
    $media = Media::query()->sole();
    expect($url)->toBe(url("/media/{$media->uuid}"))
        ->and($media->collection_name)->toBe('logo')->and($media->mime_type)->toBe('image/png')
        ->and(organizationEvents()->sole()->changes)->toBe(['logo_url' => ['old' => null, 'new' => $url]]);

    // the form sends the current URL back unchanged: nothing happens
    $this->patchJson('/api/v1/organization', ['logo_url' => $url])->assertOk()->assertJsonPath('data.logo_url', $url);
    expect(organizationEvents()->count())->toBe(1);

    // a new picture replaces the old one
    $next = $this->patchJson('/api/v1/organization', ['logo_url' => imageDataUrl('webp')])->assertOk()->json('data.logo_url');
    expect($next)->not->toBe($url)->and(Media::query()->sole()->mime_type)->toBe('image/webp');

    $this->patchJson('/api/v1/organization', ['logo_url' => null])->assertOk()->assertJsonPath('data.logo_url', null);
    expect(Media::query()->count())->toBe(0)
        ->and(organizationEvents()->latest('occurred_at')->first()?->changes)->toBe(['logo_url' => ['old' => $next, 'new' => null]]);
});

it('takes PNG, JPEG, WebP and GIF', function (string $type) {
    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/organization', ['logo_url' => imageDataUrl($type)])->assertOk();

    expect(Media::query()->sole()->mime_type)->toBe("image/{$type}");
})->with(['png', 'jpeg', 'webp', 'gif']);

it('refuses pictures that are not what they claim, broken or too large', function (Closure $value, string $key) {
    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/organization', ['logo_url' => $value()])
        ->assertUnprocessable()->assertJsonPath('errors.logo_url.0', __($key, ['max' => 2]));
    expect(Media::query()->count())->toBe(0);
})->with([
    'not a data URL' => [fn () => 'https://example.com/logo.png', 'field.image.invalid'],
    'a PNG that is a JPEG' => [fn () => str_replace('data:image/jpeg', 'data:image/png', imageDataUrl('jpeg')), 'field.image.invalid'],
    'broken base64' => [fn () => 'data:image/png;base64,***', 'field.image.invalid'],
    'empty' => [fn () => 'data:image/png;base64,', 'field.image.invalid'],
    'too large' => [fn () => 'data:image/png;base64,'.base64_encode(str_repeat('x', 2 * 1024 * 1024 + 1)), 'field.image.too_large'],
]);

it('replaces the current organization of the request after a change', function () {
    $admin = User::factory()->admin()->create();
    $before = Organization::current();

    $after = UpdateOrganization::run(actor($admin), ['name' => 'Feldwerk', 'locale' => 'de']);

    expect(Organization::current())->toBe($after)->not->toBe($before)
        ->and(Organization::current()->name)->toBe('Feldwerk')
        ->and(organizationEvents()->sole()->changes)->toBe(['name' => ['old' => config('app.name'), 'new' => 'Feldwerk'], 'locale' => ['old' => 'en', 'new' => 'de']]);
});
