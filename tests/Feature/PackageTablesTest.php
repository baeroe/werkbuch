<?php

use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

it('keys the package tables to ULID models', function (string $table, string $column) {
    expect(Schema::getColumnType($table, $column))->toBe('char')
        ->and(collect(Schema::getColumns($table))->firstWhere('name', $column)['type'])->toContain('26');
})->with([
    ['personal_access_tokens', 'id'], ['personal_access_tokens', 'tokenable_id'],
    ['model_has_roles', 'model_id'], ['model_has_roles', 'team_id'], ['model_has_permissions', 'model_id'],
    ['roles', 'team_id'], ['media', 'model_id'],
]);

it('issues a Sanctum token whose id is a ULID and that finds its account', function () {
    $user = User::factory()->create();
    $plain = $user->createToken('t', ['read'])->plainTextToken;
    [$id, $secret] = explode('|', $plain, 2);
    expect(Str::isUlid($id))->toBeTrue()->and($secret)->toStartWith('wb_')
        ->and(PersonalAccessToken::findToken($plain)?->tokenable->is($user))->toBeTrue();
});
