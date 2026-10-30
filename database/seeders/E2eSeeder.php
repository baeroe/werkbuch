<?php

namespace Database\Seeders;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * The demo data plus the accounts of the Playwright tests (e2e/), set back to their start state on every run. The
 * organization speaks English here (the specs read the English texts); the demo data alone keep German. Never for
 * production.
 */
class E2eSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'e2e-password';

    /** The secret of the two-factor accounts (Base32), the same for all of them. */
    public const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

    public const VARIANTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

    /**
     * The eight recovery codes of the two-factor account of a Playwright project, derived from its name.
     *
     * @return list<string>
     */
    public static function recoveryCodes(string $variant): array
    {
        return array_map(function (int $number) use ($variant): string {
            $hash = hash('sha256', "{$variant}:{$number}");

            return substr($hash, 0, 10).'-'.substr($hash, 10, 10);
        }, range(1, 8));
    }

    public function run(RoleAssignments $roles): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The e2e data must never be seeded in production.');
        }

        $this->call(DemoSeeder::class);

        Organization::current()->update(['locale' => Locale::En]);

        $roles->setOrgRole($this->person('e2e@example.com', 'Erik Ende'), OrgRole::Admin);

        foreach (self::VARIANTS as $variant) {
            $this->person("reset-{$variant}@example.com", 'Rita Reset');
            $this->person("security-{$variant}@example.com", 'Sam Security', [
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
            ]);
            $this->person("twofactor-{$variant}@example.com", 'Tom Twofactor', [
                'two_factor_secret' => encrypt(self::TOTP_SECRET),
                'two_factor_recovery_codes' => encrypt(json_encode(self::recoveryCodes($variant), JSON_THROW_ON_ERROR)),
                'two_factor_confirmed_at' => Carbon::now(),
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function person(string $email, string $name, array $extra = []): User
    {
        $user = User::updateOrCreate(['email' => $email], [
            'type' => AccountType::Person,
            'name' => $name,
            'handle' => strstr($email, '@', true),
            'locale' => null,
            'password' => self::PASSWORD,
            ...$extra,
        ]);

        app(RoleAssignments::class)->setOrgRole($user, OrgRole::Member);

        return $user;
    }
}
