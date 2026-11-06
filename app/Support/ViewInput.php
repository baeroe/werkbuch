<?php

namespace App\Support;

use App\Domain\Catalog\TypeIcon;
use App\Domain\Emoji;
use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Domain\Views\Display;
use App\Domain\Views\DisplaySchema;
use App\Views\CatalogProperties;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The rules of a view's input: a name, an icon, a filter and a display, all four required both when creating and when
 * replacing (`PUT` replaces a view as a whole, A59, A75). Other keys (the `id`, `created_by` and stamps of an answer
 * sent back) are passed over. Every error comes in one 422: the filter and the display at the paths of their schemas
 * below `filter.` and `display.` (K2).
 */
final class ViewInput
{
    public const NAME_MAX = 60;

    /** The Lucide names a view can carry, as `VIEW_ICONS` in resources/js/components/ui/ViewIcon.tsx: the type icons and a few more. */
    public const ICONS = [
        ...TypeIcon::NAMES,
        'bot', 'building-2', 'calendar-clock', 'circle-dot', 'eye', 'inbox', 'list-todo', 'octagon-alert', 'route', 'timer',
        'user-round-check',
    ];

    /** The column `views.icon`. */
    public const ICON_MAX_BYTES = 32;

    /** The keys of the body, all four required (the OpenAPI document names them, K15). */
    public const FIELDS = ['name', 'icon', 'filter', 'display'];

    /**
     * @param  array<array-key, mixed>  $input  `name`, `icon`, `filter`, `display`
     * @return array{name: string, icon: string, filter: Filter, display: Display}
     *
     * @throws ValidationException
     */
    public static function validate(array $input): array
    {
        $errors = [];

        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $input)) {
                $errors[$field] = __('field.required');
            }
        }

        $name = $input['name'] ?? null;
        if (array_key_exists('name', $input)) {
            $name = is_string($name) ? Str::trim($name) : $name;

            if ($name === null || $name === '') {
                $errors['name'] = __('field.name.required');
            } elseif (! is_string($name)) {
                $errors['name'] = __('field.name.invalid');
            } elseif (mb_strlen($name) > self::NAME_MAX) {
                $errors['name'] = __('field.name.max', ['max' => self::NAME_MAX]);
            }
        }

        $icon = $input['icon'] ?? null;
        if (array_key_exists('icon', $input) && ! self::isIcon($icon)) {
            $errors['icon'] = __('field.icon.invalid');
        }

        $catalog = app(CatalogProperties::class);

        $filter = null;
        if (array_key_exists('filter', $input)) {
            try {
                $filter = FilterSchema::parse($input['filter'], $catalog);
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::filter($invalid, 'filter')];
            }
        }

        $display = null;
        if (array_key_exists('display', $input)) {
            try {
                $display = DisplaySchema::parse($input['display'], $catalog);
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::display($invalid, 'display')];
            }
        }

        if ($errors !== [] || ! is_string($name) || ! is_string($icon) || $filter === null || $display === null) {
            throw ValidationException::withMessages($errors);
        }

        return ['name' => $name, 'icon' => $icon, 'filter' => $filter, 'display' => $display];
    }

    /** One of `ICONS`, or exactly one emoji (`Emoji::is`) that fits the column. */
    public static function isIcon(mixed $icon): bool
    {
        return is_string($icon)
            && (in_array($icon, self::ICONS, true) || (strlen($icon) <= self::ICON_MAX_BYTES && Emoji::is($icon)));
    }
}
