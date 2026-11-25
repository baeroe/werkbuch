<?php

namespace Database\Factories;

use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use RuntimeException;

/**
 * An app as the manifest flow leaves it, by default the one of the organization `feldwerk`: a fresh private key (made
 * once per process), a webhook secret, the permissions and events of spec 11.3, created by a new org admin. No events.
 * `account()` makes the app of another GitHub account (one per account, A680).
 *
 * @extends Factory<GitHubApp>
 */
class GitHubAppFactory extends Factory
{
    /** The ID at GitHub of the app of `feldwerk` (FakeGitHub answers its installations with it). */
    public const DEFAULT_APP_ID = 4_200_123;

    private static ?string $key = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'app_id' => self::DEFAULT_APP_ID,
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
    /** The app of another GitHub account: its login names the app (`<login> werkbuch`) as the manifest does. */
    public function account(string $login, string $type = 'Organization'): static
    {
        $slug = strtolower($login).'-werkbuch';

        return $this->state(['app_id' => 4_200_000 + crc32($login) % 99_000 + 1_000, 'slug' => $slug, 'name' => $login.' werkbuch', 'owner_login' => $login, 'owner_type' => $type, 'html_url' => 'https://github.com/apps/'.$slug]);
    }

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
