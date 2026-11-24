<?php

use App\Actions\Links\PostLinkback;
use App\GitHub\GitHubUnavailable;
use App\Jobs\PostPullRequestComment;
use App\Models\GitHubPullRequestComment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\Support\FakeGitHub;

/*
 * The comment of werkbuch at a PR (spec 12, WEBU-25): one per PR, naming its items with a link, written again only when
 * the text changes, never at a PR of an agent.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $this->actor = Actor::system(User::defaultBot(), 'test');
});

it('writes one comment at a PR that names its items, and changes it when they change', function () {
    $a = WorkItem::factory()->for($this->project)->create();
    $b = WorkItem::factory()->for($this->project)->create();

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 30, ['body' => "Fixes WEBU-{$a->number}"]))->assertStatus(202);
    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('edited', 30, ['title' => 'Other title', 'body' => "Fixes WEBU-{$a->number}"]))->assertStatus(202);

    $url = rtrim((string) config('app.url'), '/');
    expect($this->github->comments)->toHaveCount(1)
        ->and($this->github->comments[0])->toMatchArray(['number' => 30, 'repository' => 'feldwerk/website'])
        ->and($this->github->comments[0]['body'])->toBe(PostLinkback::MARK."\n".__('github.links.comment.title')."\n\n- [WEBU-{$a->number}]({$url}/items/WEBU-{$a->number}): ".__('github.links.comment.closes'));
    Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/access_tokens') && $request->data()['permissions'] === PostLinkback::PERMISSIONS);

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('edited', 30, ['body' => "Fixes WEBU-{$a->number}, refs WEBU-{$b->number}"]))->assertStatus(202);

    expect($this->github->comments)->toHaveCount(1)
        ->and($this->github->comments[0]['body'])->toEndWith("\n- [WEBU-{$b->number}]({$url}/items/WEBU-{$b->number})")
        ->and(GitHubPullRequestComment::query()->sole()->comment_id)->toBe($this->github->comments[0]['id']);

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('edited', 30, ['body' => "skip WEBU-{$a->number}, WEBU-{$b->number}"]))->assertStatus(202);
    expect($this->github->comments[0]['body'])->toBe(PostLinkback::MARK."\n".__('github.links.comment.none'));
});

it('says nothing when the text stays, writes a deleted comment anew and skips a PR without links or of an agent', function () {
    $a = WorkItem::factory()->for($this->project)->create();
    WorkItemLink::factory()->create(['work_item_id' => $a->id, 'number' => 31]);

    expect(PostLinkback::run($this->actor, 700_000_001, 31))->toBe('posted')
        ->and(PostLinkback::run($this->actor, 700_000_001, 31))->toBe('unchanged');

    $this->github->deletedComments[] = $this->github->comments[0]['id'];
    WorkItemLink::query()->update(['closes' => true]);
    expect(PostLinkback::run($this->actor, 700_000_001, 31))->toBe('posted')
        ->and($this->github->comments)->toHaveCount(2)
        ->and(GitHubPullRequestComment::query()->sole()->comment_id)->toBe($this->github->comments[1]['id']);

    WorkItemLink::query()->update(['closes' => false]);
    expect(PostLinkback::run($this->actor, 700_000_001, 31))->toBe('updated');

    expect(PostLinkback::run($this->actor, 700_000_001, 99))->toBe('skipped')
        ->and(PostLinkback::run($this->actor, 700_000_099, 31))->toBe('skipped');

    WorkItemLink::factory()->create(['work_item_id' => $a->id, 'number' => 32, 'author' => 'feldwerk-werkbuch[bot]']);
    expect(PostLinkback::run($this->actor, 700_000_001, 32))->toBe('skipped');
});

it('lets the job try again when GitHub refuses the comment', function () {
    $a = WorkItem::factory()->for($this->project)->create();
    WorkItemLink::factory()->create(['work_item_id' => $a->id, 'number' => 33]);
    $this->github->refuse = ['/repos/*/*/issues/*/comments' => 502];

    expect(fn () => (new PostPullRequestComment(700_000_001, 33))->handle())->toThrow(GitHubUnavailable::class)
        ->and(GitHubPullRequestComment::query()->exists())->toBeFalse()
        ->and((new PostPullRequestComment(700_000_001, 33))->middleware())->toHaveCount(1);

    $this->github->refuse = [];
    PostLinkback::run($this->actor, 700_000_001, 33);
    $this->github->refuse = ['/repos/*/*/issues/comments/*' => 500];
    WorkItemLink::query()->update(['closes' => true]);

    expect(fn () => PostLinkback::run($this->actor, 700_000_001, 33))->toThrow(GitHubUnavailable::class);
});

it('refuses an answer of GitHub without the ID of the comment', function () {
    $a = WorkItem::factory()->for($this->project)->create();
    WorkItemLink::factory()->create(['work_item_id' => $a->id, 'number' => 34]);
    $this->github->commentAnswer = ['nope' => 1];

    expect(fn () => PostLinkback::run($this->actor, 700_000_001, 34))->toThrow(GitHubUnavailable::class);
});
