<?php

use App\Domain\Agents\Contract;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\WorkItem;
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
            ."- tool `work-items`: `{\"action\": \"get\", \"item\": \"{$key}\"}` (the item with its description)\n"
            ."- tool `comments`: `{\"action\": \"list\", \"item\": \"{$key}\", \"per_page\": 100}` (its comments, oldest first; follow `meta.next_cursor`)\n"
            .'- tool `attachments`: `{"action": "content", "attachment": "<id>"}` for every `attachment:<id>` in the description or the comments')
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
    $item = WorkItem::factory()->for($this->project)->create();
    $picture = Attachment::factory()->forItem($item)->stored('notes', 'text/plain', 'notes.txt')->create();
    $run = AgentRun::factory()->type(RunType::Task)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id]);
    preg_match_all('/tool `([a-z-]+)`: `(\{[^`]+\})`/', RunPrompts::for($run)['prompt'], $calls, PREG_SET_ORDER);
    $mcp = McpClient::for($this, AgentWorld::token($run));

    expect(array_column($calls, 1))->toBe(['work-items', 'comments', 'attachments']);
    foreach ($calls as [, $tool, $arguments]) {
        $answer = $mcp->call($tool, json_decode(str_replace('<id>', $picture->id, $arguments), true, flags: JSON_THROW_ON_ERROR));
        expect($answer['isError'])->toBeFalse("{$tool}: ".json_encode($answer));
    }
});
