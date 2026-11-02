<?php

use App\Access\RoleAssignments;
use App\Actions\Account\ChangePassword;
use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Account\DisableTwoFactor;
use App\Actions\Account\EnableTwoFactor;
use App\Actions\Account\GetTwoFactor;
use App\Actions\Account\RegenerateRecoveryCodes;
use App\Actions\Attachments\DeleteAttachment;
use App\Actions\Attachments\GetAttachment;
use App\Actions\Attachments\ShowAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\GetComment;
use App\Actions\Comments\ListComments;
use App\Actions\Favorites\ListFavorites;
use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Invitations\InviteUser;
use App\Actions\Invitations\ListInvitations;
use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\ListLabels;
use App\Actions\Labels\SaveLabel;
use App\Actions\Media\ShowMedia;
use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\GetProject;
use App\Actions\Projects\JoinProject;
use App\Actions\Projects\ListMembers;
use App\Actions\Projects\ListProjects;
use App\Actions\Projects\PurgeProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateMemberRole;
use App\Actions\Projects\UpdateProject;
use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\ListProperties;
use App\Actions\Properties\SaveProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\RelationTypes\SaveRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Resolutions\SaveResolution;
use App\Actions\Search\QuerySearch;
use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ListUsers;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Actions\Views\DeleteView;
use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\Views\SaveView;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\ListStateUsage;
use App\Actions\Workflows\ListWorkflows;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItems\ListRelations;
use App\Actions\WorkItems\ListSubscribers;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Actions\WorkItems\RemapStates;
use App\Actions\WorkItems\RemoveRelation;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Support\Actor;
use Illuminate\Http\UploadedFile;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use PragmaRX\Google2FA\Google2FA;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\WorkflowFixtures;

/*
 * The rights matrix (RightsMatrixTest): every action × every kind of account. A row names the action, how to run it in
 * the MatrixWorld (with valid input, so an allowed call succeeds), the columns that may run it (`allowed`), the columns
 * that must not even see what it acts on (`hidden`: 404 instead of 403) and the event an allowed call records. Rows with
 * `'system' => true` are work of jobs without REST: they run once as the system and must not fail.
 *
 * Not in the matrix, on purpose:
 * - App\Actions\Auth\*: they run before any sign-in (login, password reset, first admin, CheckInvitation and
 *   AcceptInvitation for the link of an invitation, whose signature and row are the only credentials), without an actor
 *   whose rights could be checked (A4, P18).
 * - App\Actions\Setup\*: migrations and console commands set up roles, the default bot and the catalog and bind the
 *   projects to it, nobody acts.
 * - App\Actions\Accounts\NextHandle: a reading helper that finds a free handle for the actions above, without an actor (P24).
 */

$everyone = MatrixWorld::COLUMNS;

// password and second factor are the own account's, and only people sign in
$people = array_values(array_diff($everyone, ['default_bot']));
$peopleButAdmin = array_values(array_diff($people, ['org_admin']));

// the settings of a project: its admins (org admins are admins in every project); the outsider of the private project
// does not see it
$projectAdmins = ['org_admin', 'project_admin', 'default_bot'];

// the catalogs: every account reads them, only org admins change them (`org.manage_catalog`, P8)
$catalogAdmins = ['org_admin', 'default_bot'];

// work items: members and admins of the project (`item.create`, `item.edit`); viewers read, outsiders of the private
// project do not see it
$itemWriters = ['org_admin', 'project_admin', 'project_member', 'default_bot'];

/** Starts a two-factor setup for the account past the action (a bot as well, so its refusal is the action's own); returns the secret. */
$startTwoFactor = function (User $user): string {
    app(EnableTwoFactorAuthentication::class)($user, true);

    return decrypt((string) $user->two_factor_secret);
};

/** Turns two-factor sign-in on for the account past the actions. */
$withTwoFactor = function (User $user) use ($startTwoFactor): void {
    $startTwoFactor($user);
    $user->forceFill(['two_factor_confirmed_at' => now()])->save();
};

return [
    'GetOrganization' => [
        'action' => GetOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetOrganization::run($a),
        'allowed' => $everyone,
    ],
    'UpdateOrganization' => [
        'action' => UpdateOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateOrganization::run($a, ['name' => 'Neu']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::OrganizationUpdated,
    ],
    // a file of the file list (`item.edit`); an upload into a text (`item.comment`, viewers too, A234) is
    // UploadAttachmentTest's: one row per action (K10)
    'UploadAttachment' => [
        'action' => UploadAttachment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UploadAttachment::run($a, [
            'project_id' => $w->project($column)->id, 'kind' => 'file', 'work_item_id' => $w->item($column)->id,
        ], UploadedFile::fake()->createWithContent('matrix.txt', 'Matrix')),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemUpdated,
    ],
    // a file of the file list (`item.edit`); an unowned upload (its uploader) and a picture of a text (409 for all) are
    // DeleteAttachmentTest's
    'DeleteAttachment' => [
        'action' => DeleteAttachment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteAttachment::run($a, Attachment::factory()->forItem($w->item($column), 'file')
            ->stored('Matrix', 'text/plain', 'matrix.txt')->create()),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemUpdated,
    ],
    'GetAttachment' => [
        'action' => GetAttachment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetAttachment::run($a, Attachment::factory()->forItem($w->item($column))->create()),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'ShowAttachment' => [
        'action' => ShowAttachment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ShowAttachment::run($a, Attachment::factory()->forItem($w->item($column))
            ->stored((string) base64_decode(explode(',', imageDataUrl())[1]), 'image/png', 'matrix.png')->create()),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'ShowMedia' => [
        'action' => ShowMedia::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ShowMedia::run($a, $w->logo),
        'allowed' => $everyone,
    ],
    'ListProjects' => [
        'action' => ListProjects::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListProjects::run($a, []),
        'allowed' => $everyone,
    ],
    'GetProject' => [
        'action' => GetProject::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetProject::run($a, $w->project($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'CreateProject' => [
        'action' => CreateProject::class,
        // the lead named: by default it is the actor, and the default bot is no person
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateProject::run($a, ['name' => 'Neu', 'identifier' => 'NEU', 'lead_id' => $w->target->id]),
        'allowed' => $everyone,
        'event' => EventType::ProjectCreated,
    ],
    'UpdateProject' => [
        'action' => UpdateProject::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateProject::run($a, $w->project($column), ['name' => 'Neu']),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectUpdated,
    ],
    'AssignWorkflow' => [
        'action' => AssignWorkflow::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => AssignWorkflow::run($a, $w->project($column), ['workflow_id' => Workflow::factory()->create()->id, 'mapping' => []]),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectUpdated,
    ],
    'ArchiveProject' => [
        'action' => ArchiveProject::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ArchiveProject::run($a, $w->project($column)),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectArchived,
    ],
    'DeleteProject' => [
        'action' => DeleteProject::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteProject::run($a, $w->project($column)),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectDeleted,
    ],
    'PurgeProject' => [
        'action' => PurgeProject::class,
        // the work of the job App\Jobs\PurgeProject after DeleteProject: the one writing action without an event of its
        // own, it only cleans up after `project.deleted` (P26)
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->web->update(['deleting_at' => now()]);

            return PurgeProject::run($a, $w->web);
        },
        'system' => true,
    ],
    'ListMembers' => [
        'action' => ListMembers::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListMembers::run($a, $w->project($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'JoinProject' => [
        'action' => JoinProject::class,
        // everybody who sees the project joins it, so a member steps out first (the lead of WEB too, below the action)
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            app(RoleAssignments::class)->removeFromProject($a->user, $w->project($column));

            return JoinProject::run($a, $w->project($column));
        },
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectMemberAdded,
    ],
    'AddMember' => [
        'action' => AddMember::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => AddMember::run($a, $w->project($column), ['user_id' => User::factory()->create()->id, 'role' => 'member']),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectMemberAdded,
    ],
    'UpdateMemberRole' => [
        'action' => UpdateMemberRole::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateMemberRole::run($a, $w->project($column), $w->target, 'viewer'),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectMemberRoleChanged,
    ],
    'RemoveMember' => [
        'action' => RemoveMember::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RemoveMember::run($a, $w->project($column), $w->target),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectMemberRemoved,
    ],
    'ListWorkItems' => [
        'action' => ListWorkItems::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListWorkItems::run($a, ['filter' => ['project' => $w->project($column)->id]]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'QueryWorkItems' => [
        'action' => QueryWorkItems::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => QueryWorkItems::run($a, ['shorthand' => ['project' => $w->project($column)->id]]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // a filter on a project the account does not see counts nothing: never 404 (K8)
    'GroupWorkItems' => [
        'action' => GroupWorkItems::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GroupWorkItems::run($a, [
            'filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $w->project($column)->id]]],
            'group_by' => 'state',
        ]),
        'allowed' => $everyone,
    ],
    'CountWorkItems' => [
        'action' => CountWorkItems::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CountWorkItems::run($a, [
            'filters' => ['open' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $w->project($column)->id]]]],
        ]),
        'allowed' => $everyone,
    ],
    'GetWorkItem' => [
        'action' => GetWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetWorkItem::run($a, $w->item($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'CreateWorkItem' => [
        'action' => CreateWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateWorkItem::run($a, ['project_id' => $w->project($column)->id, 'title' => 'Matrix']),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemCreated,
    ],
    'UpdateWorkItem' => [
        'action' => UpdateWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateWorkItem::run($a, $w->item($column), ['title' => 'Matrix']),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemUpdated,
    ],
    'TransitionWorkItem' => [
        'action' => TransitionWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => TransitionWorkItem::run($a, $w->item($column), [
            'to_state_id' => $w->project($column)->workflow->states()->where('name', 'In Progress')->value('id'),
        ]),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemStateChanged,
    ],
    'ChangeWorkItemType' => [
        'action' => ChangeWorkItemType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ChangeWorkItemType::run($a, $w->item($column), [
            'type_id' => WorkItemType::query()->where('name', 'Bug')->value('id'),
        ]),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemUpdated,
    ],
    'ArchiveWorkItem' => [
        'action' => ArchiveWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ArchiveWorkItem::run($a, $w->item($column, 'closed')),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemArchived,
    ],
    'RestoreWorkItem' => [
        'action' => RestoreWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RestoreWorkItem::run($a, $w->item($column, 'archived')),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemRestored,
    ],
    'BulkUpdateWorkItems' => [
        'action' => BulkUpdateWorkItems::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => BulkUpdateWorkItems::run($a, ['ids' => [$w->item($column)->id], 'patch' => ['priority' => 'high']]),
        // every account may send one: a refused item is a line of the answer, never a 403 or 404 (P10)
        'allowed' => $everyone,
    ],
    'DeleteWorkItem' => [
        'action' => DeleteWorkItem::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteWorkItem::run($a, $w->item($column)),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemDeleted,
    ],
    'ListSubscribers' => [
        'action' => ListSubscribers::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListSubscribers::run($a, $w->item($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'SetSubscription' => [
        'action' => SetSubscription::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SetSubscription::run($a, $w->item($column), true),
        // every person who reads the item; bots watch nothing
        'allowed' => ['org_admin', 'project_admin', 'project_member', 'project_viewer', 'outsider_public'],
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemSubscribed,
    ],
    // comments: whoever reads the item (`item.comment`, viewers too)
    'ListComments' => [
        'action' => ListComments::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListComments::run($a, $w->item($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'AddComment' => [
        'action' => AddComment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => AddComment::run($a, $w->item($column), ['body' => 'Matrix']),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::CommentCreated,
    ],
    'GetComment' => [
        'action' => GetComment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetComment::run($a, Comment::factory()->for($w->item($column), 'workItem')->create(['author_id' => $w->target->id])),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // the column's own comment: only its author edits it (an admin is refused another's, EditCommentTest)
    'EditComment' => [
        'action' => EditComment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => EditComment::run($a, Comment::factory()->for($w->item($column), 'workItem')->create(['author_id' => $a->user->id]), ['body' => 'Matrix']),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::CommentUpdated,
    ],
    // another's comment: the admins of the project, org admins included (A241); the own one is DeleteCommentTest's
    'DeleteComment' => [
        'action' => DeleteComment::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteComment::run($a, Comment::factory()->for($w->item($column), 'workItem')->create(['author_id' => $w->target->id])),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::CommentDeleted,
    ],
    'ListRelations' => [
        'action' => ListRelations::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListRelations::run($a, $w->item($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'RemapStates' => [
        'action' => RemapStates::class,
        // the work of AssignWorkflow and SaveWorkflow, which checked their rights and hold the organization: an item of
        // the world moves on to the next state of its workflow
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $item = $w->item($column);
            $next = $w->project($column)->workflow->states()->where('id', '!=', $item->state_id)->value('id');

            return RemapStates::run($a, [$item->project_id], [$item->state_id => $next], RemapStates::WORKFLOW_CHANGED);
        },
        'event' => EventType::WorkItemStateChanged,
        'system' => true,
    ],
    'ListHistory' => [
        'action' => ListHistory::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListHistory::run($a, $w->item($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'AddRelation' => [
        'action' => AddRelation::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => AddRelation::run($a, $w->item($column), [
            'type_id' => RelationType::query()->where('built_in', 'relates')->value('id'),
            'target_id' => $w->item($column)->id,
        ]),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemRelationAdded,
        // one at each end
        'events' => 2,
    ],
    'RemoveRelation' => [
        'action' => RemoveRelation::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RemoveRelation::run($a, WorkItemRelation::factory()->create([
            'source_id' => $w->item($column)->id,
            'target_id' => $w->item($column)->id,
        ])),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemRelationRemoved,
        // one at each end
        'events' => 2,
    ],
    'ListWorkflows' => [
        'action' => ListWorkflows::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListWorkflows::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveWorkflow' => [
        'action' => SaveWorkflow::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveWorkflow::run($a, null, WorkflowFixtures::standardInput('Matrix')),
        'allowed' => $catalogAdmins,
        'event' => EventType::WorkflowCreated,
    ],
    'DeleteWorkflow' => [
        'action' => DeleteWorkflow::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteWorkflow::run($a, Workflow::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::WorkflowDeleted,
    ],
    'ListStateUsage' => [
        'action' => ListStateUsage::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListStateUsage::run($a, ['project' => $w->project($column)->identifier]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'ListWorkItemTypes' => [
        'action' => ListWorkItemTypes::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListWorkItemTypes::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveWorkItemType' => [
        'action' => SaveWorkItemType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveWorkItemType::run($a, null, [
            'name' => 'Matrix', 'icon' => 'flag', 'tone' => 'moss', 'is_epic' => false, 'properties' => [],
        ]),
        'allowed' => $catalogAdmins,
        'event' => EventType::WorkItemTypeCreated,
    ],
    'DeleteWorkItemType' => [
        'action' => DeleteWorkItemType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteWorkItemType::run($a, WorkItemType::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::WorkItemTypeDeleted,
    ],
    'ListProperties' => [
        'action' => ListProperties::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListProperties::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveProperty' => [
        'action' => SaveProperty::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveProperty::run($a, null, ['key' => 'matrix', 'label' => 'Matrix', 'field_type' => 'text']),
        'allowed' => $catalogAdmins,
        'event' => EventType::PropertyCreated,
    ],
    'DeleteProperty' => [
        'action' => DeleteProperty::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteProperty::run($a, Property::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::PropertyDeleted,
    ],
    'ListLabels' => [
        'action' => ListLabels::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListLabels::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveLabel' => [
        'action' => SaveLabel::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveLabel::run($a, null, ['name' => 'Matrix', 'color' => 'moss']),
        'allowed' => $catalogAdmins,
        'event' => EventType::LabelCreated,
    ],
    'DeleteLabel' => [
        'action' => DeleteLabel::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteLabel::run($a, Label::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::LabelDeleted,
    ],
    'ListRelationTypes' => [
        'action' => ListRelationTypes::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListRelationTypes::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveRelationType' => [
        'action' => SaveRelationType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveRelationType::run($a, null, ['name' => 'Matrix', 'outward_label' => 'tests']),
        'allowed' => $catalogAdmins,
        'event' => EventType::RelationTypeCreated,
    ],
    'DeleteRelationType' => [
        'action' => DeleteRelationType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteRelationType::run($a, RelationType::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::RelationTypeDeleted,
    ],
    'ListResolutions' => [
        'action' => ListResolutions::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListResolutions::run($a, []),
        'allowed' => $everyone,
    ],
    'SaveResolution' => [
        'action' => SaveResolution::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveResolution::run($a, null, ['label' => 'Matrix']),
        'allowed' => $catalogAdmins,
        'event' => EventType::ResolutionCreated,
    ],
    'DeleteResolution' => [
        'action' => DeleteResolution::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteResolution::run($a, Resolution::factory()->create()),
        'allowed' => $catalogAdmins,
        'event' => EventType::ResolutionDeleted,
    ],
    'QuerySearch' => [
        'action' => QuerySearch::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => QuerySearch::run($a, ['q' => 'Matrix']),
        'allowed' => $everyone,
    ],
    'ListViews' => [
        'action' => ListViews::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListViews::run($a, []),
        'allowed' => $everyone,
    ],
    'GetView' => [
        'action' => GetView::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetView::run($a, $w->view()),
        'allowed' => $everyone,
    ],
    // views belong to the team: everybody creates them, only the creator and org admins (`view.manage_any`) change one
    'SaveView' => [
        'action' => SaveView::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $view = $w->view();

            return SaveView::run($a, [...$view->only(['icon', 'filter', 'display']), 'name' => 'Matrix'], $view);
        },
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::ViewUpdated,
    ],
    'DeleteView' => [
        'action' => DeleteView::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteView::run($a, $w->view()),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::ViewDeleted,
    ],
    'ListFavorites' => [
        'action' => ListFavorites::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListFavorites::run($a),
        'allowed' => $everyone,
    ],
    'ToggleFavorite' => [
        'action' => ToggleFavorite::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ToggleFavorite::run($a, ['kind' => 'project', 'id' => $w->project($column)->id]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::FavoriteAdded,
    ],
    'ListUsers' => [
        'action' => ListUsers::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListUsers::run($a, []),
        'allowed' => $everyone,
    ],
    'UpdateUser' => [
        'action' => UpdateUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateUser::run($a, $w->target, ['name' => 'Neu']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserUpdated,
    ],
    'UpdateUserRole' => [
        'action' => UpdateUserRole::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateUserRole::run($a, $w->target, 'admin'),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserRoleChanged,
    ],
    'DeactivateUser' => [
        'action' => DeactivateUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeactivateUser::run($a, $w->target),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserDeactivated,
    ],
    'ReactivateUser' => [
        'action' => ReactivateUser::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->target->update(['disabled_at' => now()]);

            return ReactivateUser::run($a, $w->target);
        },
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserReactivated,
    ],
    'CreateBot' => [
        'action' => CreateBot::class,
        // the responsible person named: by default it is the actor, and the default bot is no person
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateBot::run($a, ['name' => 'Neu', 'handle' => 'matrix-neu', 'owner_id' => $w->target->id]),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::BotCreated,
    ],
    'InviteUser' => [
        'action' => InviteUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => InviteUser::run($a, ['email' => "matrix-{$column}@example.com", 'org_role' => 'member']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserInvited,
    ],
    'ListInvitations' => [
        'action' => ListInvitations::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListInvitations::run($a, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'ListTokens' => [
        'action' => ListTokens::class,
        // the tokens of a bot: org admins only (spec 4.2), even the person who runs it may not
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListTokens::run($a, $w->bot, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'CreateToken' => [
        'action' => CreateToken::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateToken::run($a, $w->bot, ['name' => 'Matrix', 'abilities' => ['read']]),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::TokenCreated,
    ],
    'RevokeToken' => [
        'action' => RevokeToken::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RevokeToken::run($a, $w->bot->createToken('Matrix', ['read'])->accessToken),
        'allowed' => ['org_admin', 'default_bot'],
        // a token the account may not manage is one it does not get to see
        'hidden' => $peopleButAdmin,
        'event' => EventType::TokenRevoked,
    ],
    'ChangePassword' => [
        'action' => ChangePassword::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ChangePassword::run($a, [
            'current_password' => MatrixWorld::PASSWORD, 'password' => 'new-matrix-password', 'password_confirmation' => 'new-matrix-password',
        ]),
        'allowed' => $people,
        'event' => EventType::UserPasswordChanged,
    ],
    'GetTwoFactor' => [
        'action' => GetTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetTwoFactor::run($a),
        'allowed' => $people,
    ],
    'EnableTwoFactor' => [
        'action' => EnableTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => EnableTwoFactor::run($a),
        'allowed' => $people,
        'event' => EventType::UserTwoFactorSetupStarted,
    ],
    'ConfirmTwoFactor' => [
        'action' => ConfirmTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ConfirmTwoFactor::run($a, app(Google2FA::class)->getCurrentOtp($startTwoFactor($a->user))),
        'allowed' => $people,
        'event' => EventType::UserTwoFactorEnabled,
    ],
    'DisableTwoFactor' => [
        'action' => DisableTwoFactor::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) use ($withTwoFactor) {
            $withTwoFactor($a->user);

            return DisableTwoFactor::run($a);
        },
        'allowed' => $people,
        'event' => EventType::UserTwoFactorDisabled,
    ],
    'RegenerateRecoveryCodes' => [
        'action' => RegenerateRecoveryCodes::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) use ($withTwoFactor) {
            $withTwoFactor($a->user);

            return RegenerateRecoveryCodes::run($a);
        },
        'allowed' => $people,
        'event' => EventType::UserRecoveryCodesRegenerated,
    ],
];
