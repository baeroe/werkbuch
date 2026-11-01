<?php

namespace App\Views;

use App\Access\Authorize;
use App\Domain\Filter\Condition;
use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Domain\Views\GroupBy;
use App\Domain\Views\SortSpec;
use App\Exceptions\Problem;
use App\Models\View;
use App\Support\Actor;
use App\Support\PageArgs;
use App\Support\SchemaMessages;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * What an item list asks for, read from the body of `POST /work-items/query` or the query string of `GET /work-items`
 * (plan, REST). `filter` holds the conditions of the request: the long form and the short form together (Shorthand);
 * ItemQuery::filterOf() adds those of the view and of `show_sub_items`.
 *
 * - Body: `view_id` (a view by ULID, any case; anything else is no view: 404), `filter` (FilterSchema::parse, errors
 *   below `filter.`), `shorthand` (an object like `filter[…]` of the query string, errors below `shorthand.`), `q` (the
 *   search; not together with `shorthand.q`), `sort` (`{field, direction}`), `show_sub_items` (by default that of the
 *   view, else `true`), `group_by` and `group` (the items of one group: `group` needs `group_by` and a key a group of
 *   it can have, Grouping::key; `group_by` alone changes nothing), `include_archived`, `lean`, `cursor`, `per_page`.
 *   `null` is the same as a key left out; any other key is 422 `field.query.unknown` at it. The groups and the counts
 *   take fewer keys (`$keys`), the groups need `group_by`.
 * - Query string: `view`, `filter[…]` (only the short form), `sort` (`due_date`, `-due_date`), `include_archived`,
 *   `lean`, `cursor`, `per_page`; `include` is refused (the list embeds nothing, A157), other keys are passed over.
 *
 * Every field error of the request comes in one 422; an unknown view or a short-form project or parent the account
 * does not see is a 404 first.
 */
final readonly class ItemQueryInput
{
    /** The keys of a query body. */
    public const BODY_KEYS = ['view_id', 'filter', 'shorthand', 'q', 'sort', 'show_sub_items', 'group_by', 'group', 'include_archived', 'lean', 'cursor', 'per_page'];

    public function __construct(
        public ?View $view,
        public Filter $filter,
        public ?SortSpec $sort,
        public ?string $q,
        public bool $showSubItems,
        public bool $includeArchived,
        public bool $lean,
        public ?GroupBy $groupBy,
        public ?string $group,
        public PageArgs $page,
    ) {}

    /**
     * @param  array<array-key, mixed>  $body
     * @param  list<string>  $keys  the keys the body may have (a part of BODY_KEYS)
     * @param  bool  $groupByRequired  whether `group_by` must be there (the groups)
     *
     * @throws Problem 404 for an unknown view, or a short-form project or parent the account does not see
     * @throws ValidationException
     */
    public static function fromBody(array $body, Actor $actor, array $keys = self::BODY_KEYS, bool $groupByRequired = false): self
    {
        $errors = [];
        foreach (array_diff(array_map('strval', array_keys($body)), $keys) as $unknown) {
            $errors[$unknown] = __('field.query.unknown', ['keys' => implode(', ', $keys)]);
        }
        // a key the body may not have is never read (a short form would answer 404 before the 422)
        $body = array_filter(array_intersect_key($body, array_flip($keys)), fn (mixed $value) => $value !== null);

        $view = array_key_exists('view_id', $body) ? self::view($body['view_id'], $actor) : null;
        $flags = self::flags($body, ['show_sub_items', 'include_archived', 'lean'], $errors);

        $q = $body['q'] ?? null;
        if ($q !== null && ! is_string($q)) {
            $errors['q'] = __('field.query.text');
        }

        $filter = Filter::empty();
        if (array_key_exists('filter', $body)) {
            try {
                $filter = FilterSchema::parse($body['filter'], app(CatalogProperties::class));
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::filter($invalid, 'filter')];
            }
        }

        $sort = null;
        if (array_key_exists('sort', $body)) {
            try {
                $sort = SortSpec::parse($body['sort'], app(CatalogProperties::class));
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::sort($invalid, 'sort')];
            }
        }

        $shorthand = $body['shorthand'] ?? [];
        if (! is_array($shorthand)) {
            $errors['shorthand'] = __('field.filter.invalid', ['keys' => implode(', ', Shorthand::KEYS)]);
            $shorthand = [];
        }
        $short = self::shorthand($shorthand, $actor, 'shorthand', $errors);
        if (is_string($q) && $short['q'] !== null) {
            $errors['q'] = __('field.query.q_twice');
        }

        [$groupBy, $group] = self::grouping($body, $groupByRequired, $errors);
        $page = self::page($body, $errors);
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return new self(
            $view,
            $filter->and(new Filter($short['conditions'])),
            $sort,
            self::search(is_string($q) ? $q : $short['q']),
            $flags['show_sub_items'] ?? $view?->display()->showSubItems ?? true,
            $flags['include_archived'] ?? false,
            $flags['lean'] ?? false,
            $groupBy,
            $group,
            $page,
        );
    }

    /**
     * @param  array<array-key, mixed>  $query
     *
     * @throws Problem 404 for an unknown view, or a short-form project or parent the account does not see
     * @throws ValidationException
     */
    public static function fromQuery(array $query, Actor $actor): self
    {
        $errors = [];
        if (array_key_exists('include', $query)) {
            // the list embeds nothing (`include` is for one item): never silently answered without what was asked for
            $errors['include'] = __('field.include.list');
        }
        $query = array_filter($query, fn (mixed $value) => $value !== null);

        $view = array_key_exists('view', $query) ? self::view($query['view'], $actor) : null;
        $flags = self::flags($query, ['include_archived', 'lean'], $errors);

        $sort = null;
        if (array_key_exists('sort', $query)) {
            try {
                $sort = SortSpec::fromQuery(is_string($query['sort']) ? $query['sort'] : '', app(CatalogProperties::class));
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::sort($invalid, 'sort')];
            }
        }

        $filter = $query['filter'] ?? [];
        if (! is_array($filter)) {
            $errors['filter'] = __('field.filter.invalid', ['keys' => implode(', ', Shorthand::KEYS)]);
            $filter = [];
        }
        $short = self::shorthand($filter, $actor, 'filter', $errors);

        $page = self::page($query, $errors);
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return new self(
            $view,
            new Filter($short['conditions']),
            $sort,
            self::search($short['q']),
            $view?->display()->showSubItems ?? true,
            $flags['include_archived'] ?? false,
            $flags['lean'] ?? false,
            null,
            null,
            $page,
        );
    }

    /**
     * The view a request names: by ULID in any case; anything else, or a view the account may not read, is 404.
     *
     * @throws Problem 404
     */
    private static function view(mixed $ref, Actor $actor): View
    {
        $id = is_string($ref) && Str::isUlid($ref) ? strtolower($ref) : null;
        $view = $id === null ? null : View::query()->find($id);
        if ($view === null) {
            throw Problem::notFound();
        }
        Authorize::check($actor, 'view', $view);

        return $view;
    }

    /**
     * The input of the counts (CountWorkItems): one filter over all projects the account sees, nothing else.
     */
    public static function ofFilter(Filter $filter, bool $includeArchived): self
    {
        return new self(null, $filter, null, null, true, $includeArchived, false, null, null, new PageArgs(null, PageArgs::MAX_PER_PAGE));
    }

    /**
     * `group_by` (a GroupBy) and `group` (a key a group of it can have, in its stored form); `group` needs `group_by`.
     *
     * @param  array<array-key, mixed>  $body
     * @param  array<array-key, mixed>  $errors
     * @return array{?GroupBy, ?string}
     */
    private static function grouping(array $body, bool $required, array &$errors): array
    {
        $by = $body['group_by'] ?? null;
        $groupBy = is_string($by) ? GroupBy::tryFrom($by) : null;
        if ($by !== null && $groupBy === null) {
            $errors['group_by'] = __('field.group_by.invalid');
        } elseif ($by === null && ($required || array_key_exists('group', $body))) {
            $errors['group_by'] = __('field.group_by.required');
        }

        $group = $body['group'] ?? null;
        $key = $groupBy !== null && is_string($group) ? Grouping::key($groupBy, $group) : null;
        if ($group !== null && $groupBy !== null && $key === null) {
            $errors['group'] = __('field.group.invalid');
        }

        return [$groupBy, $key];
    }

    /**
     * The flags the input sends (`true`, `false`, `1`, `0`, `'1'`, `'0'`), each a 422 at its key otherwise.
     *
     * @param  array<array-key, mixed>  $input
     * @param  list<string>  $keys
     * @param  array<array-key, mixed>  $errors
     * @return array<string, bool>
     */
    public static function flags(array $input, array $keys, array &$errors): array
    {
        $flags = [];
        foreach ($keys as $key) {
            if (! array_key_exists($key, $input)) {
                continue;
            }
            // the values of Laravel's rule `boolean`
            $flag = match (true) {
                in_array($input[$key], [true, 1, '1'], true) => true,
                in_array($input[$key], [false, 0, '0'], true) => false,
                default => null,
            };
            if ($flag === null) {
                $errors[$key] = $key === 'include_archived' ? __('field.include_archived.invalid') : __('field.boolean');

                continue;
            }
            $flags[$key] = $flag;
        }

        return $flags;
    }

    /**
     * The short form, its field errors added to the others; a 404 goes through.
     *
     * @param  array<array-key, mixed>  $filter
     * @param  array<array-key, mixed>  $errors
     * @return array{conditions: list<Condition>, q: ?string}
     *
     * @throws Problem 404
     */
    private static function shorthand(array $filter, Actor $actor, string $at, array &$errors): array
    {
        try {
            return Shorthand::read($filter, $actor, $at);
        } catch (ValidationException $invalid) {
            foreach ($invalid->errors() as $path => $messages) {
                $errors[$path] = $messages[0];
            }

            return ['conditions' => [], 'q' => null];
        }
    }

    /**
     * @param  array<array-key, mixed>  $input
     * @param  array<array-key, mixed>  $errors
     */
    private static function page(array $input, array &$errors): PageArgs
    {
        try {
            return PageArgs::from(array_intersect_key($input, ['cursor' => true, 'per_page' => true]));
        } catch (ValidationException $invalid) {
            foreach ($invalid->errors() as $path => $messages) {
                $errors[$path] = $messages[0];
            }

            return new PageArgs(null, PageArgs::MAX_PER_PAGE);
        }
    }

    /** The search of a request, trimmed; a blank one is none. */
    private static function search(?string $q): ?string
    {
        $q = trim($q ?? '');

        return $q === '' ? null : $q;
    }
}
