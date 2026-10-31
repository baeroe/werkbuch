<?php

namespace App\Actions\Organization;

use App\Access\Authorize;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\ImageInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Changes name, language, time zone, first day of the week and logo of the organization (org admins). Only the fields
 * the input names change; the event `organization.updated` lists what really changed, and nothing changed means no
 * event and no write.
 */
final class UpdateOrganization
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): Organization
    {
        // a copy, so a failed change leaves the organization of the request as it was
        $organization = Organization::query()->sole();
        Authorize::check($actor, 'update', $organization);

        if (is_string($input['name'] ?? null)) {
            $input['name'] = trim($input['name']);
        }

        $logo = ImageInput::url($organization, 'logo');

        $valid = Validator::make($input, [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'locale' => ['sometimes', 'required', Rule::in(Locale::values())],
            'timezone' => ['sometimes', 'required', 'string', 'timezone:all'],
            'week_start' => ['sometimes', 'required', 'integer', Rule::in([0, 1])],
            'logo_url' => ['sometimes', ...ImageInput::rules($logo)],
        ], [
            ...ImageInput::messages('logo_url'),
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.invalid'),
            'name.max' => __('field.name.max'),
            'locale.required' => __('field.locale.unknown'),
            'locale.in' => __('field.locale.unknown'),
            'timezone.required' => __('field.timezone.unknown'),
            'timezone.string' => __('field.timezone.unknown'),
            'timezone.timezone' => __('field.timezone.unknown'),
            'week_start.required' => __('field.week_start.invalid'),
            'week_start.integer' => __('field.week_start.invalid'),
            'week_start.in' => __('field.week_start.invalid'),
        ])->validate();

        $current = [
            'name' => $organization->name,
            'locale' => $organization->locale->value,
            'timezone' => $organization->timezone,
            'week_start' => $organization->week_start,
        ];

        $changes = [];

        foreach ($current as $field => $old) {
            if (! array_key_exists($field, $valid)) {
                continue;
            }

            $new = $field === 'week_start' ? (int) $valid[$field] : $valid[$field];

            if ($new !== $old) {
                $changes[$field] = ['old' => $old, 'new' => $new];
            }
        }

        $changed = DB::transaction(function () use ($actor, $organization, $valid, $logo, $changes): bool {
            if (array_key_exists('logo_url', $valid)) {
                $changes += array_filter(['logo_url' => ImageInput::apply($organization, 'logo', $valid['logo_url'], $logo)]);
            }

            if ($changes === []) {
                return false;
            }

            $organization->update(array_map(fn (array $change) => $change['new'], array_diff_key($changes, ['logo_url' => true])));
            EventRecorder::record(EventType::OrganizationUpdated, $actor, $organization, null, $changes);

            return true;
        });

        if (! $changed) {
            return Organization::current();
        }

        // the rest of the request (shared props, the language) sees the new state
        app()->instance(Organization::class, $organization->refresh());

        return $organization;
    }
}
