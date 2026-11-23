<?php

use App\Access\RunTokenGuard;
use App\Domain\Agents\RunType;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Support\Actor;
use Illuminate\Support\Facades\Storage;
use Tests\Support\AgentWorld;
use Tests\Support\Mcp\McpClient;

/*
 * The hard lock of run tokens (spec 11.2, A477): what the flow keeps to werkbuch is a 403 `agent_forbidden` through the
 * token of a run, even where the bot, as a member, may do it with a token of its own; the proof, comments, uploads,
 * added relations and the wiki stay open. The rights matrix holds every action (column `run_token`); this holds the
 * keys and the REST answers.
 */

beforeEach(function () {
    Storage::fake('local');
    $this->project = Project::factory()->create();
    $this->agent = AgentWorld::agent([$this->project]);
    $this->item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $this->run = AgentWorld::run($this->agent, $this->item);
    $this->token = AgentWorld::token($this->run);
});

$refused = fn (string $method, string $uri, array $body = []) => test()->withToken(test()->token)->json($method, $uri, $body)
    ->assertForbidden()->assertJsonPath('reason', 'agent_forbidden');

it('refuses state changes, assignment, archive and delete through a run token with agent_forbidden', function () use ($refused) {
    $id = $this->item->id;
    $doing = $this->project->workflow->states()->where('name', 'In Progress')->value('id');
    $done = WorkItem::factory()->closed()->create(['project_id' => $this->project->id]);
    $other = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $relation = WorkItemRelation::factory()->create(['source_id' => $this->item->id, 'target_id' => $other->id]);
    $person = User::factory()->create();

    $refused('POST', "/api/v1/work-items/{$id}/transition", ['to_state_id' => $doing]);
    $refused('PATCH', "/api/v1/work-items/{$id}", ['state_id' => $doing]);
    $refused('PATCH', "/api/v1/work-items/{$id}", ['assignee_id' => $person->id]);
    $refused('PATCH', "/api/v1/work-items/{$id}", ['title' => 'Mine now', 'values' => []]);
    $refused('PUT', "/api/v1/work-items/{$id}/type", ['type_id' => WorkItemType::query()->where('name', 'Bug')->value('id')]);
    $refused('POST', '/api/v1/work-items/bulk', ['ids' => [$id], 'patch' => ['priority' => 'high']]);
    $refused('POST', "/api/v1/work-items/{$done->id}/archive");
    $refused('POST', "/api/v1/work-items/{$done->id}/restore");
    $refused('DELETE', "/api/v1/work-items/{$id}");
    $refused('PUT', "/api/v1/work-items/{$id}/subscription");
    $refused('DELETE', "/api/v1/relations/{$relation->id}");
    $refused('POST', '/api/v1/work-items', ['project_id' => $this->project->id, 'title' => 'More work']);
    $refused('PATCH', "/api/v1/projects/{$this->project->id}", ['name' => 'Agent land']);
    $refused('GET', '/api/v1/tokens?filter[user_id]='.$this->agent->id);
    $refused('GET', '/api/v1/webhooks');
    $refused('DELETE', '/api/v1/pages/'.Page::factory()->create(['project_id' => $this->project->id])->id);
    $refused('DELETE', '/api/v1/attachments/'.Attachment::factory()->forItem($this->item, 'file')->stored('x', 'text/plain', 'x.txt')->create()->id);

    expect($this->item->fresh()->state_id)->toBe($this->project->workflow->initial_state_id)
        ->and($this->item->fresh()->title)->not->toBe('Mine now')
        ->and(WorkItem::query()->find($id))->not->toBeNull();
});

it('lets a run token write its proof, comment, upload, relate and write the wiki', function () {
    $other = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $id = $this->item->id;
    $as = fn () => $this->withToken($this->token);

    $as()->patchJson("/api/v1/work-items/{$id}", ['description' => 'Done, see the PR.'])->assertOk()->assertJsonPath('data.description', 'Done, see the PR.');
    $as()->postJson("/api/v1/work-items/{$id}/comments", ['body' => 'Working on it.'])->assertCreated();
    $as()->postJson("/api/v1/work-items/{$id}/relations", ['type_id' => RelationType::query()->where('built_in', 'relates')->value('id'), 'target_id' => $other->id])->assertCreated();
    $as()->postJson('/api/v1/projects/'.$this->project->id.'/pages', ['title' => 'Notes of the agent'])->assertCreated();
    $as()->getJson("/api/v1/work-items/{$id}")->assertOk();
});

it('answers a token of the bot that is no run token with the rights of the bot', function () {
    $own = apiToken($this->agent, ['read', 'write']);
    $doing = $this->project->workflow->states()->where('name', 'In Progress')->value('id');

    $this->withToken($own)->postJson("/api/v1/work-items/{$this->item->id}/transition", ['to_state_id' => $doing])->assertOk();
    expect(RunTokenGuard::isRunToken(new Actor($this->agent, Actor::VIA_API, token: PersonalAccessToken::findToken($own))))->toBeFalse()
        ->and(RunTokenGuard::isRunToken(actor($this->agent)))->toBeFalse();
});

it('gives a run token the abilities of its kind', function () {
    $review = AgentWorld::run($this->agent, $this->item, RunType::Review);
    $token = AgentWorld::token($review);

    $this->withToken($token)->getJson("/api/v1/work-items/{$this->item->id}")->assertOk();
    forgetApiAuth();
    $this->withToken($token)->postJson("/api/v1/work-items/{$this->item->id}/comments", ['body' => 'Looks good.'])->assertForbidden()->assertJsonPath('reason', 'forbidden');
});

it('leaves run tokens out of the token list', function () {
    $admin = User::factory()->admin()->create();
    $own = $this->agent->createToken('Deploy', ['read']);
    $this->actingAs($admin);

    $this->getJson('/api/v1/tokens?filter[user_id]='.$this->agent->id)->assertOk()
        ->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $own->accessToken->id);

    $runToken = PersonalAccessToken::query()->where('agent_run_id', $this->run->id)->sole();
    $this->deleteJson("/api/v1/tokens/{$runToken->id}")->assertNotFound();
    expect($runToken->fresh())->not->toBeNull()
        ->and($runToken->abilities)->toBe(['read', 'write', 'mcp'])
        ->and($runToken->expires_at->diffInMinutes(now()->addMinutes(70), true))->toBeLessThan(1);
});

it('refuses a state change through MCP with the token of a run, as over REST', function () {
    $doing = $this->project->workflow->states()->where('name', 'In Progress')->value('id');
    $mcp = McpClient::for($this, $this->token);

    $answer = $mcp->call('manage-work-items', ['action' => 'transition', 'item' => $this->item->key, 'input' => ['to_state_id' => $doing]]);
    expect($answer['isError'])->toBeTrue()
        ->and($answer['structuredContent']['status'])->toBe(403)
        ->and($answer['structuredContent']['reason'])->toBe('agent_forbidden')
        ->and($this->item->fresh()?->state_id)->not->toBe($doing);

    // reading goes
    expect($mcp->call('work-items', ['action' => 'get', 'item' => $this->item->key])['isError'] ?? false)->toBeFalse();
});

it('refuses the answer of an item sent back as a whole: an agent sends only what it changes (A477)', function () use ($refused) {
    $answer = $this->withToken($this->token)->getJson("/api/v1/work-items/{$this->item->id}")->assertOk()->json('data');
    forgetApiAuth();

    $refused('PATCH', "/api/v1/work-items/{$this->item->id}", $answer);
    forgetApiAuth();
    $this->withToken($this->token)->patchJson("/api/v1/work-items/{$this->item->id}", ['description' => 'Plan'])->assertOk();
});
