<?php

use App\Events\EventType;

it('offers exactly the webhook catalog of the spec plus project.restored', function () {
    $webhooks = collect(EventType::cases())->filter(fn (EventType $type) => $type->webhook())->map->value->sort()->values()->all();

    expect($webhooks)->toBe(collect([
        'project.created', 'project.updated', 'project.archived', 'project.restored', 'project.deleted',
        'project.member_added', 'project.member_removed',
        'work_item.created', 'work_item.updated', 'work_item.state_changed', 'work_item.assigned', 'work_item.archived',
        'work_item.restored', 'work_item.deleted', 'work_item.relation_added', 'work_item.relation_removed',
        'comment.created', 'comment.updated', 'comment.deleted',
        'page.created', 'page.updated', 'page.moved', 'page.deleted',
        'bot.mentioned', 'bot.assigned',
        'template.run_failed',
    ])->sort()->values()->all());
});

it('knows the events of this phase that have no webhook', function () {
    $internal = collect(EventType::cases())->reject(fn (EventType $type) => $type->webhook())->map->value->sort()->values()->all();

    expect($internal)->toBe(collect([
        'project.member_role_changed', 'organization.updated',
        'user.created', 'user.updated', 'user.role_changed', 'user.deactivated', 'user.reactivated', 'user.invited',
        'user.password_changed', 'user.two_factor_setup_started', 'user.two_factor_enabled', 'user.two_factor_disabled',
        'user.recovery_codes_regenerated',
        'bot.created', 'token.created', 'token.revoked', 'favorite.added', 'favorite.removed',
    ])->sort()->values()->all());
});

it('names every type as group.event', function () {
    foreach (EventType::cases() as $type) {
        expect($type->value)->toMatch('/^[a-z_]+\.[a-z_]+$/');
    }
});

it('takes the group from the part before the dot', function () {
    expect(EventType::WorkItemStateChanged->group())->toBe('work_item')
        ->and(EventType::TemplateRunFailed->group())->toBe('template');
});
