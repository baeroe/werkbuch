<?php

namespace App\Views;

use App\Access\Authorize;
use App\Domain\Filter\Condition;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\SchemaMessages;
use Illuminate\Validation\ValidationException;

/**
 * The short form of a filter (P16): `filter[project]=WEB&filter[assignee]=me` of a query string (and `shorthand` of a
 * query body), read into conditions of the one engine, so it matches what the long form matches.
 *
 * - `project`, `parent`: a reference as in Phase 4 (ULID in any case, identifier or key, also a former one); unknown or
 *   unseen is 404, as before. They become `project is <id>` and `parent is <id>`.
 * - `assignee`, `created_by`: `me`, `none` (`is_empty`) or ULIDs separated by commas (`in`).
 * - `type`, `state`, `label`: ULIDs separated by commas (`in`); `state_category`, `priority`: their words (`in`).
 * - `archived`: `true` or `false`.
 * - `q`: the search of Phase 4 (ItemQuery::search), no condition.
 *
 * Every value then goes through FilterSchema::parse, so a value of the wrong form is a 422 at `<at>.<key>`; an empty
 * value is no condition. Anything that is no object of texts of these keys is a 422 at `<at>`: an unknown key would
 * silently answer every item.
 */
final class Shorthand
{
    public const KEYS = ['project', 'parent', 'q', 'assignee', 'created_by', 'type', 'state', 'state_category', 'priority', 'label', 'archived'];

    /** The keys that name people: `me`, `none` or ULIDs. */
    private const PEOPLE = ['assignee', 'created_by'];

    /**
     * @param  array<array-key, mixed>  $filter
     * @param  string  $at  where the short form stands in the request: `filter` (query string) or `shorthand` (body)
     * @return array{conditions: list<Condition>, q: ?string}
     *
     * @throws Problem 404 for a project or parent the account does not see
     * @throws ValidationException
     */
    public static function read(array $filter, Actor $actor, string $at = 'filter'): array
    {
        $unknown = array_diff(array_map('strval', array_keys($filter)), self::KEYS);
        $texts = array_filter($filter, fn (mixed $value) => $value !== null && ! is_string($value));
        if ($unknown !== [] || $texts !== []) {
            throw ValidationException::withMessages([$at => __('field.filter.invalid', ['keys' => implode(', ', self::KEYS)])]);
        }

        /** @var array<string, string> $values */
        $values = array_filter(array_map(fn (?string $value) => $value === null ? '' : trim($value), $filter), fn (string $value) => $value !== '');

        $conditions = [];
        $errors = [];
        foreach ($values as $key => $value) {
            $raw = match (true) {
                $key === 'q' => null,
                $key === 'project' => ['field' => 'project', 'op' => 'is', 'value' => self::project($value, $actor)],
                $key === 'parent' => ['field' => 'parent', 'op' => 'is', 'value' => self::parent($value, $actor)],
                // anything but the two words is no value of the flag
                $key === 'archived' => ['field' => 'archived', 'op' => 'is', 'value' => ['true' => true, 'false' => false][$value] ?? $value],
                in_array($key, self::PEOPLE, true) && $value === 'none' => ['field' => $key, 'op' => 'is_empty'],
                default => ['field' => $key, 'op' => 'in', 'value' => array_map('trim', explode(',', $value))],
            };
            if ($raw === null) {
                continue;
            }

            try {
                $conditions[] = FilterSchema::parse(['version' => 1, 'conditions' => [$raw]], app(CatalogProperties::class))->conditions[0];
            } catch (InvalidInput $invalid) {
                // the one condition stands at the key of the short form
                $errors["{$at}.{$key}"] = $key === 'archived' ? __('field.boolean') : array_values(SchemaMessages::filter($invalid, $at))[0];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return ['conditions' => $conditions, 'q' => $values['q'] ?? null];
    }

    /**
     * @throws Problem 404
     */
    private static function project(string $ref, Actor $actor): string
    {
        $project = Project::findByReference($ref) ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $project);

        return $project->id;
    }

    /**
     * @throws Problem 404
     */
    private static function parent(string $ref, Actor $actor): string
    {
        $parent = WorkItem::findByReference($ref) ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $parent);

        return $parent->id;
    }
}
