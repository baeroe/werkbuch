<?php

use App\Enums\Locale;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    Route::middleware('web')->get('_t/locale', fn () => ['locale' => app()->getLocale(), 'carbon' => now()->locale]);
});

it('speaks English without cookie and profile', fn () => $this->get('_t/locale')->assertJson(['locale' => 'en']));

it('speaks the default of the organization without cookie and profile', function () {
    config(['app.locale' => 'de']);

    $this->get('_t/locale')->assertJson(['locale' => 'de', 'carbon' => 'de']);
});

it('speaks English when the default of the organization is no supported language', function () {
    config(['app.locale' => 'fr']);

    $this->get('_t/locale')->assertJson(['locale' => 'en']);
});

it('follows the locale cookie before sign-in', fn () => $this->withUnencryptedCookie('locale', 'de')->get('_t/locale')->assertJson(['locale' => 'de', 'carbon' => 'de']));

it('ignores cookies that name no supported language', function (string $value) {
    $this->withUnencryptedCookie('locale', $value)->get('_t/locale')->assertJson(['locale' => 'en']);
})->with(['fr', '../de', 'DE', '', 'eyJpdiI6Ij']);

it('ignores a locale cookie that is no plain string', function () {
    $this->call('GET', '_t/locale', cookies: ['locale' => ['de']])->assertJson(['locale' => 'en']);
});

it('ignores a locale query parameter', fn () => $this->get('_t/locale?locale=de')->assertJson(['locale' => 'en']));

it('ignores a foreign encrypted cookie', function () {
    $encrypted = Crypt::encryptString('de');

    $this->withUnencryptedCookie('locale', $encrypted)->get('_t/locale')->assertJson(['locale' => 'en']);
});

it('does not set the cookie while the language comes from the cookie or the default', function () {
    $this->withUnencryptedCookie('locale', 'de')->get('_t/locale')->assertCookieMissing('locale');
    $this->get('_t/locale')->assertCookieMissing('locale');
});

it('takes the profile over the cookie and remembers it in the cookie', function () {
    $user = User::factory()->locale(Locale::De)->create();

    $this->actingAs($user)->withUnencryptedCookie('locale', 'en')->get('_t/locale')
        ->assertJson(['locale' => 'de'])->assertPlainCookie('locale', 'de');
});

it('writes the cookie for a profile language when there is no cookie yet', function () {
    $this->actingAs(User::factory()->locale(Locale::En)->create())->get('_t/locale')
        ->assertJson(['locale' => 'en'])->assertPlainCookie('locale', 'en');
});

it('leaves the cookie alone when it already names the profile language', function () {
    $this->actingAs(User::factory()->locale(Locale::De)->create())->withUnencryptedCookie('locale', 'de')->get('_t/locale')
        ->assertJson(['locale' => 'de'])->assertCookieMissing('locale');
});

it('lets the cookie decide for an account without own language', function () {
    $this->actingAs(User::factory()->create())->withUnencryptedCookie('locale', 'de')->get('_t/locale')->assertJson(['locale' => 'de']);
});

it('keeps the language of the last session in the cookie for the login after logout', function () {
    Route::middleware('web')->post('_t/logout', function () {
        auth()->logout();
        session()->invalidate();

        return response()->noContent();
    });
    $user = User::factory()->locale(Locale::De)->create();

    $first = $this->actingAs($user)->get('_t/locale');
    $cookie = $first->getCookie('locale', false);
    expect($cookie?->getValue())->toBe('de');

    $this->post('_t/logout')->assertNoContent();
    $this->flushSession();
    auth()->forgetGuards();
    $this->withUnencryptedCookie('locale', $cookie->getValue())->get('_t/locale')->assertJson(['locale' => 'de']);
});

it('sends the cookie unencrypted and for a long time', function () {
    $response = $this->actingAs(User::factory()->locale(Locale::De)->create())->get('_t/locale');
    $cookie = $response->getCookie('locale', false);

    expect($cookie->getValue())->toBe('de')
        ->and($cookie->getExpiresTime())->toBeGreaterThan(now()->addDays(300)->getTimestamp())
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and($cookie->getSameSite())->toBe('lax');
});

it('shares locale and the translations of that language once', function () {
    $this->withUnencryptedCookie('locale', 'de')->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('locale', 'de')
        ->where('translations', json_decode((string) file_get_contents(lang_path('de.json')), true)));
});

it('sends the translations only on the first visit of a page', function () {
    $version = $this->get(inertiaProbe())->viewData('page')['version'];
    $headers = ['X-Inertia' => 'true', 'X-Inertia-Version' => $version];

    $this->withHeaders($headers)->get(inertiaProbe())->assertJsonPath('props.translations', lang('en'));
    $this->withHeaders([...$headers, 'X-Inertia-Except-Once-Props' => 'translations'])->get(inertiaProbe())
        ->assertJsonMissingPath('props.translations')->assertJsonPath('props.locale', 'en');
});

it('sets the lang attribute of the page', fn () => $this->withUnencryptedCookie('locale', 'de')->get(inertiaProbe())->assertSee('<html lang="de">', false));

it('mails in the language of the account, else the default', function () {
    expect(User::factory()->locale(Locale::De)->make()->preferredLocale())->toBe('de')
        ->and(User::factory()->make()->preferredLocale())->toBe('en');
});
