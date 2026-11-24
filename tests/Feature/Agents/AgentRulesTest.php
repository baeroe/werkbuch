<?php

use App\Domain\Agents\Contract;
use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Events\EventType;
use App\Models\AgentRule;
use App\Models\Organization;
use App\Models\User;
use App\Support\AgentRules;

/*
 * The working rules of the organization per kind of run (spec 7.3, layer 2; 10.5): the standard of werkbuch in the
 * language of the organization while nobody changed it, the own text of org admins, the contract read only beside.
 */

it('reads the standards in the language of the organization with the contract of each kind', function () {
    Organization::current()->update(['locale' => Locale::De]);

    $rules = $this->actingAs(User::factory()->create())->getJson('/api/v1/agent-rules')->assertOk()->json('data');

    expect(array_column($rules, 'type'))->toBe(RunType::VALUES)
        ->and($rules[0])->toMatchArray(['type' => 'task', 'standard' => true, 'contract' => Contract::for(RunType::Task)])
        ->and($rules[0]['body'])->toStartWith('## Ein Item umsetzen')
        ->and($rules[3]['body'])->toBe(AgentRules::standard(RunType::Review, Locale::De))
        ->and($rules[3]['standard_body'])->toBe(AgentRules::standard(RunType::Review, Locale::De));
});

it('names the standard beside an own text, so the settings restore it before they save (A620)', function () {
    $this->actingAs(User::factory()->admin()->create())->putJson('/api/v1/agent-rules/task', ['body' => 'Mine.'])->assertOk()
        ->assertJsonPath('data.body', 'Mine.')->assertJsonPath('data.standard_body', AgentRules::standard(RunType::Task, Locale::En));

    expect($this->getJson('/api/v1/agent-rules')->json('data.0'))->toMatchArray(['body' => 'Mine.', 'standard' => false, 'standard_body' => AgentRules::standard(RunType::Task, Locale::En)]);
});

it('reaches only unchanged texts with a new standard of the rules', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->putJson('/api/v1/agent-rules/review', ['body' => "Review gently.\r\n"])->assertOk()
        ->assertJsonPath('data.body', 'Review gently.')->assertJsonPath('data.standard', false);

    // a text equal to a standard (in either language) is no change: the standard of a release reaches it
    $this->putJson('/api/v1/agent-rules/comment', ['body' => AgentRules::standard(RunType::Comment, Locale::De)])->assertOk()->assertJsonPath('data.standard', true);

    expect(AgentRule::query()->pluck('type')->map->value->all())->toBe(['review'])
        ->and(AgentRules::text(RunType::Comment))->toBe(AgentRules::standard(RunType::Comment, Locale::En))
        ->and(AgentRules::text(RunType::Review))->toBe('Review gently.')
        ->and(eventsOf(EventType::AgentRulesUpdated))->toHaveCount(1)
        ->and(eventsOf(EventType::AgentRulesUpdated)->sole()->changes['review'])->toBe(['old' => AgentRules::standard(RunType::Review, Locale::En), 'new' => 'Review gently.']);

    // `null` restores the standard, once
    $this->putJson('/api/v1/agent-rules/review', ['body' => null])->assertOk()->assertJsonPath('data.standard', true);
    $this->putJson('/api/v1/agent-rules/review', ['body' => ''])->assertOk();
    expect(AgentRule::query()->count())->toBe(0)->and(eventsOf(EventType::AgentRulesUpdated))->toHaveCount(2);
});

it('lets only org admins change the rules and knows only the kinds of run', function () {
    $this->actingAs(User::factory()->create())->putJson('/api/v1/agent-rules/task', ['body' => 'x'])->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.agent_rules_admins_only'));
    $this->actingAs(User::factory()->admin()->create())->putJson('/api/v1/agent-rules/nope', ['body' => 'x'])->assertNotFound();
    $this->putJson('/api/v1/agent-rules/task', [])->assertUnprocessable()->assertJsonPath('errors.body.0', __('field.required'));
    $this->putJson('/api/v1/agent-rules/task', ['body' => str_repeat('x', 20_001)])->assertUnprocessable();
});
