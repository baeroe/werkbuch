<?php

use App\Domain\Agents\RunType;
use App\Domain\GitHub\BranchRules;
use App\Domain\GitHub\RepoPermissions;
use App\Domain\GitHub\WebhookSignature;

/*
 * The pure rules of the GitHub app (WEBU-24): the permissions of a run's token, whether rules protect a branch and the
 * signature of a delivery.
 */

it('gives code runs write, light runs only read, and never workflows', function () {
    foreach ([RunType::Task, RunType::Correction, RunType::Conflict] as $type) {
        expect(RepoPermissions::forRun($type))->toBe(['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'metadata' => 'read']);
    }
    foreach ([RunType::Review, RunType::Comment] as $type) {
        expect(RepoPermissions::forRun($type))->toBe(['contents' => 'read', 'pull_requests' => 'read', 'metadata' => 'read']);
    }
    expect(RepoPermissions::OWN)->not->toHaveKey('workflows');
});

it('counts a branch protected only by a rule that keeps a direct push off it', function () {
    expect(BranchRules::protects([]))->toBeFalse()
        ->and(BranchRules::protects([['type' => 'deletion'], ['type' => 'non_fast_forward'], 'x', ['nope' => 1]]))->toBeFalse()
        ->and(BranchRules::protects([['type' => 'deletion'], ['type' => 'pull_request', 'parameters' => []]]))->toBeTrue()
        ->and(BranchRules::protects([['type' => 'update']]))->toBeTrue();
});

it('signs a delivery as GitHub does and compares only a matching header', function () {
    // the example of GitHub's docs: secret "It's a Secret to Everybody", body "Hello, World!"
    $signature = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

    expect(WebhookSignature::sign("It's a Secret to Everybody", 'Hello, World!'))->toBe($signature)
        ->and(WebhookSignature::matches("It's a Secret to Everybody", 'Hello, World!', $signature))->toBeTrue()
        ->and(WebhookSignature::matches("It's a Secret to Everybody", 'Hello, World?', $signature))->toBeFalse()
        ->and(WebhookSignature::matches("It's a Secret to Everybody", 'Hello, World!', null))->toBeFalse()
        ->and(WebhookSignature::matches('', 'Hello, World!', WebhookSignature::sign('', 'Hello, World!')))->toBeFalse();
});
