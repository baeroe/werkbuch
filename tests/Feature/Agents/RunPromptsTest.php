<?php

use App\Domain\Agents\Contract;
use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Models\AgentRun;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Organization;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\AgentRules;
use App\Support\RunPrompts;
use Illuminate\Support\Facades\Storage;
use Tests\Support\AgentWorld;
use Tests\Support\Mcp\McpClient;

/*
 * The job of a run names the calls of `werkbuch-run` that read its item, the comments and the pictures, their
 * arguments word for word (A770): an agent that called `work-items` with `key` instead of `item` got a 422 and worked
 * from the title alone. The text of the item stays out of the prompt; the contract says to read it before any work.
 */

beforeEach(function () {
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    $this->kira = AgentWorld::agent([$this->project]);
});

/** The prompt of a run of Kira of this kind at the item. */
$prompt = fn (?WorkItem $item, RunType $type = RunType::Task, array $more = []) => RunPrompts::for(AgentRun::factory()->type($type)->create([
    'bot_id' => test()->kira->id, 'project_id' => test()->project->id, 'work_item_id' => $item?->id, ...$more,
]))['prompt'];

it('names the calls that read the item, its comments and its pictures to every kind of run at an item', function (RunType $type, array $more) use ($prompt) {
    $item = WorkItem::factory()->for($this->project)->create(['description' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Secret plan']]]]]]);
    $key = $item->key;

    expect($prompt($item, $type, $more))
        ->toContain("Before any work, read the item through `werkbuch-run` with exactly these arguments:\n\n"
            ."- tool `work-items`: `{\"action\": \"get\", \"item\": \"{$key}\", \"include\": [\"attachments\", \"relations\"]}` (the item with its description, values, files and relations)\n"
            ."- tool `comments`: `{\"action\": \"list\", \"item\": \"{$key}\", \"per_page\": 100}` (its comments, oldest first), and while `meta.next_cursor` is set: `{\"action\": \"list\", \"item\": \"{$key}\", \"per_page\": 100, \"cursor\": \"<meta.next_cursor>\"}`\n"
            .'- tool `attachments`: `{"action": "content", "attachment": "<id>"}` for every `attachment:<id>` in the item (description, values) or the comments and every file in its `attachments`')
        ->not->toContain('the epic it belongs to')
        ->toContain('ToolSearch with `select:mcp__werkbuch-run__work-items,mcp__werkbuch-run__comments,mcp__werkbuch-run__attachments`')
        // the text of the item stays out: the agent reads it
        ->not->toContain('Secret plan');
})->with([
    'task' => [RunType::Task, []],
    'correction' => [RunType::Correction, ['context' => ['findings' => 'No test.']]],
    'conflict' => [RunType::Conflict, []],
    'review' => [RunType::Review, ['pr_number' => 3, 'head_sha' => str_repeat('a', 40)]],
    'comment' => [RunType::Comment, ['context' => ['author' => 'Mara', 'question' => 'Why?']]],
]);

it('names the epic of a child to read as well', function () use ($prompt) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create();
    $child = WorkItem::factory()->for($this->project)->childOf($epic)->create();

    expect($prompt($child))->toContain("- tool `work-items`: `{\"action\": \"get\", \"item\": \"{$epic->key}\"}` (the epic it belongs to)\n- tool `comments`");
});

it('names no calls for a run without an item', function () use ($prompt) {
    expect($prompt(null, RunType::Review, ['pr_number' => 3, 'head_sha' => str_repeat('a', 40)]))->not->toContain('Before any work');
});

it('tells every kind to read the item first and to stop when reading fails twice', function (RunType $type) {
    expect(Contract::for($type))
        ->toContain('read the item and its comments through `werkbuch-run` and look at its pictures before any other work')
        ->toContain('If reading fails a second time, change nothing: answer only with what failed, the call and the answer you got. Never guess the item from its title and the code.');
})->with(RunType::cases());

it('names calls the tools of werkbuch-run answer with the token of the run', function () {
    Storage::fake('local');
    $epic = WorkItem::factory()->for($this->project)->epic()->create();
    $item = WorkItem::factory()->for($this->project)->childOf($epic)->create();
    Comment::factory()->count(2)->for($item, 'workItem')->create();
    $picture = Attachment::factory()->forItem($item)->stored('notes', 'text/plain', 'notes.txt')->create();
    $run = AgentRun::factory()->type(RunType::Task)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id]);
    preg_match_all('/`(\{"action"[^`]+\})`/', RunPrompts::for($run)['prompt'], $calls);
    $tools = ['work-items', 'work-items', 'comments', 'comments', 'attachments'];
    $mcp = McpClient::for($this, AgentWorld::token($run));

    expect($calls[1])->toHaveCount(5);
    $cursor = null;
    foreach ($calls[1] as $n => $arguments) {
        // a page of one comment, so the call with the cursor of the next page runs too
        $arguments = str_replace(['<id>', '"per_page": 100', '<meta.next_cursor>'], [$picture->id, '"per_page": 1', (string) $cursor], $arguments);
        $answer = $mcp->call($tools[$n], json_decode($arguments, true, flags: JSON_THROW_ON_ERROR));
        expect($answer['isError'])->toBeFalse("{$tools[$n]}: ".json_encode($answer));
        $cursor ??= $answer['structuredContent']['meta']['next_cursor'] ?? null;
    }
    expect($cursor)->toBeString();
});

it('leaves reading the item to the job in every standard of the rules', function (RunType $type, Locale $locale) use ($prompt) {
    $rules = AgentRules::standard($type, $locale);

    // one way to read the item: the calls of the job, never calls of their own (A770; `get` has no `lean`)
    expect($rules)->toMatch('/[„“]Before any work[“”]/u')
        ->and($rules)->not->toContain('lean')->not->toContain('werkbuch-run')->not->toContain('action `get`');
    expect($prompt(WorkItem::factory()->for($this->project)->create(), $type, ['pr_number' => 3, 'head_sha' => str_repeat('a', 40)]))->toContain('Before any work, read the item');
})->with(RunType::cases())->with(Locale::cases());

it('words contract, rules and job in the language of the organization with the calls unchanged', function (RunType $type) use ($prompt) {
    $item = WorkItem::factory()->for($this->project)->create();
    $en = $prompt($item, $type, ['pr_number' => 3, 'head_sha' => str_repeat('a', 40)]);
    $full = fn () => RunPrompts::for(AgentRun::factory()->type($type)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id, 'pr_number' => 3, 'head_sha' => str_repeat('a', 40)]));
    Organization::current()->update(['locale' => 'de']);
    $de = $full();
    $de['prompt'] = $de['prompt'];

    expect($de['system_prompt'])->toContain(Contract::for($type, 'de'))->and($de['prompt'])->toContain('Lies vor jeder Arbeit')->toContain(RunPrompts::data('de'))
        ->and($de['prompt'])->not->toContain('Before any work');
    preg_match_all('/`(\{"action"[^`]+\})`/', $en, $a);
    preg_match_all('/`(\{"action"[^`]+\})`/', $de['prompt'], $b);
    expect($b[1])->toBe($a[1]);
})->with(RunType::cases());
