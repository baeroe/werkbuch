<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Models\Organization;
use App\Models\User;
use Database\Seeders\DemoSeeder;
use Database\Seeders\E2eSeeder;
use Illuminate\Support\Facades\Hash;
use PragmaRX\Google2FA\Google2FA;

const E2E_VARIANTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

it('switches the organization to English, which the demo data alone keep German', function () {
    $this->seed(DemoSeeder::class);
    expect(Organization::current()->locale->value)->toBe('de');

    $this->seed(E2eSeeder::class);
    expect(Organization::current()->locale->value)->toBe('en')
        ->and(Organization::current()->name)->toBe('Feldwerk');

    $this->seed(DemoSeeder::class);
    expect(Organization::current()->locale->value)->toBe('de');
});

it('makes Erik an org admin and everybody else of the e2e accounts a member', function () {
    $this->seed(E2eSeeder::class);

    expect(Visibility::orgRole(User::where('email', 'e2e@example.com')->sole()))->toBe(OrgRole::Admin)
        ->and(User::where('email', 'e2e@example.com')->sole()->locale)->toBeNull();

    foreach (['reset', 'security', 'twofactor'] as $kind) {
        expect(Visibility::orgRole(User::where('email', "{$kind}-phone-dark@example.com")->sole()))->toBe(OrgRole::Member);
    }
});

it('seeds the accounts of every Playwright project', function () {
    $this->seed(E2eSeeder::class);

    foreach (E2E_VARIANTS as $variant) {
        foreach (['reset' => 'Rita Reset', 'security' => 'Sam Security', 'twofactor' => 'Tom Twofactor'] as $kind => $name) {
            $user = User::where('email', "{$kind}-{$variant}@example.com")->sole();

            expect([$user->name, $user->handle, $user->locale])->toBe([$name, "{$kind}-{$variant}", null])
                ->and(Hash::check(E2eSeeder::PASSWORD, $user->password))->toBeTrue();
        }

        expect(User::where('email', "security-{$variant}@example.com")->sole()->two_factor_secret)->toBeNull();
    }

    expect(User::where('type', 'person')->count())->toBe(6 + 1 + 3 * 4);
});

it('confirms two-factor authentication for the twofactor accounts, with a secret that yields valid codes', function () {
    $this->seed(E2eSeeder::class);
    $user = User::where('email', 'twofactor-desktop-light@example.com')->sole();
    $google2fa = new Google2FA;

    expect($user->two_factor_confirmed_at)->not->toBeNull()
        ->and(decrypt($user->two_factor_secret))->toBe(E2eSeeder::TOTP_SECRET)
        ->and($google2fa->verifyKey(E2eSeeder::TOTP_SECRET, $google2fa->getCurrentOtp(decrypt($user->two_factor_secret))))->toBeTrue();
});

it('derives eight recovery codes from the variant', function () {
    $codes = E2eSeeder::recoveryCodes('phone-dark');

    expect($codes)->toHaveCount(8)->and(array_unique($codes))->toHaveCount(8)
        ->and($codes)->toBe(E2eSeeder::recoveryCodes('phone-dark'))->not->toBe(E2eSeeder::recoveryCodes('phone-light'));

    foreach ($codes as $code) {
        expect($code)->toMatch('/^[0-9a-f]{10}-[0-9a-f]{10}$/');
    }

    $this->seed(E2eSeeder::class);
    expect(json_decode(decrypt(User::where('email', 'twofactor-phone-dark@example.com')->sole()->two_factor_recovery_codes), true))->toBe($codes);
});

it('sets every account back on the next run: password, used recovery codes, a changed two-factor setup', function () {
    $this->seed(E2eSeeder::class);
    $twofactor = User::where('email', 'twofactor-desktop-light@example.com')->sole();
    $security = User::where('email', 'security-desktop-light@example.com')->sole();
    $twofactor->update(['two_factor_recovery_codes' => encrypt(json_encode(['used-up'])), 'password' => 'changed', 'two_factor_confirmed_at' => null]);
    $security->update(['two_factor_secret' => encrypt('SOMESECRET'), 'two_factor_confirmed_at' => now(), 'password' => 'changed']);

    $this->seed(E2eSeeder::class);

    $twofactor->refresh();
    $security->refresh();
    expect(json_decode(decrypt($twofactor->two_factor_recovery_codes), true))->toBe(E2eSeeder::recoveryCodes('desktop-light'))
        ->and($twofactor->two_factor_confirmed_at)->not->toBeNull()
        ->and(Hash::check(E2eSeeder::PASSWORD, $twofactor->password))->toBeTrue()
        ->and([$security->two_factor_secret, $security->two_factor_confirmed_at])->toBe([null, null])
        ->and(Hash::check(E2eSeeder::PASSWORD, $security->password))->toBeTrue()
        ->and(User::where('type', 'person')->count())->toBe(6 + 1 + 3 * 4);
});

it('refuses production', function () {
    $this->app['env'] = 'production';

    expect(fn () => app()->call([new E2eSeeder, 'run']))->toThrow(RuntimeException::class)
        ->and(User::where('type', 'person')->count())->toBe(0);
});
