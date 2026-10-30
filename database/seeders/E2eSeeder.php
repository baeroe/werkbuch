<?php

namespace Database\Seeders;

use App\Enums\AccountType;
use App\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * The demo data plus the accounts of the Playwright tests (e2e/). Never for production.
 */
class E2eSeeder extends Seeder
{
    public const PASSWORD = 'e2e-password';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The e2e data must never be seeded in production.');
        }

        $this->call(DemoSeeder::class);

        $this->person('e2e@example.com', 'Erik Ende');

        foreach (['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'] as $variant) {
            $this->person("reset-{$variant}@example.com", 'Rita Reset');
        }
    }

    private function person(string $email, string $name): void
    {
        User::updateOrCreate(['email' => $email], [
            'type' => AccountType::Person,
            'name' => $name,
            'handle' => strstr($email, '@', true),
            'locale' => null,
            'password' => self::PASSWORD,
        ]);
    }
}
