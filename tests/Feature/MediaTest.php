<?php

use App\Actions\Organization\UpdateOrganization;
use App\Actions\Users\UpdateUser;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

function organizationLogo(string $type = 'png'): Media
{
    UpdateOrganization::run(actor(User::factory()->admin()->create()), ['logo_url' => imageDataUrl($type)]);

    return Media::query()->sole();
}

it('serves the logo to every signed-in account with its type and nosniff', function () {
    $logo = organizationLogo('webp');

    $response = $this->actingAs(User::factory()->create())->get("/media/{$logo->uuid}")->assertOk()
        ->assertHeader('Content-Type', 'image/webp')->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    expect($response->headers->get('Cache-Control'))->toContain('private')->toContain('max-age=86400')
        ->and($response->baseResponse->getFile()->getPathname())->toBe($logo->getPath());
});

it('sends guests to the sign-in', function () {
    $logo = organizationLogo();

    $this->get("/media/{$logo->uuid}")->assertRedirect('/login');
});

it('answers 404 for an unknown picture', function () {
    $this->actingAs(User::factory()->create())->get('/media/'.fake()->uuid())->assertNotFound();
});

it('serves the logo to a token that may read, not to one that may only write', function () {
    $logo = organizationLogo();
    $user = User::factory()->create();

    $this->withToken(apiToken($user, ['read']))->get("/media/{$logo->uuid}")->assertOk();
    forgetApiAuth();
    $this->withToken(apiToken($user, ['write']))->get("/media/{$logo->uuid}")->assertForbidden();
});

it('keeps pictures of anything else hidden until their own rule exists', function () {
    // project pictures follow the visibility of their project (Task 11); until then a picture of a project stays hidden
    $logo = organizationLogo();
    $project = Project::factory()->create();
    $logo->forceFill(['model_type' => $project->getMorphClass(), 'model_id' => $project->id])->save();

    $this->actingAs(User::factory()->admin()->create())->get("/media/{$logo->uuid}")->assertNotFound();
});

it('serves only the logo of the organization, no other picture it holds', function () {
    organizationLogo();
    $other = Organization::current()->addMediaFromBase64(imageDataUrl())->usingFileName('other.png')->toMediaCollection('letterhead');

    $this->actingAs(User::factory()->admin()->create())->get("/media/{$other->uuid}")->assertNotFound();
});

it('keeps the logo on the private disk', function () {
    $logo = organizationLogo();

    expect($logo->disk)->toBe('local')->and(Storage::disk('local')->exists($logo->getPathRelativeToRoot()))->toBeTrue()
        ->and(Organization::current()->getFirstMedia('logo')?->is($logo))->toBeTrue();
});

it('serves the avatar of an account to every signed-in account', function () {
    $lene = User::factory()->create();
    UpdateUser::run(actor($lene), $lene, ['avatar_url' => imageDataUrl('gif')]);
    $avatar = Media::query()->sole();

    $this->actingAs(User::factory()->bot()->create())->get("/media/{$avatar->uuid}")->assertOk()
        ->assertHeader('Content-Type', 'image/gif')->assertHeader('X-Content-Type-Options', 'nosniff');
    expect($avatar->collection_name)->toBe('avatar')->and($avatar->disk)->toBe('local');
});

it('serves only the avatar of an account, no other picture it holds', function () {
    $other = User::factory()->create()->addMediaFromBase64(imageDataUrl())->usingFileName('other.png')->toMediaCollection('portrait');

    $this->actingAs(User::factory()->admin()->create())->get("/media/{$other->uuid}")->assertNotFound();
});
