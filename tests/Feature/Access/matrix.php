<?php

use App\Access\RoleAssignments;
use App\Actions\Account\ChangePassword;
use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Account\DisableTwoFactor;
use App\Actions\Account\EnableTwoFactor;
use App\Actions\Account\GetTwoFactor;
use App\Actions\Account\RegenerateRecoveryCodes;
use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\ClaimRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\AgentRuns\FinishRun;
use App\Actions\AgentRuns\GetRun;
use App\Actions\AgentRuns\ListRunEvents;
use App\Actions\AgentRuns\ListRuns;
use App\Actions\AgentRuns\PruneRunEvents;
use App\Actions\AgentRuns\ReapLostRuns;
use App\Actions\AgentRuns\RecordHeartbeat;
use App\Actions\AgentRuns\RecordRunEvents;
use App\Actions\AgentRuns\RenewGitToken;
use App\Actions\AgentRuns\RetryRun;
use App\Actions\Agents\ApproveAndMerge;
use App\Actions\Agents\CheckThreadMergeability;
use App\Actions\Agents\CompleteThread;
use App\Actions\Agents\FollowEvent;
use App\Actions\Agents\GetAgentConfig;
use App\Actions\Agents\GetProjectAgents;
use App\Actions\Agents\GiveUpOnThread;
use App\Actions\Agents\HandleAgentPullRequest;
use App\Actions\Agents\HandleCheckResult;
use App\Actions\Agents\HandleRunResult;
use App\Actions\Agents\HandleRunStarted;
use App\Actions\Agents\ListAgentRules;
use App\Actions\Agents\MarkThreadReady;
use App\Actions\Agents\MergeThread;
use App\Actions\Agents\PauseThread;
use App\Actions\Agents\PostReviewVerdict;
use App\Actions\Agents\ReadyEpic;
use App\Actions\Agents\ResumeAfterGuard;
use App\Actions\Agents\ResumeThread;
use App\Actions\Agents\SaveAgentConfig;
use App\Actions\Agents\SaveAgentRule;
use App\Actions\Agents\SaveProjectAgents;
use App\Actions\Agents\StartComment;
use App\Actions\Agents\StartConflict;
use App\Actions\Agents\StartCorrection;
use App\Actions\Agents\StartReview;
use App\Actions\Agents\StartTask;
use App\Actions\Agents\SweepAgentThreads;
use App\Actions\Attachments\DeleteAttachment;
use App\Actions\Attachments\GetAttachment;
use App\Actions\Attachments\IssueUploadUrl;
use App\Actions\Attachments\PruneAttachments;
use App\Actions\Attachments\PruneUnownedAttachments;
use App\Actions\Attachments\ShowAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Actions\Automations\FollowWorkflow;
use App\Actions\Automations\ListAutomations;
use App\Actions\Automations\RunDailyAutomations;
use App\Actions\Automations\RunMoveAutomations;
use App\Actions\Automations\SaveAutomation;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\DeleteComment;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\GetComment;
use App\Actions\Comments\ListComments;
use App\Actions\Comments\RemoveReaction;
use App\Actions\Favorites\ListFavorites;
use App\Actions\Favorites\ToggleFavorite;
use App\Actions\GitHub\CompleteManifest;
use App\Actions\GitHub\ConfirmMergeGuard;
use App\Actions\GitHub\DetectUnauthorizedPush;
use App\Actions\GitHub\DisconnectGitHub;
use App\Actions\GitHub\GetGitHub;
use App\Actions\GitHub\GetProjectRepository;
use App\Actions\GitHub\HandleGitHubDelivery;
use App\Actions\GitHub\LinkRepository;
use App\Actions\GitHub\PruneGitHubDeliveries;
use App\Actions\GitHub\ReceiveGitHubDelivery;
use App\Actions\GitHub\ReturnFromInstallation;
use App\Actions\GitHub\StartManifest;
use App\Actions\GitHub\SyncGitHub;
use App\Actions\Invitations\InviteUser;
use App\Actions\Invitations\ListInvitations;
use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\GetLabel;
use App\Actions\Labels\ListLabels;
use App\Actions\Labels\SaveLabel;
use App\Actions\Links\LoadChecks;
use App\Actions\Links\PostLinkback;
use App\Actions\Links\SyncChecks;
use App\Actions\Links\SyncPullRequest;
use App\Actions\Media\ShowMedia;
use App\Actions\Notifications\DeleteNotification;
use App\Actions\Notifications\DispatchDueMails;
use App\Actions\Notifications\GetNotificationPreferences;
use App\Actions\Notifications\ListNotifications;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Actions\Notifications\NotifyRecipients;
use App\Actions\Notifications\PruneNotifications;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Notifications\SendDueReminders;
use App\Actions\Notifications\SendNotificationMail;
use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\ExportPagePdf;
use App\Actions\Pages\GetPage;
use App\Actions\Pages\GetPageVersion;
use App\Actions\Pages\LinkPagePdf;
use App\Actions\Pages\ListItemPages;
use App\Actions\Pages\ListPages;
use App\Actions\Pages\ListPageVersions;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\RestorePageVersion;
use App\Actions\Pages\UpdatePage;
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
use App\Actions\Properties\GetProperty;
use App\Actions\Properties\ListProperties;
use App\Actions\Properties\SaveProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\GetRelationType;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\RelationTypes\SaveRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\GetResolution;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Resolutions\SaveResolution;
use App\Actions\RichText\ListMentionables;
use App\Actions\RichText\ResolveReferences;
use App\Actions\Runners\CreatePairingCode;
use App\Actions\Runners\GetPairingCode;
use App\Actions\Runners\GetRunner;
use App\Actions\Runners\ListRunners;
use App\Actions\Runners\RevokeRunner;
use App\Actions\Runners\UpdateRunner;
use App\Actions\Search\QuerySearch;
use App\Actions\System\GetSystemStatus;
use App\Actions\System\RetryFailedJobs;
use App\Actions\System\SendTestMail;
use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\DraftFromTemplate;
use App\Actions\Templates\FailScheduledTemplate;
use App\Actions\Templates\GetTemplate;
use App\Actions\Templates\ListTemplateRuns;
use App\Actions\Templates\ListTemplates;
use App\Actions\Templates\PreviewSchedule;
use App\Actions\Templates\RescheduleTemplates;
use App\Actions\Templates\RunDueTemplates;
use App\Actions\Templates\RunScheduledTemplate;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\GetMe;
use App\Actions\Users\GetUser;
use App\Actions\Users\ListUsers;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Actions\Views\DeleteView;
use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\Views\SaveView;
use App\Actions\Webhooks\DeleteWebhook;
use App\Actions\Webhooks\DisableWebhook;
use App\Actions\Webhooks\GetWebhook;
use App\Actions\Webhooks\ListWebhookDeliveries;
use App\Actions\Webhooks\ListWebhooks;
use App\Actions\Webhooks\PingWebhook;
use App\Actions\Webhooks\PrepareWebhookAttempt;
use App\Actions\Webhooks\PruneWebhookDeliveries;
use App\Actions\Webhooks\QueueDeliveries;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Actions\Webhooks\RedeliverWebhook;
use App\Actions\Webhooks\RotateWebhookSecret;
use App\Actions\Webhooks\SaveWebhook;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\GetWorkflow;
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
use App\Actions\WorkItems\LinkReferences;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItems\ListRelations;
use App\Actions\WorkItems\ListSubscribers;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Actions\WorkItems\RedistributeRanks;
use App\Actions\WorkItems\RemapStates;
use App\Actions\WorkItems\RemoveRelation;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\GetWorkItemType;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Events\EventType;
use App\Models\AgentThread;
use App\Models\Attachment;
use App\Models\Automation;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Event;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\Label;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\PageVersion;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Pdf\Gotenberg;
use App\Support\Actor;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use PragmaRX\Google2FA\Google2FA;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\FakeGitHub;
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
$people = array_values(array_diff($everyone, ['default_bot', 'run_token']));
$peopleButAdmin = array_values(array_diff($people, ['org_admin']));

// the settings of a project: its admins (org admins are admins in every project); the outsider of the private project
// does not see it
$projectAdmins = ['org_admin', 'project_admin', 'default_bot'];

// the catalogs: every account reads them, only org admins change them (`org.manage_catalog`, P8)
$catalogAdmins = ['org_admin', 'default_bot'];

// work items: members and admins of the project (`item.create`, `item.edit`); viewers read, outsiders of the private
// project do not see it
$itemWriters = ['org_admin', 'project_admin', 'project_member', 'default_bot'];

// the token of a run (spec 11.2, A477): the agent bot is a member of WEB and reads what members read; it writes only its
// proof (description and values), comments, reactions, uploads, relations it adds and wiki pages: everything else is a
// 403 agent_forbidden before any policy
$agentWriters = [...$itemWriters, 'run_token'];
$notThroughRuns = fn (array $columns): array => array_values(array_diff($columns, ['run_token']));

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
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::WorkItemUpdated,
    ],
    // an upload address of MCP for a file of the file list, as the upload: who may change the item (`file`); it needs a
    // personal access token with `mcp` and `write` (McpUploadTest) and records nothing
    'IssueUploadUrl' => [
        'action' => IssueUploadUrl::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => IssueUploadUrl::run(
            new Actor($a->user, Actor::VIA_MCP, token: $a->user->createToken('matrix', ['write', 'mcp'])->accessToken),
            ['project_id' => $w->project($column)->id, 'kind' => 'file', 'work_item_id' => $w->item($column)->id],
        ),
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
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
    // the work of the hourly job PruneUnownedAttachmentsJob: uploads nobody owns, older than a day, without an event (A239)
    'PruneUnownedAttachments' => [
        'action' => PruneUnownedAttachments::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            Attachment::factory()->create(['project_id' => $w->web->id, 'uploaded_by' => $w->account('project_member')->id, 'created_at' => now()->subDays(2)]);

            return PruneUnownedAttachments::run($a, now()->subDay());
        },
        'system' => true,
    ],
    // the work of app:prune-attachments: pictures their text no longer names, without an event (A239)
    'PruneAttachments' => [
        'action' => PruneAttachments::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            Attachment::factory()->forItem($w->item('project_member'))->create(['uploaded_by' => $w->account('project_member')->id, 'created_at' => now()->subDays(2)]);

            return PruneAttachments::run($a, 1, false);
        },
        'system' => true,
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
        'allowed' => $notThroughRuns($everyone),
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
        'allowed' => $notThroughRuns(array_values(array_diff($everyone, ['outsider_private']))),
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
        'allowed' => $notThroughRuns($everyone),
    ],
    'RedistributeRanks' => [
        'action' => RedistributeRanks::class,
        // an item with a rank the redistribution shortens: else nothing changes and nothing is recorded
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $item = $w->item($column);
            $item->update(['rank' => $item->rank.'V']);

            return RedistributeRanks::run($a, $w->project($column));
        },
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectRanksRedistributed,
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
    // reactions: whoever may comment (`item.comment`, viewers too); the column's own emoji
    'AddReaction' => [
        'action' => AddReaction::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => AddReaction::run($a, Comment::factory()->for($w->item($column), 'workItem')->create(['author_id' => $w->target->id]), ['emoji' => '👍']),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::CommentReactionAdded,
    ],
    'RemoveReaction' => [
        'action' => RemoveReaction::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $comment = Comment::factory()->for($w->item($column), 'workItem')->create(['author_id' => $w->target->id]);
            CommentReaction::query()->create(['comment_id' => $comment->id, 'user_id' => $a->user->id, 'emoji' => '👍']);

            return RemoveReaction::run($a, $comment, ['emoji' => '👍']);
        },
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
        'event' => EventType::CommentReactionRemoved,
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
        'allowed' => $agentWriters,
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
    'GetWorkflow' => [
        'action' => GetWorkflow::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetWorkflow::run($a, Workflow::default()),
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
    'GetWorkItemType' => [
        'action' => GetWorkItemType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetWorkItemType::run($a, WorkItemType::factory()->create()),
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
    'GetProperty' => [
        'action' => GetProperty::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetProperty::run($a, Property::factory()->create()),
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
    'GetLabel' => [
        'action' => GetLabel::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetLabel::run($a, Label::factory()->create()),
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
    'GetRelationType' => [
        'action' => GetRelationType::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetRelationType::run($a, RelationType::factory()->create()),
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
    'GetResolution' => [
        'action' => GetResolution::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetResolution::run($a, Resolution::factory()->create()),
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
    'ListMentionables' => [
        'action' => ListMentionables::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListMentionables::run($a, ['project' => $w->project($column)->identifier]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // an item the account does not see is left out, never a 404 (A230)
    'ResolveReferences' => [
        'action' => ResolveReferences::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ResolveReferences::run($a, ['items' => [$w->item($column)->id]]),
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
    // every account reads every account, as the list (A392)
    'GetUser' => [
        'action' => GetUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetUser::run($a, $w->target),
        'allowed' => $everyone,
    ],
    'GetMe' => [
        'action' => GetMe::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetMe::run($a),
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
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListTokens::run($a, ['filter' => ['user_id' => $w->bot->id]]),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'CreateToken' => [
        'action' => CreateToken::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateToken::run($a, ['user_id' => $w->bot->id, 'name' => 'Matrix', 'abilities' => ['read']]),
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
    // the wiki: whoever sees the project reads its tree and its pages (viewers and outsiders of a public one too)
    'ListPages' => [
        'action' => ListPages::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListPages::run($a, $w->project($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // the pages that name an item: whoever sees the item (only the pages of projects they see, A456)
    'ListItemPages' => [
        'action' => ListItemPages::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListItemPages::run($a, $w->item($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'GetPage' => [
        'action' => GetPage::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetPage::run($a, $w->page($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // the PDF of a page (WEBU-4): whoever sees it, also a viewer; Gotenberg answers a fake PDF
    'LinkPagePdf' => [
        'action' => LinkPagePdf::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => LinkPagePdf::run($a, $w->page($column), ['subpages' => true]),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'ExportPagePdf' => [
        'action' => ExportPagePdf::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            Http::fake(['*'.Gotenberg::ROUTE => Http::response('%PDF-1.7 matrix')]);

            return ExportPagePdf::run($a, $w->page($column), []);
        },
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // writing the wiki takes `wiki.edit`: members and admins of the project (the default bot is an org admin)
    'CreatePage' => [
        'action' => CreatePage::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreatePage::run($a, $w->project($column), ['title' => 'Matrix']),
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::PageCreated,
    ],
    'UpdatePage' => [
        'action' => UpdatePage::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdatePage::run($a, $w->page($column), ['title' => 'Matrix']),
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::PageUpdated,
    ],
    'MovePage' => [
        'action' => MovePage::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $page = $w->page($column);

            return MovePage::run($a, $page, ['parent_id' => $w->page($column)->id, 'before_id' => null]);
        },
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::PageMoved,
    ],
    'DeletePage' => [
        'action' => DeletePage::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeletePage::run($a, $w->page($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::PageDeleted,
    ],
    // the versions of a page: whoever sees the project reads them, restoring one takes `wiki.edit`
    'ListPageVersions' => [
        'action' => ListPageVersions::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListPageVersions::run($a, $w->page($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'GetPageVersion' => [
        'action' => GetPageVersion::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $page = $w->page($column);

            return GetPageVersion::run($a, $page, PageVersion::factory()->create(['page_id' => $page->id]));
        },
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'RestorePageVersion' => [
        'action' => RestorePageVersion::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $page = $w->page($column);

            return RestorePageVersion::run($a, $page, PageVersion::factory()->create(['page_id' => $page->id]));
        },
        'allowed' => $agentWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::PageUpdated,
    ],
    // templates: whoever sees the project reads them, managing them takes `template.manage` (members and admins of the
    // project; the default bot is an org admin)
    'ListTemplates' => [
        'action' => ListTemplates::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListTemplates::run($a, $w->project($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'GetTemplate' => [
        'action' => GetTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetTemplate::run($a, $w->template($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'SaveTemplate' => [
        'action' => SaveTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveTemplate::run($a, null, ['name' => 'Matrix', 'payload' => ['title' => 'Matrix'], 'schedule' => null], $w->template($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::TemplateUpdated,
    ],
    'DeleteTemplate' => [
        'action' => DeleteTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteTemplate::run($a, $w->template($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::TemplateDeleted,
    ],
    // the draft serves creating an item: who sees the template and may create items in its project
    'DraftFromTemplate' => [
        'action' => DraftFromTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DraftFromTemplate::run($a, $w->template($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
    ],
    // running a template by hand manages it; the item is the default bot's (Actor::template), so the account records
    // no event of its own
    'RunTemplate' => [
        'action' => RunTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RunTemplate::run($a, $w->template($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
    ],
    'ListTemplateRuns' => [
        'action' => ListTemplateRuns::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListTemplateRuns::run($a, $w->template($column), []),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    // the scheduler (RunTemplateJob, app:run-templates) and a new zone or a restored project: the bookkeeping of the
    // schedules writes no event of its own (K23, A355), a run's item is the default bot's work_item.created
    'RunScheduledTemplate' => [
        'action' => RunScheduledTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RunScheduledTemplate::run($a, $w->template($column)->id),
        'system' => true,
    ],
    // the term of a run that kept crashing (RunTemplateJob::failed()): booked as failed, with template.run_failed when
    // a term is due (none is in the world)
    'FailScheduledTemplate' => [
        'action' => FailScheduledTemplate::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => FailScheduledTemplate::run($a, $w->template($column)->id),
        'system' => true,
    ],
    'RunDueTemplates' => [
        'action' => RunDueTemplates::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RunDueTemplates::run($a, true),
        'system' => true,
    ],
    'RescheduleTemplates' => [
        'action' => RescheduleTemplates::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RescheduleTemplates::run($a, 'Europe/Berlin'),
        'system' => true,
    ],
    // the preview of a schedule reads nothing of a project: every active account
    'PreviewSchedule' => [
        'action' => PreviewSchedule::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PreviewSchedule::run($a, ['schedule' => ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']]]),
        'allowed' => $everyone,
    ],
    // the automations of a project: whoever sees it reads them, only its admins switch them (spec 4.3)
    'ListAutomations' => [
        'action' => ListAutomations::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListAutomations::run($a, $w->project($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'SaveAutomation' => [
        'action' => SaveAutomation::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveAutomation::run($a, $w->project($column), 'auto_archive', ['enabled' => true, 'settings' => ['days' => 30]]),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::AutomationUpdated,
    ],
    // the work of AssignWorkflow and SaveWorkflow, which checked their rights and hold the locks: Auto-Close of the
    // project follows into a workflow without a Canceled state and switches off
    'FollowWorkflow' => [
        'action' => FollowWorkflow::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $project = $w->project($column);
            $state = $project->workflow()->firstOrFail()->states()->where('category', StateCategory::Canceled)->value('id');
            Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['state_id' => $state])->create();

            FollowWorkflow::run($a, $project, [], Workflow::factory()->create(), RemapStates::WORKFLOW_CHANGED);
        },
        'event' => EventType::AutomationUpdated,
        'system' => true,
    ],
    'RunMoveAutomations' => [
        'action' => RunMoveAutomations::class,
        // the work of a move (TransitionWorkItem::move()) in its transaction: the last child of an epic closed, and with
        // Eltern schließen switched on the epic follows it into Done
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $project = $w->project($column);
            Automation::factory()->for($project)->key(AutomationKey::CloseParent)->enabled()->create();
            $epic = WorkItem::factory()->for($project)->epic()->create();
            $child = WorkItem::factory()->childOf($epic)->closed()->create();
            $from = $project->workflow()->firstOrFail()->states()->where('category', StateCategory::Backlog)->firstOrFail();

            RunMoveAutomations::run($a, $child->load('project'), $from, $child->state()->firstOrFail());
        },
        'event' => EventType::WorkItemStateChanged,
        'system' => true,
    ],
    'LinkReferences' => [
        'action' => LinkReferences::class,
        // the work of LinkReferencesJob after the commit of a change whose text named another item anew: the two items
        // related with `relates`, an event at each end
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $item = $w->item($column);

            return LinkReferences::run($a, $item->id, [$w->item($column)->id], $a->user->id);
        },
        'event' => EventType::WorkItemRelationAdded,
        'events' => 2,
        'system' => true,
    ],
    'RunDailyAutomations' => [
        'action' => RunDailyAutomations::class,
        // the work of the hourly RunDailyAutomationsJob, forced to act: Auto-Archiv archives an item closed 40 days ago
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $project = $w->project($column);
            Automation::factory()->for($project)->key(AutomationKey::AutoArchive)->enabled()->create();
            WorkItem::factory()->for($project)->closed()->create(['closed_at' => now()->subDays(40)]);

            return RunDailyAutomations::run($a, now()->utc()->startOfHour()->toImmutable(), true, $project->id);
        },
        'event' => EventType::WorkItemArchived,
        'system' => true,
    ],
    // the inbox is the own one: everybody lists, marks and deletes their own notifications (a bot has none); a
    // notification of a project the account does not see is passed over when marking and a 404 when deleting (K19)
    'ListNotifications' => [
        'action' => ListNotifications::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListNotifications::run($a, []),
        'allowed' => $everyone,
    ],
    'MarkNotificationsRead' => [
        'action' => MarkNotificationsRead::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => MarkNotificationsRead::run($a, ['ids' => [
            Notification::factory()->forItem($w->item($column))->create(['user_id' => $a->user->id])->id,
        ]]),
        'allowed' => $everyone,
    ],
    'MarkNotificationsUnread' => [
        'action' => MarkNotificationsUnread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => MarkNotificationsUnread::run($a, ['ids' => [
            Notification::factory()->forItem($w->item($column))->read()->create(['user_id' => $a->user->id])->id,
        ]]),
        'allowed' => $everyone,
    ],
    'DeleteNotification' => [
        'action' => DeleteNotification::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteNotification::run($a, Notification::factory()->forItem($w->item($column))->create(['user_id' => $a->user->id])),
        'allowed' => $notThroughRuns(array_values(array_diff($everyone, ['outsider_private']))),
        'hidden' => ['outsider_private'],
    ],
    // a bot gets no notifications: it reads an empty matrix and may not change one (K6)
    'GetNotificationPreferences' => [
        'action' => GetNotificationPreferences::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetNotificationPreferences::run($a),
        'allowed' => $everyone,
    ],
    'SaveNotificationPreferences' => [
        'action' => SaveNotificationPreferences::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveNotificationPreferences::run($a, [
            'preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]],
        ]),
        'allowed' => $people,
    ],
    // the system page (A287): org admins who are people; the default bot is an org admin, but no person (K6)
    'GetSystemStatus' => [
        'action' => GetSystemStatus::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetSystemStatus::run($a),
        'allowed' => ['org_admin'],
    ],
    'RetryFailedJobs' => [
        'action' => RetryFailedJobs::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
                'payload' => '{"attempts":1}', 'exception' => 'RuntimeException: matrix', 'failed_at' => now()->utc()]);

            return RetryFailedJobs::run($a, []);
        },
        'allowed' => ['org_admin'],
        'event' => EventType::SystemFailedJobsRetried,
    ],
    // sends at once, nothing is written; a mail server is set and keeps what it gets (Mail::fake)
    'SendTestMail' => [
        'action' => SendTestMail::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            Mail::fake();
            config(['mail.default' => 'smtp']);

            return SendTestMail::run($a);
        },
        'allowed' => ['org_admin'],
    ],
    // the webhooks (spec 4.3, A372): accounts with `org.manage`, the org admins and the default bot over a token
    'ListWebhooks' => [
        'action' => ListWebhooks::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListWebhooks::run($a, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'GetWebhook' => [
        'action' => GetWebhook::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetWebhook::run($a, $w->webhook()),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'SaveWebhook' => [
        'action' => SaveWebhook::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $webhook = $w->webhook();

            return SaveWebhook::run($a, [...$webhook->only(['url', 'project_id', 'events', 'bot_id', 'active']), 'name' => 'Matrix'], $webhook);
        },
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::WebhookUpdated,
    ],
    'DeleteWebhook' => [
        'action' => DeleteWebhook::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeleteWebhook::run($a, $w->webhook()),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::WebhookDeleted,
    ],
    'RotateWebhookSecret' => [
        'action' => RotateWebhookSecret::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RotateWebhookSecret::run($a, $w->webhook()),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::WebhookSecretRotated,
    ],
    // the log, the test ping and "send again": one request to the receiver of the matrix's fake, no event (A367)
    'ListWebhookDeliveries' => [
        'action' => ListWebhookDeliveries::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListWebhookDeliveries::run($a, $w->webhook(), []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'PingWebhook' => [
        'action' => PingWebhook::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PingWebhook::run($a, $w->webhook()),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'RedeliverWebhook' => [
        'action' => RedeliverWebhook::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $webhook = $w->webhook();

            return RedeliverWebhook::run($a, $webhook, WebhookDelivery::factory()->for($webhook)->create());
        },
        'allowed' => ['org_admin', 'default_bot'],
    ],
    // the work of the consumer `notifications` for an event of the outbox (here one of the migrations, which tells
    // nobody), without an event of its own
    'NotifyRecipients' => [
        'action' => NotifyRecipients::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => NotifyRecipients::run($a, Event::query()->where('type', EventType::BotCreated)->firstOrFail()),
        'system' => true,
    ],
    // the work of the consumer `webhooks` for an event of the outbox (here one of the migrations, which no webhook can
    // take), without an event of its own
    'QueueDeliveries' => [
        'action' => QueueDeliveries::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => QueueDeliveries::run($a, Event::query()->where('type', EventType::BotCreated)->firstOrFail()),
        'system' => true,
    ],
    // the check before a try of DeliverWebhook (a pending delivery of a fresh webhook: the checked target), without an
    // event of its own
    'PrepareWebhookAttempt' => [
        'action' => PrepareWebhookAttempt::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PrepareWebhookAttempt::run($a, WebhookDelivery::factory()->for($w->webhook())->create()->id, WebhookAttempt::SCHEDULED)
            ?? throw new RuntimeException('Nothing to send.'),
        'system' => true,
    ],
    // the log of a try of DeliverWebhook (here a success), bookkeeping without an event
    'RecordWebhookAttempt' => [
        'action' => RecordWebhookAttempt::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RecordWebhookAttempt::run($a, WebhookDelivery::factory()->for($w->webhook())->create()->id, 200, 40, 'ok', null, WebhookAttempt::SCHEDULED)
            ?? throw new RuntimeException('Nothing logged.'),
        'system' => true,
    ],
    // the system switches a webhook off that failed for 24 hours (A366), from RecordWebhookAttempt under its lock
    'DisableWebhook' => [
        'action' => DisableWebhook::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DB::transaction(fn () => DisableWebhook::run($a, Webhook::query()->lockForUpdate()->findOrFail($w->webhook()->id))),
        'system' => true,
        'event' => EventType::WebhookDisabled,
    ],
    // the work of SendNotificationMailJob for a collection that is due (here one without lines: it is skipped), without
    // an event of its own
    'SendNotificationMail' => [
        'action' => SendNotificationMail::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SendNotificationMail::run($a, NotificationMail::factory()->create(['user_id' => $w->target->id])->id),
        'system' => true,
    ],
    // the sweeper of the mail collections (`app:send-notification-mails`), without an event of its own
    'DispatchDueMails' => [
        'action' => DispatchDueMails::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DispatchDueMails::run($a),
        'system' => true,
    ],
    // the hourly reminders of what is due (SendDueRemindersJob, A275), without an event of their own
    'SendDueReminders' => [
        'action' => SendDueReminders::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SendDueReminders::run($a, now()->utc()->startOfHour()->toImmutable()),
        'system' => true,
    ],
    // the hourly tidying up of notifications and collections (PruneNotificationsJob, A276), without an event
    'PruneNotifications' => [
        'action' => PruneNotifications::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PruneNotifications::run($a),
        'system' => true,
    ],
    // the hourly tidying up of the webhook log (PruneWebhookDeliveriesJob, K15), without an event
    'PruneWebhookDeliveries' => [
        'action' => PruneWebhookDeliveries::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PruneWebhookDeliveries::run($a),
        'system' => true,
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

    // runners (spec 10.1) and the agent configuration of bots (spec 10.4): accounts with `org.manage`, like webhooks
    'ListRunners' => [
        'action' => ListRunners::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListRunners::run($a, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'GetRunner' => [
        'action' => GetRunner::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetRunner::run($a, $w->runner()),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'UpdateRunner' => [
        'action' => UpdateRunner::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateRunner::run($a, $w->runner(), ['name' => 'Matrix Mac']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::RunnerUpdated,
    ],
    'RevokeRunner' => [
        'action' => RevokeRunner::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RevokeRunner::run($a, $w->runner()),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::RunnerRevoked,
    ],
    'CreatePairingCode' => [
        'action' => CreatePairingCode::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreatePairingCode::run($a),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'GetPairingCode' => [
        'action' => GetPairingCode::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetPairingCode::run($a, CreatePairingCode::run(actor($w->account('org_admin')))['pairing']),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'GetAgentConfig' => [
        'action' => GetAgentConfig::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetAgentConfig::run($a, $w->bot),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'SaveAgentConfig' => [
        'action' => SaveAgentConfig::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveAgentConfig::run($a, $w->bot, [
            'enabled' => true, 'runner_ids' => [], 'cli' => 'claude', 'model' => 'opus', 'models' => ['review' => 'haiku'],
        ]),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::AgentConfigUpdated,
    ],
    // the runs of agents (spec 6.4, 10.6): who sees the project reads them, who may change items (and org admins) steers
    // them; the agent itself, through the token of its run, reads but never steers
    'ListRuns' => [
        'action' => ListRuns::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListRuns::run($a, ['filter' => ['work_item_id' => $w->run($column)->work_item_id]]),
        'allowed' => $everyone,
    ],
    'GetRun' => [
        'action' => GetRun::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetRun::run($a, $w->run($column)),
        'allowed' => $everyone,
        'hidden' => ['outsider_private'],
    ],
    'ListRunEvents' => [
        'action' => ListRunEvents::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListRunEvents::run($a, $w->run($column), []),
        'allowed' => $everyone,
        'hidden' => ['outsider_private'],
    ],
    'CancelRun' => [
        'action' => CancelRun::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CancelRun::run($a, $w->run($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::AgentRunCanceled,
    ],
    'RetryRun' => [
        'action' => RetryRun::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RetryRun::run($a, $w->run($column, ['status' => RunStatus::Failed, 'finished_at' => now()])),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::AgentRunQueued,
    ],
    // „Weitermachen“ after GitHub was disconnected (WEBU-28): who may change the item, never an agent through its run
    'ResumeThread' => [
        'action' => ResumeThread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ResumeThread::run($a, $w->resumable($column)),
        'allowed' => $itemWriters,
        'hidden' => ['outsider_private'],
        'event' => EventType::AgentRunQueued,
    ],
    // the work of the runner protocol and of jobs (WEBU-20): the runner is no account, the actor is the system
    'EnqueueRun' => [
        'action' => EnqueueRun::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => EnqueueRun::run($a, $w->account('run_token'), $w->web, $w->item('project_admin'), 'task', null),
        'system' => true,
        'event' => EventType::AgentRunQueued,
    ],
    'ClaimRun' => [
        'action' => ClaimRun::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->run('project_admin');

            return ClaimRun::run($a, $w->runner(), ['protocol' => '1']);
        },
        'system' => true,
        'event' => EventType::AgentRunStarted,
    ],
    'RecordHeartbeat' => [
        'action' => RecordHeartbeat::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RecordHeartbeat::run($a, $runner = $w->runner(), $w->run('project_admin', ['status' => RunStatus::Running, 'runner_id' => $runner->id])->id, ['attempt' => 1]),
        'system' => true,
    ],
    'RecordRunEvents' => [
        'action' => RecordRunEvents::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RecordRunEvents::run($a, $runner = $w->runner(), $w->run('project_admin', ['status' => RunStatus::Running, 'runner_id' => $runner->id])->id, [
            'attempt' => 1, 'events' => [['kind' => 'text', 'text' => 'Matrix']],
        ]),
        'system' => true,
    ],
    'FinishRun' => [
        'action' => FinishRun::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => FinishRun::run($a, $runner = $w->runner(), $w->run('project_admin', ['status' => RunStatus::Running, 'runner_id' => $runner->id])->id, [
            'attempt' => 1, 'status' => 'succeeded',
        ]),
        'system' => true,
        'event' => EventType::AgentRunFinished,
    ],
    // the reaper (every minute) and the tidying up of the logs of runs (every hour), without an event of their own
    'ReapLostRuns' => [
        'action' => ReapLostRuns::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ReapLostRuns::run($a),
        'system' => true,
    ],
    'PruneRunEvents' => [
        'action' => PruneRunEvents::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PruneRunEvents::run($a),
        'system' => true,
    ],
    // the GitHub apps, one per account (WEBU-24, WEBU-35): every account reads them, org admins connect, sync and disconnect them; the repo of a
    // project and the confirmation of an unauthorized merge are its admins'
    'GetGitHub' => [
        'action' => GetGitHub::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetGitHub::run($a),
        'allowed' => $everyone,
    ],
    'StartManifest' => [
        'action' => StartManifest::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => StartManifest::run($a, ['owner' => 'feldwerk', 'owner_type' => 'Organization']),
        'allowed' => $catalogAdmins,
    ],
    'CompleteManifest' => [
        'action' => CompleteManifest::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            Cache::put(StartManifest::stateKey('matrix'), $a->user->id, 60);
            (new FakeGitHub)->fake();

            return CompleteManifest::run($a, ['code' => 'matrix', 'state' => 'matrix']);
        },
        'allowed' => $catalogAdmins,
        'event' => EventType::GitHubConnected,
    ],
    'SyncGitHub' => [
        'action' => SyncGitHub::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github();

            return SyncGitHub::run($a);
        },
        'allowed' => $catalogAdmins,
    ],
    // the way back from installing: with the state of the person it reads GitHub for those who manage it, does nothing for
    // anybody else (no refusal: a link must not tell)
    'ReturnFromInstallation' => [
        'action' => ReturnFromInstallation::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github();

            return ReturnFromInstallation::run($a, ['state' => StartManifest::issueState($a->user->id, 'setup')]);
        },
        'allowed' => $everyone,
    ],
    'DisconnectGitHub' => [
        'action' => DisconnectGitHub::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github();

            return DisconnectGitHub::run($a, GitHubApp::query()->firstOrFail());
        },
        'allowed' => $catalogAdmins,
        'event' => EventType::GitHubDisconnected,
    ],
    'GetProjectRepository' => [
        'action' => GetProjectRepository::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetProjectRepository::run($a, $w->github($column)?->project ?? $w->project($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'LinkRepository' => [
        'action' => LinkRepository::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github();

            return LinkRepository::run($a, $w->project($column), ['repository_id' => 'feldwerk/website']);
        },
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectRepositoryChanged,
    ],
    'ConfirmMergeGuard' => [
        'action' => ConfirmMergeGuard::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $link = $w->github($column);
            $link?->forceFill(['guard_detected_at' => now(), 'guard_sha' => str_repeat('a', 40), 'guard_branch' => 'main'])->save();

            return ConfirmMergeGuard::run($a, $w->project($column));
        },
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectMergeGuardConfirmed,
    ],
    // the working rules of the agents and the agent settings of a project (WEBU-26, spec 7.3, 10.3, 10.5)
    'ListAgentRules' => [
        'action' => ListAgentRules::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListAgentRules::run($a),
        'allowed' => $everyone,
    ],
    'SaveAgentRule' => [
        'action' => SaveAgentRule::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveAgentRule::run($a, 'review', ['body' => "Matrix rules {$column}"]),
        'allowed' => $catalogAdmins,
        'event' => EventType::AgentRulesUpdated,
    ],
    'GetProjectAgents' => [
        'action' => GetProjectAgents::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetProjectAgents::run($a, $w->project($column)),
        'allowed' => array_values(array_diff($everyone, ['outsider_private'])),
        'hidden' => ['outsider_private'],
    ],
    'SaveProjectAgents' => [
        'action' => SaveProjectAgents::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SaveProjectAgents::run($a, $w->project($column), [
            'review_bot_id' => null, 'instructions' => "Matrix {$column}", 'models' => ['review' => 'claude:opus'], 'max_corrections' => 2, 'max_conflicts' => 1,
            'review_person_prs' => false, 'comment_on_pr' => true, 'merge_method' => 'squash', 'setup_command' => null, 'teardown_command' => null,
        ]),
        'allowed' => $projectAdmins,
        'hidden' => ['outsider_private'],
        'event' => EventType::ProjectAgentSettingsUpdated,
    ],
    // the flow of the agents (WEBU-26, spec 7): the work of the consumer and of jobs, as the system; the feature tests
    // of tests/Feature/Agents play the paths that move items and queue runs
    'FollowEvent' => [
        'action' => FollowEvent::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => FollowEvent::run($a, Event::query()->where('type', EventType::BotCreated)->firstOrFail()),
        'system' => true,
    ],
    'StartTask' => [
        'action' => StartTask::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => StartTask::run($a, $w->item('project_admin'), $w->account('run_token')),
        'system' => true,
    ],
    'StartCorrection' => [
        'action' => StartCorrection::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => StartCorrection::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::MERGED]), 'ci', 'red'),
        'system' => true,
    ],
    'StartConflict' => [
        'action' => StartConflict::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => StartConflict::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::PAUSED]), str_repeat('a', 40)),
        'system' => true,
    ],
    'StartReview' => [
        'action' => StartReview::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => StartReview::run($a, $w->project('project_admin'), [
            'repository_github_id' => 700_000_001, 'repository' => 'feldwerk/website', 'number' => 1, 'head_sha' => str_repeat('a', 40), 'base_branch' => 'main',
        ], null, null),
        'system' => true,
    ],
    'StartComment' => [
        'action' => StartComment::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $item = $w->item('project_admin');

            return StartComment::run($a, $item, $w->account('run_token'), Comment::factory()->for($item, 'workItem')->create());
        },
        'system' => true,
    ],
    'PauseThread' => [
        'action' => PauseThread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PauseThread::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::PAUSED]), 'reassigned'),
        'system' => true,
    ],
    'HandleRunStarted' => [
        'action' => HandleRunStarted::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => HandleRunStarted::run($a, $w->run('project_admin', ['type' => RunType::Review])),
        'system' => true,
    ],
    'HandleRunResult' => [
        'action' => HandleRunResult::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => HandleRunResult::run($a, $w->run('project_admin', ['status' => RunStatus::Canceled])),
        'system' => true,
    ],
    'CompleteThread' => [
        'action' => CompleteThread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CompleteThread::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::MERGED]), 'merged'),
        'system' => true,
    ],
    'ReadyEpic' => [
        'action' => ReadyEpic::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ReadyEpic::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::PAUSED])),
        'system' => true,
    ],
    'ApproveAndMerge' => [
        'action' => ApproveAndMerge::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ApproveAndMerge::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])),
        'system' => true,
    ],
    'MergeThread' => [
        'action' => MergeThread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => MergeThread::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])->id, str_repeat('a', 40)),
        'system' => true,
    ],
    'GiveUpOnThread' => [
        'action' => GiveUpOnThread::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GiveUpOnThread::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])->id, 'merge', str_repeat('a', 40)),
        'system' => true,
    ],
    'LoadChecks' => [
        'action' => LoadChecks::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => LoadChecks::run($a, 700_000_001, str_repeat('a', 40)),
        'system' => true,
    ],
    'HandleAgentPullRequest' => [
        'action' => HandleAgentPullRequest::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => HandleAgentPullRequest::run($a, FakeGitHub::pullRequest('opened', 1)),
        'system' => true,
    ],
    'HandleCheckResult' => [
        'action' => HandleCheckResult::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => HandleCheckResult::run($a, 700_000_001, str_repeat('a', 40)),
        'system' => true,
    ],
    'CheckThreadMergeability' => [
        'action' => CheckThreadMergeability::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CheckThreadMergeability::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])->id),
        'system' => true,
    ],
    'PostReviewVerdict' => [
        'action' => PostReviewVerdict::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PostReviewVerdict::run($a, $w->run('project_admin')->id),
        'system' => true,
    ],
    'MarkThreadReady' => [
        'action' => MarkThreadReady::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => MarkThreadReady::run($a, AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])->id),
        'system' => true,
    ],
    'SweepAgentThreads' => [
        'action' => SweepAgentThreads::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => SweepAgentThreads::run($a),
        'system' => true,
    ],
    'ResumeAfterGuard' => [
        'action' => ResumeAfterGuard::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ResumeAfterGuard::run($a, [AgentThread::factory()->create(['bot_id' => $w->account('run_token')->id, 'work_item_id' => $w->item('project_admin')->id, 'status' => AgentThread::OPEN])->id]),
        'system' => true,
    ],
    // the webhook of GitHub and the token of a run (WEBU-24): no account, the actor is the system
    'ReceiveGitHubDelivery' => [
        'action' => ReceiveGitHubDelivery::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ReceiveGitHubDelivery::run($a, ['delivery' => 'matrix', 'event' => 'ping', 'body' => '{"zen":"Matrix"}']),
        'system' => true,
    ],
    'HandleGitHubDelivery' => [
        'action' => HandleGitHubDelivery::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github();
            $id = (string) Str::ulid();
            GitHubDelivery::query()->insert(['id' => $id, 'delivery_id' => 'matrix', 'event' => 'ping', 'payload' => '{}', 'received_at' => now()]);

            return HandleGitHubDelivery::run($a, $id);
        },
        'system' => true,
    ],
    'DetectUnauthorizedPush' => [
        'action' => DetectUnauthorizedPush::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github('project_admin');

            return DetectUnauthorizedPush::run($a, FakeGitHub::push(str_repeat('a', 40)));
        },
        'system' => true,
        'event' => EventType::ProjectMergeGuardDetected,
    ],
    // a PR of a person links its item (WEBU-25): the event of the link is the account's
    'SyncPullRequest' => [
        'action' => SyncPullRequest::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github('project_admin');
            $item = $w->item('project_admin');

            return SyncPullRequest::run($a, FakeGitHub::pullRequest('opened', 501, ['draft' => true, 'body' => "Refs {$item->key}"]));
        },
        'system' => true,
        'event' => EventType::WorkItemLinkAdded,
    ],
    'SyncChecks' => [
        'action' => SyncChecks::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github('project_admin');
            WorkItemLink::factory()->create(['work_item_id' => $w->item('project_admin')->id]);

            return SyncChecks::run($a, FakeGitHub::checkRun(str_repeat('a', 40), 'completed', 'success'));
        },
        'system' => true,
    ],
    'PostLinkback' => [
        'action' => PostLinkback::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github('project_admin');
            WorkItemLink::factory()->create(['work_item_id' => $w->item('project_admin')->id, 'number' => 502]);

            return PostLinkback::run($a, 700_000_001, 502);
        },
        'system' => true,
    ],
    'PruneGitHubDeliveries' => [
        'action' => PruneGitHubDeliveries::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => PruneGitHubDeliveries::run($a),
        'system' => true,
    ],
    'RenewGitToken' => [
        'action' => RenewGitToken::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->github('project_admin');

            return RenewGitToken::run($a, $runner = $w->runner(), $w->run('project_admin', ['status' => RunStatus::Running, 'runner_id' => $runner->id])->id, ['attempt' => 1]);
        },
        'system' => true,
    ],
];
