<?php

use App\Enums\Locale;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::middleware('web')->get('_t/locale', fn () => ['locale' => app()->getLocale(), 'carbon' => now()->locale]);
});

it('speaks English without cookie and profile', fn () => $this->get('_t/locale')->assertJson(['locale' => 'en']));

it('speaks the default of the organization without cookie and profile', function () {
    Organization::current()->update(['locale' => Locale::De]);

    $this->get('_t/locale')->assertJson(['locale' => 'de', 'carbon' => 'de']);
});

it('renders the page of a guest in the default language of the organization', function () {
    Organization::current()->update(['locale' => Locale::De]);

    $this->get('/login')->assertSee('<html lang="de"', false);
});

it('lets the cookie beat the default language of the organization', function () {
    Organization::current()->update(['locale' => Locale::De]);

    $this->withUnencryptedCookie('locale', 'en')->get('/login')->assertSee('<html lang="en"', false);
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

it('remembers the language of an account that signs in during the request', function () {
    $user = User::factory()->locale(Locale::De)->create();
    Route::middleware('web')->get('_t/login', function () use ($user) {
        auth()->login($user);

        return response()->noContent();
    });

    $this->withUnencryptedCookie('locale', 'en')->get('_t/login')->assertPlainCookie('locale', 'de');
});

it('lets the cookie follow a change of the profile language', function () {
    $user = User::factory()->locale(Locale::En)->create();
    Route::middleware('web')->get('_t/change', function () use ($user) {
        $user->update(['locale' => Locale::De]);

        return response()->noContent();
    });

    $this->actingAs($user)->withUnencryptedCookie('locale', 'en')->get('_t/change')->assertPlainCookie('locale', 'de');
});

it('keeps the language of the account in the cookie for the login page after a logout', function () {
    $user = User::factory()->locale(Locale::En)->create();
    Route::middleware('web')->group(function () use ($user) {
        Route::get('_t/login', function () use ($user) {
            auth()->login($user);

            return response()->noContent();
        });
        Route::get('_t/change', function () use ($user) {
            $user->update(['locale' => Locale::De]);

            return response()->noContent();
        });
        Route::get('_t/logout', function () {
            auth()->logout();
            session()->invalidate();

            return response()->noContent();
        });
    });

    // a browser: every answer's cookies go into the next request
    $jar = [];
    $visit = function (string $uri) use (&$jar) {
        $response = $this->withUnencryptedCookies($jar)->get($uri);
        foreach ($response->headers->getCookies() as $cookie) {
            $jar[$cookie->getName()] = $cookie->getValue();
        }

        return $response;
    };

    $visit('_t/login')->assertPlainCookie('locale', 'en');
    $visit('_t/change')->assertPlainCookie('locale', 'de');
    $visit('_t/logout')->assertNoContent();
    expect($jar['locale'])->toBe('de');
    $this->app['auth']->forgetGuards();
    $visit('_t/locale')->assertJson(['locale' => 'de']);
});

it('writes the language of the account at a logout when the cookie is stale', function () {
    $user = User::factory()->locale(Locale::De)->create();
    Route::middleware('web')->get('_t/logout', function () {
        auth()->logout();

        return response()->noContent();
    });

    $this->actingAs($user)->withUnencryptedCookie('locale', 'en')->get('_t/logout')->assertPlainCookie('locale', 'de');
});

it('mails in the own language of an account and else in the default of the organization', function () {
    Organization::current()->update(['locale' => Locale::De]);

    expect(User::factory()->make()->preferredLocale())->toBe('de')
        ->and(User::factory()->locale(Locale::En)->make()->preferredLocale())->toBe('en');
});
