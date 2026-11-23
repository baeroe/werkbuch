<?php

namespace Database\Factories;

use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use RuntimeException;

/**
 * The app of the instance as the manifest flow leaves it: a fresh private key (made once per process), a webhook secret,
 * the permissions and events of spec 11.3, created by a new org admin. No events.
 *
 * @extends Factory<GitHubApp>
 */
class GitHubAppFactory extends Factory
{
    private static ?string $key = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'app_id' => 4_100_000 + fake()->unique()->numberBetween(1, 99_999),
            'slug' => 'feldwerk-werkbuch',
            'name' => 'Feldwerk werkbuch',
            'client_id' => 'Iv23liFeldwerk',
            'owner_login' => 'feldwerk',
            'owner_type' => 'Organization',
            'html_url' => 'https://github.com/apps/feldwerk-werkbuch',
            'private_key' => self::privateKey(),
            'webhook_secret' => 'whsec-'.bin2hex(random_bytes(20)),
            'permissions' => Manifest::PERMISSIONS,
            'events' => Manifest::EVENTS,
            'created_by' => User::factory()->admin(),
        ];
    }

    /** A private key in PEM, the same within one process (making one costs). */
    public static function privateKey(): string
    {
        if (self::$key === null) {
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            if ($key === false) {
                throw new RuntimeException('OpenSSL made no key.');
            }
            openssl_pkey_export($key, $pem);
            self::$key = (string) $pem;
        }

        return self::$key;
    }
}
