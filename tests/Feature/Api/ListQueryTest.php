<?php

use App\Domain\Catalog\Tone;
use App\Http\Api\ApiList;
use App\Http\Resources\LabelResource;
use App\Models\Label;
use App\Models\WorkItemType;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\Cursor;
use Illuminate\Support\Facades\Route;

/*
 * The rules of a list (A386): `ListSpec` names the filters, sorts and includes, `ListQuery` checks the query against
 * them and builds it with the query builder, and the cursor carries the signature of the sort (K12). Two lists of the
 * test: the labels (exact, partial, a sort by name and by creation) and the work item types (booleans, scopes, an
 * include).
 */

$labels = fn (): ListSpec => new ListSpec(
    filters: [
        ListFilter::exact('color', values: array_column(Tone::cases(), 'value')),
        ListFilter::partial('name'),
        ListFilter::exact('id'),
    ],
    sorts: ['name' => 'labels.name', 'created_at' => 'labels.created_at'],
    default: ['name'],
);

$types = fn (): ListSpec => new ListSpec(
    filters: [
        ListFilter::boolean('is_epic'),
        ListFilter::scope('archived', 'boolean', fn (Builder $query, mixed $archived) => $archived
            ? $query->whereNotNull('archived_at') : $query->whereNull('archived_at')),
        ListFilter::scope('names', 'list<string>', fn (Builder $query, mixed $names) => $query->whereIn('name', (array) $names)),
    ],
    sorts: ['name' => 'work_item_types.name'],
    default: ['-name'],
    includes: ['typeProperties'],
);

beforeEach(function () use ($labels, $types) {
    Route::middleware('api')->prefix('api/v1')->group(function () use ($labels, $types) {
        Route::get('_t/labels', function (Request $request) use ($labels) {
            [$query, $signature] = ListQuery::apply(Label::query(), $request->query(), $labels());

            return ApiList::respond(ListResult::of($query, PageArgs::from($request->query()), $signature), LabelResource::class);
        });
        Route::get('_t/types', function (Request $request) use ($types) {
            [$query] = ListQuery::apply(WorkItemType::query(), $request->query(), $types());

            return response()->json($query->get()->map(fn (WorkItemType $type) => [
                'name' => $type->name, 'properties' => $type->relationLoaded('typeProperties'),
            ]));
        });
        // a list of a fixed order (newest first), like the comments or the history
        Route::get('_t/fixed', function (Request $request) {
            [$query, $signature] = ListQuery::apply(Label::query()->orderByDesc('name')->orderBy('id'), $request->query(), ListSpec::fixed());

            return ApiList::respond(ListResult::of($query, PageArgs::from($request->query()), $signature), LabelResource::class);
        });
    });
});

/** The names of the labels a list answers, in its order. */
$names = fn ($response): array => array_column($response->assertOk()->json('data'), 'name');

/** A cursor as Laravel encodes it, with whatever parameters a test makes up. */
$forge = fn (array $parameters, bool $next = true): string => (new Cursor($parameters, $next))->encode();

it('filters exactly, partly and by a boolean', function () use ($names) {
    Label::factory()->create(['name' => 'Backend', 'color' => Tone::Sand]);
    Label::factory()->create(['name' => 'Frontend', 'color' => Tone::Sky]);
    $customer = Label::factory()->create(['name' => 'Kunde, intern', 'color' => Tone::Moss]);
    Label::factory()->create(['name' => '100%', 'color' => Tone::Moss]);

    expect($names($this->getJson('/api/v1/_t/labels?filter[color]=sand')))->toBe(['Backend'])
        // several values of an exact filter, separated by commas
        ->and($names($this->getJson('/api/v1/_t/labels?filter[color]=sand,sky')))->toBe(['Backend', 'Frontend'])
        ->and($names($this->getJson('/api/v1/_t/labels?filter[name]=END')))->toBe(['Backend', 'Frontend'])
        // a partial filter never splits at a comma (K11), and `%` is a character, not a wildcard
        ->and($names($this->getJson('/api/v1/_t/labels?filter[name]='.urlencode('e, i'))))->toBe(['Kunde, intern'])
        ->and($names($this->getJson('/api/v1/_t/labels?filter[name]='.urlencode('0%'))))->toBe(['100%'])
        ->and($names($this->getJson('/api/v1/_t/labels?filter[id]='.$customer->id.'&filter[color]=moss')))->toBe(['Kunde, intern'])
        // an empty value is no condition (as in the shorthand of the item lists)
        ->and($names($this->getJson('/api/v1/_t/labels?filter[name]=&filter[color]=')))->toHaveCount(4);

    WorkItemType::factory()->archived()->create(['name' => 'Altlast']);
    $type = fn (string $query) => array_column($this->getJson('/api/v1/_t/types?'.$query)->assertOk()->json(), 'name');

    // booleans as Laravel's `boolean` reads them: `1` and `0` (the browser sends those)
    expect($type('filter[is_epic]=1'))->toBe(['Epic'])
        ->and($type('filter[is_epic]=0'))->toBe(['Task', 'Bug', 'Altlast'])
        ->and($type('filter[archived]=1'))->toBe(['Altlast'])
        ->and($type('filter[archived]=0&filter[is_epic]=0'))->toBe(['Task', 'Bug'])
        ->and($type('filter[names]=Task,Epic'))->toBe(['Task', 'Epic'])
        ->and($type('filter[names]=Bug'))->toBe(['Bug'])
        ->and($type('filter[archived]=&filter[is_epic]='))->toHaveCount(4);

    // an include loads its relation; without it, nothing is loaded
    expect($this->getJson('/api/v1/_t/types?include=typeProperties')->json('0.properties'))->toBeTrue()
        ->and($this->getJson('/api/v1/_t/types')->json('0.properties'))->toBeFalse();
});

it('takes the values of a boolean filter as Laravel does, also from a call in PHP', function () {
    $epics = fn (mixed $value) => ListQuery::apply(WorkItemType::query(), ['filter' => ['is_epic' => $value]], new ListSpec([ListFilter::boolean('is_epic')]))[0]
        ->pluck('name')->all();

    expect($epics(true))->toBe(['Epic'])->and($epics(1))->toBe(['Epic'])->and($epics('1'))->toBe(['Epic'])
        ->and($epics(false))->toHaveCount(2)->and($epics(0))->toHaveCount(2)->and($epics('0'))->toHaveCount(2);
});

it('sorts by name both ways and ends on the id', function () use ($names) {
    $this->freezeSecond();
    $made = collect(['Gamma', 'Alpha', 'Beta'])->map(fn (string $name) => Label::factory()->create(['name' => $name]));

    expect($names($this->getJson('/api/v1/_t/labels')))->toBe(['Alpha', 'Beta', 'Gamma'])
        ->and($names($this->getJson('/api/v1/_t/labels?sort=name')))->toBe(['Alpha', 'Beta', 'Gamma'])
        ->and($names($this->getJson('/api/v1/_t/labels?sort=-name')))->toBe(['Gamma', 'Beta', 'Alpha'])
        // three labels of one second: the ULID decides, in both directions of the sort
        ->and($names($this->getJson('/api/v1/_t/labels?sort=created_at')))->toBe($made->sortBy('id')->pluck('name')->all())
        ->and($names($this->getJson('/api/v1/_t/labels?sort=-created_at')))->toBe($made->sortBy('id')->pluck('name')->all());

    // a default sort descending (`-name`) holds without a sort in the query
    $types = array_column($this->getJson('/api/v1/_t/types')->assertOk()->json(), 'name');
    expect($types)->toBe(['Task', 'Epic', 'Bug']);
});

it('ends on the id after the sort and signs the order', function () {
    $query = Label::query();
    [$built, $signature] = ListQuery::apply($query, ['sort' => '-name,created_at,-name'], new ListSpec(
        sorts: ['name' => 'labels.name', 'created_at' => 'labels.created_at'],
    ));

    // a sort named twice counts once, where it first stands
    expect($signature)->toBe('name:desc,created_at:asc,id:asc')
        ->and($built)->toBe($query)
        ->and($built->toRawSql())->toEndWith('order by `labels`.`name` desc, `labels`.`created_at` asc, `labels`.`id` asc')
        ->and(ListQuery::apply(Label::query(), [], new ListSpec)[1])->toBe('id:asc');
});

it('refuses an unknown filter, sort and include in one 422', function () {
    $this->getJson('/api/v1/_t/labels?filter[nope]=1&filter[other]=2&sort=name,-nope&include=nope')->assertUnprocessable()
        ->assertJsonPath('reason', 'validation_failed')
        ->assertJsonPath('errors.filter', [
            __('field.list.filter', ['name' => 'nope', 'allowed' => 'color, name, id']),
            __('field.list.filter', ['name' => 'other', 'allowed' => 'color, name, id']),
        ])
        ->assertJsonPath('errors.sort', [__('field.list.sort', ['name' => 'nope', 'allowed' => 'name, created_at'])])
        ->assertJsonPath('errors.include', [__('field.list.include', ['name' => 'nope', 'allowed' => __('field.list.none')])]);

    // the allowed includes are named, an include of an allowed name with a suffix of the query builder is none of them
    $this->getJson('/api/v1/_t/types?include=typePropertiesCount')->assertUnprocessable()
        ->assertJsonPath('errors.include', [__('field.list.include', ['name' => 'typePropertiesCount', 'allowed' => 'typeProperties'])]);
});

it('refuses a filter that is no object and a sort or include that is no text', function () {
    $this->getJson('/api/v1/_t/labels?filter=nope&sort[]=name&include[]=x')->assertUnprocessable()
        ->assertJsonPath('errors.filter', [__('field.list.filter_object')])
        ->assertJsonPath('errors.sort', [__('field.list.names')])
        ->assertJsonPath('errors.include', [__('field.list.names')]);
});

it('refuses a filter value outside its values', function () {
    $this->getJson('/api/v1/_t/labels?filter[color]=sand,purple&filter[name][]=a')->assertUnprocessable()
        ->assertJsonPath('errors', [
            'filter.color' => [__('field.list.filter_value', ['name' => 'color', 'allowed' => 'sky, ochre, moss, plum, sand, slate'])],
            'filter.name' => [__('field.list.filter_text', ['name' => 'name'])],
        ]);

    // Laravel's `boolean` takes no `true` (the query builder would): one rule for every flag of the API
    $this->getJson('/api/v1/_t/types?filter[is_epic]=true&filter[archived]=yes&filter[names][]=Task')->assertUnprocessable()
        ->assertJsonPath('errors', [
            'filter.is_epic' => [__('field.list.filter_value', ['name' => 'is_epic', 'allowed' => '1, 0'])],
            'filter.archived' => [__('field.list.filter_value', ['name' => 'archived', 'allowed' => '1, 0'])],
            'filter.names' => [__('field.list.filter_text', ['name' => 'names'])],
        ]);
});

it('leaves a fixed list alone and refuses its filter, sort and include', function () use ($names) {
    collect(['Alpha', 'Gamma', 'Beta'])->each(fn (string $name) => Label::factory()->create(['name' => $name]));

    // the order the list brings, without a second one and without a signature
    $first = $this->getJson('/api/v1/_t/fixed?per_page=2');
    expect($names($first))->toBe(['Gamma', 'Beta'])
        ->and(json_decode(base64_decode(strtr((string) $first->json('meta.next_cursor'), '-_', '+/')), true))->not->toHaveKey('_sig')
        ->and($names($this->getJson('/api/v1/_t/fixed?per_page=2&cursor='.$first->json('meta.next_cursor'))))->toBe(['Alpha']);

    $none = __('field.list.none');
    $this->getJson('/api/v1/_t/fixed?filter[name]=a&sort=name&include=x')->assertUnprocessable()
        ->assertJsonPath('errors.filter', [__('field.list.filter', ['name' => 'name', 'allowed' => $none])])
        ->assertJsonPath('errors.sort', [__('field.list.sort', ['name' => 'name', 'allowed' => $none])])
        ->assertJsonPath('errors.include', [__('field.list.include', ['name' => 'x', 'allowed' => $none])]);

    // empty parameters are no filter, sort or include
    expect($names($this->getJson('/api/v1/_t/fixed?filter=&sort=&include=')))->toBe(['Gamma', 'Beta', 'Alpha']);
});

it('refuses the cursor of another sort', function () use ($names) {
    collect(['Alpha', 'Beta', 'Gamma'])->each(fn (string $name) => Label::factory()->create(['name' => $name]));

    $first = $this->getJson('/api/v1/_t/labels?sort=name&per_page=1');
    $cursor = $first->json('meta.next_cursor');
    expect(json_decode(base64_decode(strtr((string) $cursor, '-_', '+/')), true))->toMatchArray(['_sig' => 'name:asc,id:asc']);

    // the same order is the default one: its cursor leads on
    expect($names($this->getJson('/api/v1/_t/labels?per_page=1&cursor='.$cursor)))->toBe(['Beta']);

    foreach (['sort=-name', 'sort=created_at', 'sort=name,created_at'] as $other) {
        $this->getJson("/api/v1/_t/labels?{$other}&per_page=1&cursor={$cursor}")->assertUnprocessable()
            ->assertJsonPath('errors.cursor', [__('field.cursor.invalid')]);
    }

    // a cursor of the fixed list (no signature) belongs to no list with a sort, and a signed one to no fixed list
    $fixed = $this->getJson('/api/v1/_t/fixed?per_page=1')->json('meta.next_cursor');
    $this->getJson('/api/v1/_t/labels?per_page=1&cursor='.$fixed)->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
    $this->getJson('/api/v1/_t/fixed?per_page=1&cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
});

it('refuses a cursor with an unknown column and a broken one', function () use ($forge) {
    Label::factory()->count(2)->create();
    $signature = 'name:asc,id:asc';

    $broken = [
        // signed, but without the columns of the order
        $forge(['labels.color' => 'sand', '_sig' => $signature]),
        $forge(['labels.name' => 'x', '_sig' => $signature]),
        // a value that is no single value
        $forge(['labels.name' => ['x'], 'labels.id' => 'y', '_sig' => $signature]),
        // the signature of another type, the direction of no type
        $forge(['labels.name' => 'x', 'labels.id' => 'y', '_sig' => 7]),
        rtrim(strtr(base64_encode((string) json_encode(['labels.name' => 'x', 'labels.id' => 'y', '_sig' => $signature, '_pointsToNextItems' => 'yes'])), '+/', '-_'), '='),
        rtrim(strtr(base64_encode((string) json_encode(['labels.name' => 'x', 'labels.id' => 'y', '_sig' => $signature])), '+/', '-_'), '='),
        // no JSON object, no JSON, no base64
        rtrim(strtr(base64_encode('[1, 2]'), '+/', '-_'), '='),
        rtrim(strtr(base64_encode('{"a"'), '+/', '-_'), '='),
        'not a cursor!',
    ];

    foreach ($broken as $cursor) {
        $this->getJson('/api/v1/_t/labels?per_page=1&cursor='.urlencode($cursor))->assertUnprocessable()
            ->assertJsonPath('reason', 'validation_failed')->assertJsonPath('errors.cursor', [__('field.cursor.invalid')]);
    }

    // a well formed cursor of this order with made up values is a page, maybe an empty one
    $this->getJson('/api/v1/_t/labels?per_page=1&cursor='.$forge(['labels.name' => 'zzz', 'labels.id' => 'y', '_sig' => $signature]))
        ->assertOk()->assertJsonCount(0, 'data');
});

it('takes the cursor of the same list with another per_page and leads back with prev_cursor', function () use ($names) {
    collect(['Alpha', 'Beta', 'Gamma', 'Delta'])->each(fn (string $name) => Label::factory()->create(['name' => $name]));

    $first = $this->getJson('/api/v1/_t/labels?sort=-name&per_page=1');
    expect($names($first))->toBe(['Gamma']);

    $second = $this->getJson('/api/v1/_t/labels?sort=-name&per_page=2&cursor='.$first->json('meta.next_cursor'));
    expect($names($second))->toBe(['Delta', 'Beta'])
        ->and($names($this->getJson('/api/v1/_t/labels?sort=-name&per_page=5&cursor='.$second->json('meta.prev_cursor'))))->toBe(['Gamma']);
});

it('keeps the filters in links.next', function () use ($names) {
    collect(['Alpha', 'Beta', 'Gamma'])->each(fn (string $name) => Label::factory()->create(['name' => $name, 'color' => Tone::Sand]));
    Label::factory()->create(['name' => 'Aaron', 'color' => Tone::Sky]);

    $first = $this->getJson('/api/v1/_t/labels?filter[color]=sand&sort=-name&per_page=2');
    expect($names($first))->toBe(['Gamma', 'Beta'])->and($first->json('meta.total'))->toBe(3);

    $next = (string) $first->json('links.next');
    parse_str((string) parse_url($next, PHP_URL_QUERY), $query);
    expect($query)->toMatchArray(['filter' => ['color' => 'sand'], 'sort' => '-name', 'per_page' => '2']);

    $following = $this->getJson($next);
    expect($names($following))->toBe(['Alpha'])->and($following->json('links.next'))->toBeNull();
});

it('takes the text of a filter as it is, also true, false, 0 and 1', function () use ($names) {
    Label::factory()->create(['name' => 'Backend']);
    Label::factory()->create(['name' => 'true story']);
    Label::factory()->create(['name' => '100% 1']);

    foreach (['false', 'true', '0', '1'] as $text) {
        $partial = $this->getJson('/api/v1/_t/labels?filter[name]='.$text)->assertOk();
        expect($names($partial))->toBe(match ($text) {
            'true' => ['true story'],
            '1', '0' => ['100% 1'],
            default => [],
        });
    }
    // exact on a text column: the text only, never a number or a truth value
    Label::factory()->create(['name' => 'x', 'color' => Tone::Sand]);
    $this->getJson('/api/v1/_t/labels?filter[id]=false')->assertOk()->assertJsonPath('meta.total', 0);
    $this->getJson('/api/v1/_t/labels?filter[id]=0')->assertOk()->assertJsonPath('meta.total', 0);
    $this->getJson('/api/v1/_t/labels?filter[id]='.strtoupper((string) Label::query()->value('id')))->assertOk()->assertJsonPath('meta.total', 1);
});
