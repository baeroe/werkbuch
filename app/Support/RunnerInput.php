<?php

namespace App\Support;

use App\Models\Runner;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The rules of the name and the places of a runner (spec 8.4, 10.1): a name of 1–64 characters no other active runner
 * holds (in any case; a revoked one frees its name), places as whole numbers from 1 to 16 per pot, per repo at most as
 * many as in all. Callers check names under `CatalogLock`, so two pairings of one host never get the same name.
 */
final class RunnerInput
{
    /**
     * @return list<mixed>
     */
    public static function name(?Runner $own): array
    {
        return ['required', 'string', 'max:'.Runner::NAME_MAX, Rule::unique('runners', 'name')->whereNull('revoked_at')->ignore($own?->id)];
    }

    /**
     * @return array<string, list<mixed>>
     */
    public static function slots(): array
    {
        $slot = ['required', 'integer', 'min:1', 'max:'.Runner::MAX_SLOTS];

        return [
            'slots' => ['array:total,per_repo,light'],
            'slots.total' => $slot,
            'slots.per_repo' => [...$slot, 'lte:slots.total'],
            'slots.light' => $slot,
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.required'),
            'name.max' => __('field.name.max', ['max' => Runner::NAME_MAX]),
            'name.unique' => __('field.runner.name_taken'),
            'slots' => __('field.slots.invalid', ['max' => Runner::MAX_SLOTS]),
            'slots.*' => __('field.slots.invalid', ['max' => Runner::MAX_SLOTS]),
            'slots.per_repo.lte' => __('field.slots.per_repo'),
        ];
    }

    /** A name for a new runner from the host name it sends, with `-2`, `-3`, … when an active runner holds it. */
    public static function freeName(string $host): string
    {
        $base = Str::limit(Str::trim($host) === '' ? 'runner' : Str::trim($host), Runner::NAME_MAX - 4, '');
        $name = $base;

        for ($n = 2; Runner::query()->whereNull('revoked_at')->where('name', $name)->exists(); $n++) {
            $name = "{$base}-{$n}";
        }

        return $name;
    }
}
