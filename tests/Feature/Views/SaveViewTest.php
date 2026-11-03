<?php

use App\Actions\Views\SaveView;
use App\Domain\Catalog\TypeIcon;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Support\ViewInput;

/** A whole view as the interface sends it: bugs that are urgent, as a board by state. */
$input = fn (array $overrides = []): array => [
    'name' => 'Bugs in Produktion',
    'icon' => 'bug',
    'filter' => ['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'is', 'value' => 'urgent']]],
    'display' => [
        'layout' => 'board', 'group_by' => 'state', 'sort' => ['field' => 'rank', 'direction' => 'asc'],
        'fields' => ['key', 'title', 'assignee'], 'show_sub_items' => true,
    ],
    ...$overrides,
];

it('creates a view for every member of the organisation', function (Closure $account) use ($input) {
    $user = $account();

    $view = SaveView::run(actor($user), $input());

    expect($view->wasRecentlyCreated)->toBeTrue()
        ->and($view->created_by)->toBe($user->id)
        ->and($view->name)->toBe('Bugs in Produktion')
        ->and($view->icon)->toBe('bug')
        ->and($view->filter)->toBe(['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'is', 'value' => 'urgent']]])
        ->and($view->display['layout'])->toBe('board');

    $event = eventsOf(EventType::ViewCreated, $view)->sole();
    expect($event->actor_id)->toBe($user->id)
        ->and($event->project_id)->toBeNull()
        ->and($event->changes)->toBe(['name' => ['old' => null, 'new' => 'Bugs in Produktion']]);
})->with([
    'member' => [fn () => User::factory()->create()],
    'bot with the org role member' => [fn () => User::factory()->bot(User::factory()->create())->create()],
]);

it('lets the creator and org admins change a view, nobody else, with the reason', function () use ($input) {
    speakGerman();
    $ida = User::factory()->create(['name' => 'Ida Brenner']);
    $view = SaveView::run(actor($ida), $input());

    $this->actingAs($ida)->putJson("/api/v1/views/{$view->id}", $input(['icon' => 'flag']))->assertOk();
    $this->actingAs(User::factory()->admin()->create())->putJson("/api/v1/views/{$view->id}", $input(['icon' => 'eye']))->assertOk();
    $this->actingAs(User::factory()->create())->putJson("/api/v1/views/{$view->id}", $input(['icon' => 'inbox']))
        ->assertForbidden()->assertJsonPath('detail', 'Nur Ida Brenner und Org-Admins dürfen „Bugs in Produktion“ ändern.');

    expect($view->refresh()->icon)->toBe('eye')
        ->and(eventsOf(EventType::ViewUpdated, $view)->count())->toBe(2);
});

it('replaces the whole view and records only what changed', function () use ($input) {
    $ida = User::factory()->create();
    $view = SaveView::run(actor($ida), $input());
    $list = [...$input()['display'], 'layout' => 'list', 'group_by' => 'none'];

    $saved = SaveView::run(actor($ida), $input(['display' => $list]), $view);

    expect($saved->display)->toBe($list)
        ->and(eventsOf(EventType::ViewUpdated, $view)->sole()->changes)->toBe(['display' => ['old' => $input()['display'], 'new' => $list]]);
});

it('changes nothing for the same input', function () use ($input) {
    $ida = User::factory()->create();
    $view = SaveView::run(actor($ida), $input());
    $stamp = $view->refresh()->updated_at?->toJSON();

    $this->travel(5)->minutes();
    SaveView::run(actor($ida), $input(['name' => '  Bugs in Produktion ']), $view);

    expect(eventsOf(EventType::ViewUpdated)->count())->toBe(0)
        ->and($view->refresh()->updated_at?->toJSON())->toBe($stamp);
});

it('requires name, icon, filter and display', function (bool $replacing) {
    $ida = User::factory()->create();
    $view = $replacing ? View::factory()->create(['created_by' => $ida->id]) : null;

    expect(invalidOf(fn () => SaveView::run(actor($ida), ['id' => 'ignored'], $view)))->toBe([
        'name' => [__('field.required')],
        'icon' => [__('field.required')],
        'filter' => [__('field.required')],
        'display' => [__('field.required')],
    ]);
})->with(['creating' => false, 'replacing' => true]);

it('trims the name and refuses a long one', function () use ($input) {
    $ida = User::factory()->create();

    expect(SaveView::run(actor($ida), $input(['name' => "\u{00A0} Meine Bugs  "]))->name)->toBe('Meine Bugs')
        ->and(SaveView::run(actor($ida), $input(['name' => str_repeat('ä', ViewInput::NAME_MAX)]))->name)->toBe(str_repeat('ä', 60))
        ->and(invalidOf(fn () => SaveView::run(actor($ida), $input(['name' => str_repeat('a', 61)]))))->toBe(['name' => [__('field.name.max', ['max' => 60])]])
        ->and(invalidOf(fn () => SaveView::run(actor($ida), $input(['name' => '   ']))))->toBe(['name' => [__('field.name.required')]])
        ->and(invalidOf(fn () => SaveView::run(actor($ida), $input(['name' => null]))))->toBe(['name' => [__('field.name.required')]])
        ->and(invalidOf(fn () => SaveView::run(actor($ida), $input(['name' => ['Bugs']]))))->toBe(['name' => [__('field.name.invalid')]]);
});

it('takes a known icon or one emoji, nothing else', function (mixed $icon, bool $valid) use ($input) {
    $ida = User::factory()->create();
    $save = fn () => SaveView::run(actor($ida), $input(['icon' => $icon]));

    if ($valid) {
        expect($save()->icon)->toBe($icon);
    } else {
        expect(invalidOf($save))->toBe(['icon' => [__('field.icon.invalid')]]);
    }
})->with([
    'a type icon' => ['bug', true],
    'an icon of views' => ['calendar-clock', true],
    'an emoji' => ['🚀', true],
    'joined emoji' => ['👩‍💻', true],
    'an emoji with its selector' => ['❤️', true],
    'an unknown name' => ['skull-and-bones', false],
    'two emoji' => ['🚀🚀', false],
    'letters' => ['ab', false],
    'an emoji with a line break' => ["🚀\n", false],
    'too long for the column' => [implode("\u{200D}", array_fill(0, 9, '🚀')), false],
    'nothing' => ['', false],
    'no text' => [['bug'], false],
]);

it('takes an emoji with a skin tone, a flag and a keycap as icon', function () use ($input) {
    $ida = User::factory()->create();

    foreach (['👍🏽', '🇩🇪', "1\u{FE0F}\u{20E3}", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"] as $icon) {
        expect(SaveView::run(actor($ida), $input(['icon' => $icon]))->refresh()->icon)->toBe($icon);
    }
});

it('refuses © as icon', function () use ($input) {
    $save = fn () => SaveView::run(actor(User::factory()->create()), $input(['icon' => "\u{00A9}"]));

    expect(invalidOf($save))->toBe(['icon' => [__('field.icon.invalid')]]);
});

it('knows the icons the interface draws', function () {
    $source = (string) file_get_contents(repo_path('resources/js/components/ui/ViewIcon.tsx'));
    preg_match('/VIEW_ICONS[^{]*\{(.*?)\n\};/s', $source, $block);
    preg_match_all("/^\s+'?([a-z0-9-]+)'?:/m", $block[1], $names);

    expect($block[1])->toContain('...TYPE_ICONS')
        ->and(collect(ViewInput::ICONS)->sort()->values()->all())
        ->toBe(collect([...TypeIcon::NAMES, ...$names[1]])->sort()->values()->all());
});

it('stores the filter in its normal form', function () use ($input) {
    $web = Project::factory()->create();
    $filter = ['version' => 1, 'conditions' => [
        ['field' => 'project', 'op' => 'in', 'value' => [strtoupper($web->id), $web->id]],
        ['field' => 'archived', 'op' => 'is', 'value' => false],
    ]];

    $view = SaveView::run(actor(User::factory()->create()), $input(['filter' => $filter]));

    expect($view->refresh()->filter)->toBe(['version' => 1, 'conditions' => [
        ['field' => 'project', 'op' => 'in', 'value' => [$web->id]],
        ['field' => 'archived', 'op' => 'is', 'value' => false],
    ]]);
});

it('refuses an invalid filter at the path of the condition', function () use ($input) {
    $ida = User::factory()->create();
    $filter = ['version' => 1, 'conditions' => [
        ['field' => 'priority', 'op' => 'contains', 'value' => 'urgent'],
        ['field' => 'nonsense', 'op' => 'is', 'value' => 'x'],
        ['field' => 'due_date', 'op' => 'is', 'value' => 'tomorrow'],
    ]];
    $display = [...$input()['display'], 'layout' => 'gallery', 'fields' => ['key', 'nonsense']];

    expect(invalidOf(fn () => SaveView::run(actor($ida), $input(['name' => '', 'filter' => $filter, 'display' => $display]))))->toBe([
        'name' => [__('field.name.required')],
        'filter.conditions.0.op' => [__('field.filter.operator')],
        'filter.conditions.1.field' => [__('field.filter.field')],
        'filter.conditions.2.value' => [__('field.filter.value')],
        'display.layout' => [__('field.display.invalid')],
        'display.fields.1' => [__('field.display.invalid')],
    ]);
});

it('names a filter or display of the wrong shape at its own field', function () use ($input) {
    $ida = User::factory()->create();
    $many = ['version' => 1, 'conditions' => array_fill(0, 51, ['field' => 'archived', 'op' => 'is', 'value' => false])];
    $fields = [...$input()['display'], 'fields' => array_fill(0, 31, 'key')];

    expect(invalidOf(fn () => SaveView::run(actor($ida), $input(['filter' => null, 'display' => 'board']))))->toBe([
        'filter' => [__('field.filter.shape')],
        'display' => [__('field.display.shape')],
    ])->and(invalidOf(fn () => SaveView::run(actor($ida), $input(['filter' => $many, 'display' => $fields]))))->toBe([
        'filter.conditions' => [__('field.filter.too_many', ['max' => 50])],
        'display.fields' => [__('field.display.too_many', ['max' => 30])],
    ]);
});

it('keeps the creator when an org admin changes the view', function () use ($input) {
    $ida = User::factory()->create();
    $view = SaveView::run(actor($ida), $input());
    $admin = User::factory()->admin()->create();

    $saved = SaveView::run(actor($admin), $input(['name' => 'Bugs live', 'created_by' => $admin->id]), $view);

    expect($saved->created_by)->toBe($ida->id)
        ->and($saved->name)->toBe('Bugs live')
        ->and(eventsOf(EventType::ViewUpdated, $view)->sole()->actor_id)->toBe($admin->id);
});

it('answers 404 for a view deleted meanwhile', function () use ($input) {
    $ida = User::factory()->create();
    $view = SaveView::run(actor($ida), $input());
    View::query()->whereKey($view->id)->delete();

    expect(problemOf(fn () => SaveView::run(actor($ida), $input(['name' => 'Neu']), $view))->status)->toBe(404)
        ->and(View::query()->count())->toBe(0)
        ->and(eventsOf(EventType::ViewUpdated)->count())->toBe(0);
});

it('lets a deactivated account create nothing', function () use ($input) {
    $gone = User::factory()->create(['disabled_at' => now()]);

    expect(problemOf(fn () => SaveView::run(actor($gone), $input()))->status)->toBe(404)
        ->and(View::query()->count())->toBe(0);
});
