<?php

use App\Models\Event;
use App\Models\Invitation;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
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

it('maps the models of the catalogs to their short names', function (string $alias, string $model) {
    expect(Relation::getMorphedModel($alias))->toBe($model)
        ->and((new $model)->getMorphClass())->toBe($alias);
})->with([
    'workflow' => ['workflow', Workflow::class],
    'work item type' => ['work_item_type', WorkItemType::class],
    'property' => ['property', Property::class],
    'label' => ['label', Label::class],
    'relation type' => ['relation_type', RelationType::class],
    'resolution' => ['resolution', Resolution::class],
]);
