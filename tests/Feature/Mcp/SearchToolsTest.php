<?php

use App\Access\ProjectRole;
use App\Mcp\Support\Output;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use Tests\Support\Mcp\McpClient;

/*
 * The tool `search` (phase 13, task 4; K6, K13): GET /api/v1/search over MCP, the lists of the query as lists. That it
 * answers what REST answers for every row of the matrix, McpParityTest says (tools.php); this file pins what only MCP
 * meets: lists as JSON arrays, and an empty list of kinds, which the query of REST cannot send.
 */

/**
 * Mara, member of WEB „Kontakt Website“ with three items „Kontaktformular …“: A hers with UX, B with SEO, C without a
 * label, all indexed.
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Kontakt']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create(['name' => 'Kontakt Website']);
    $ux = Label::factory()->create(['name' => 'UX']);
    $seo = Label::factory()->create(['name' => 'SEO']);
    $a = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular prüfen', 'assignee_id' => $mara->id]);
    $b = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular sichern']);
    $c = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular löschen']);
    $a->labels()->attach($ux->id);
    $b->labels()->attach($seo->id);
    app(SearchIndexer::class)->rebuild();

    return compact('mara', 'web', 'ux', 'seo', 'a', 'b', 'c');
};

it('searches over mcp like REST', function () use ($world) {
    searchEngine();
    ['mara' => $mara, 'web' => $web, 'ux' => $ux, 'seo' => $seo, 'a' => $a, 'b' => $b] = $world();
    $plain = apiToken($mara, ['read', 'mcp']);

    $result = McpClient::for($this, $plain)->call('search', [
        'q' => 'kontakt', 'types' => ['items', 'projects', 'people'], 'limit' => 5, 'include_archived' => 1,
        'state_category' => ['backlog', 'started'], 'label_id' => [$ux->id, $seo->id],
    ]);
    forgetApiAuth();
    $rest = $this->getJson("/api/v1/search?q=kontakt&types=items,projects,people&limit=5&include_archived=1&state_category=backlog,started&label_id={$ux->id},{$seo->id}", ['Authorization' => 'Bearer '.$plain])
        ->assertOk()->json();

    expect($result['isError'])->toBeFalse()
        ->and($result['structuredContent'])->toBe(Output::markdown($rest))
        ->and(array_column($result['structuredContent']['data']['items'], 'id'))->toBe([$a->id, $b->id])
        ->and(array_column($result['structuredContent']['data']['projects'], 'id'))->toBe([$web->id])
        ->and(array_column($result['structuredContent']['data']['people'], 'id'))->toBe([$mara->id]);
});

it('refuses types: [] with 422', function () use ($world) {
    $engine = searchEngine();
    ['mara' => $mara] = $world();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));
    $empty = ['types' => [__('field.types.empty', ['allowed' => 'items, pages, projects, people, views'])]];

    // an empty list, a list of an empty name (null after ConvertEmptyStringsToNull) and a comma name no kind
    foreach ([[], [''], ','] as $types) {
        $result = $mcp->call('search', ['q' => 'kontakt', 'types' => $types]);

        expect($result['isError'])->toBeTrue((string) json_encode($types))
            ->and($result['structuredContent']['status'])->toBe(422)
            ->and($result['structuredContent']['errors'])->toBe($empty);
    }
    expect($engine->searched())->toBe([]);

    // without types, or with null, every kind
    foreach ([['q' => 'kontakt'], ['q' => 'kontakt', 'types' => null]] as $arguments) {
        expect($mcp->call('search', $arguments)['isError'])->toBeFalse();
    }
    expect($engine->searched())->toHaveCount(8);
});

it('takes a list of labels as a list', function () use ($world) {
    searchEngine();
    ['mara' => $mara, 'ux' => $ux, 'seo' => $seo, 'a' => $a, 'b' => $b, 'c' => $c] = $world();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));
    $items = fn (array $arguments): array => array_column($mcp->call('search', ['q' => 'kontakt', 'types' => ['items'], ...$arguments])['structuredContent']['data']['items'], 'id');

    expect($items(['label_id' => [$ux->id, $seo->id]]))->toBe([$a->id, $b->id])
        ->and($items(['label_id' => [$seo->id]]))->toBe([$b->id])
        ->and($items(['assignee_id' => ['none']]))->toBe([$b->id, $c->id])
        ->and($items(['assignee_id' => [$mara->id]]))->toBe([$a->id]);

    // none next to an account is refused as over REST
    $refused = $mcp->call('search', ['q' => 'kontakt', 'assignee_id' => ['none', $mara->id]]);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['errors'])->toBe(['assignee_id' => [__('field.assignee_id.invalid')]]);
});
