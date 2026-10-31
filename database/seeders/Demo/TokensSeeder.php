<?php

namespace Database\Seeders\Demo;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * The API tokens of the clickdummy (src/api/seed/people.ts). Nobody knows their plain text: the secret is random and
 * stays as it is when the seeder runs again.
 */
class TokensSeeder extends Seeder
{
    use WithoutModelEvents;

    private const TIMEZONE = 'Europe/Berlin';

    public function run(): void
    {
        $tokens = [
            ['mara', 'Claude Code', ['read', 'write', 'mcp'], null, '2026-10-28 09:05', '2026-10-02 11:00'],
            ['mara', 'CI-Skript', ['read'], '2026-09-30 23:59', '2026-09-29 22:15', '2026-06-30 10:00'],
            ['kira', 'MCP', ['read', 'write', 'mcp'], null, '2026-10-27 09:41', '2026-10-05 14:30'],
        ];

        foreach ($tokens as [$handle, $name, $abilities, $expiresAt, $lastUsedAt, $createdAt]) {
            $owner = User::query()->where('handle', $handle)->sole();
            $token = PersonalAccessToken::query()->where('tokenable_type', 'user')->where('tokenable_id', $owner->id)->where('name', $name)->first()
                ?? (new PersonalAccessToken)->forceFill([
                    'tokenable_type' => 'user',
                    'tokenable_id' => $owner->id,
                    'name' => $name,
                    'token' => hash('sha256', 'wb_'.Str::random(40)),
                ]);

            // Eloquent stores the wall-clock time of the Carbon as it is, so the moment goes in as UTC like the app time zone.
            $token->forceFill([
                'abilities' => $abilities,
                'expires_at' => $expiresAt === null ? null : $this->berlin($expiresAt),
                'last_used_at' => $this->berlin($lastUsedAt),
                'created_at' => $this->berlin($createdAt),
                'updated_at' => $this->berlin($createdAt),
            ])->save();
        }
    }

    private function berlin(string $time): Carbon
    {
        return Carbon::parse($time, self::TIMEZONE)->utc();
    }
}
