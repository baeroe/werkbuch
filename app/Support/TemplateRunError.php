<?php

namespace App\Support;

use App\Actions\Templates\DraftFromTemplate;
use App\Domain\Time\OrgCalendar;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Property;
use App\Models\Template;
use App\Models\TypeProperty;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Validation\ValidationException;

/**
 * What a run of a template hands CreateWorkItem, and the sentence of its run log when the item could not be made (spec
 * 4.12, port of `failureText` of the clickdummy). Both in the language of the organisation: the caller sets it for the
 * run (K3).
 */
final class TemplateRunError
{
    /**
     * The input of CreateWorkItem for the item of a run at `$at` (the term, or now for a run by hand): the fields of
     * DraftFromTemplate::input() on the calendar of the organisation at that moment (the title rendered then, the dates
     * counted from its day, labels that are gone and values of keys the type has no more left out, A340), the
     * description as `description_json`.
     *
     * @return array<string, mixed>
     */
    public static function input(Template $template, DateTimeImmutable $at, Organization $organization): array
    {
        $calendar = new OrgCalendar(new DateTimeZone($organization->timezone), $organization->week_start, $at);
        $input = DraftFromTemplate::input($template, $calendar, $organization->locale->value);
        $input['description_json'] = $input['description'];
        unset($input['description']);

        return $input;
    }

    /**
     * The sentence for a refused item: missing required properties of the type named by their labels in the order of
     * the type („Pflicht-Property Umgebung fehlt“, several joined with commas and „und“ before the last), otherwise the
     * first message of a field, the detail of a problem, or the sentence of its reason.
     *
     * @param  array<string, mixed>  $payload  the payload of the template (its type)
     */
    public static function text(ValidationException|Problem $refusal, array $payload): string
    {
        $errors = $refusal instanceof ValidationException ? $refusal->errors() : $refusal->errors;

        $missing = [];
        foreach (self::properties($payload) as $property) {
            if (($errors["values.{$property->key}"][0] ?? null) === __('field.values.required', ['label' => $property->label])) {
                $missing[] = $property->label;
            }
        }
        if ($missing !== []) {
            $last = array_pop($missing);
            $named = $missing === [] ? $last : implode(', ', $missing).' '.__('templates.run.and').' '.$last;

            return $missing === []
                ? __('templates.run.required_missing.one', ['properties' => $named])
                : __('templates.run.required_missing.other', ['properties' => $named]);
        }

        $first = array_values(array_filter(array_merge(...array_values(array_map(fn ($messages) => (array) $messages, $errors))), is_string(...)))[0] ?? null;

        if ($refusal instanceof Problem && $refusal->detail !== null) {
            return $refusal->detail;
        }

        return $first ?? ($refusal instanceof Problem ? __("problem.reason.{$refusal->reason}") : $refusal->getMessage());
    }

    /**
     * The properties of the payload's type, in the order of the type.
     *
     * @param  array<string, mixed>  $payload
     * @return list<Property>
     */
    private static function properties(array $payload): array
    {
        $type = is_string($payload['type_id'] ?? null) ? $payload['type_id'] : null;

        return array_values(TypeProperty::query()->where('type_id', $type)->with('property')->orderBy('position')->orderBy('id')->get()
            ->map(fn (TypeProperty $entry) => $entry->property)->all());
    }
}
