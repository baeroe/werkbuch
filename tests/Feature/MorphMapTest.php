<?php

use App\Models\Event;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\ClassMorphViolationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;

it('maps the account to its short name', function () {
    expect(Relation::getMorphedModel('user'))->toBe(User::class)
        ->and((new User)->getMorphClass())->toBe('user');
});

it('refuses a model without an entry', function () {
    (new class extends Model {})->getMorphClass();
})->throws(ClassMorphViolationException::class);

it('maps the project to its short name', fn () => expect((new Project)->getMorphClass())->toBe('project'));

it('maps the event to its short name', fn () => expect((new Event)->getMorphClass())->toBe('event'));

it('maps the invitation to its short name', fn () => expect((new Invitation)->getMorphClass())->toBe('invitation'));
