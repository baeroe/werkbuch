<?php

use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Notification;
use App\Models\PageVersion;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\Workflow;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use Illuminate\Http\UploadedFile;
use Tests\Feature\Access\MatrixWorld;

/*
 * The route matrix (RouteMatrixTest): every route below /api/v1 with its method and URI, the URI with the placeholders
 * of the route ({user}, {token}, …). A row with placeholders brings their values from the MatrixWorld:
 * `'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]`; a placeholder without a value fails the test. Rows
 * with `'session' => true` only work from the session of the interface (P6): every token gets 403 session_required. A
 * row with a `'body'` sends it along; `'session' => 'action'` means the action itself (not the route) wants the session
 * for what the body asks, so a token with the right ability gets 403 session_required there (and one without it the
 * usual 403 forbidden). Several rows may share one route.
 */

return [
    'show organization' => ['GET', '/api/v1/organization'],
    'change organization' => ['PATCH', '/api/v1/organization'],
    'list accounts' => ['GET', '/api/v1/users'],
    'change an account' => ['PATCH', '/api/v1/users/{user}', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'change the e-mail address of an account' => ['PATCH', '/api/v1/users/{user}', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id], 'body' => ['email' => 'matrix-new@example.com'], 'session' => 'action'],
    'set the role of an account' => ['PUT', '/api/v1/users/{user}/role', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'deactivate an account' => ['POST', '/api/v1/users/{user}/deactivate', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'reactivate an account' => ['POST', '/api/v1/users/{user}/reactivate', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'list bots' => ['GET', '/api/v1/bots'],
    'create a bot' => ['POST', '/api/v1/bots'],
    'list invitations' => ['GET', '/api/v1/invitations'],
    'invite a person' => ['POST', '/api/v1/invitations'],
    'list projects' => ['GET', '/api/v1/projects'],
    'create a project' => ['POST', '/api/v1/projects'],
    'show a project' => ['GET', '/api/v1/projects/{project}', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'change a project' => ['PATCH', '/api/v1/projects/{project}', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'delete a project' => ['DELETE', '/api/v1/projects/{project}', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'archive a project' => ['POST', '/api/v1/projects/{project}/archive', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'restore a project' => ['POST', '/api/v1/projects/{project}/restore', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'switch the workflow of a project' => ['PUT', '/api/v1/projects/{project}/workflow', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'join a project' => ['POST', '/api/v1/projects/{project}/join', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'list the members of a project' => ['GET', '/api/v1/projects/{project}/members', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'add a member to a project' => ['POST', '/api/v1/projects/{project}/members', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'change the role of a member' => ['PATCH', '/api/v1/projects/{project}/members/{user}', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'user' => $w->target->id]],
    'remove a member from a project' => ['DELETE', '/api/v1/projects/{project}/members/{user}', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'user' => $w->target->id]],
    'list the pages of a project' => ['GET', '/api/v1/projects/{project}/pages', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'create a page' => ['POST', '/api/v1/projects/{project}/pages', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier], 'body' => ['title' => 'Matrix']],
    'show a page' => ['GET', '/api/v1/pages/{page}', 'params' => fn (MatrixWorld $w) => ['page' => $w->page('project_admin')->id]],
    'save a page' => ['PATCH', '/api/v1/pages/{page}', 'params' => fn (MatrixWorld $w) => ['page' => $w->page('project_admin')->id], 'body' => ['title' => 'Matrix']],
    'move a page' => ['POST', '/api/v1/pages/{page}/move', 'params' => fn (MatrixWorld $w) => ['page' => $w->page('project_admin')->id], 'body' => ['parent_id' => null, 'before_id' => null]],
    'delete a page' => ['DELETE', '/api/v1/pages/{page}', 'params' => fn (MatrixWorld $w) => ['page' => $w->page('project_admin')->id]],
    'list the versions of a page' => ['GET', '/api/v1/pages/{page}/versions', 'params' => fn (MatrixWorld $w) => ['page' => $w->page('project_admin')->id]],
    'show a version of a page' => ['GET', '/api/v1/pages/{page}/versions/{pageVersion}', 'params' => fn (MatrixWorld $w) => [
        'page' => ($page = $w->page('project_admin'))->id, 'pageVersion' => PageVersion::factory()->create(['page_id' => $page->id])->id,
    ]],
    'restore a version of a page' => ['POST', '/api/v1/pages/{page}/versions/{pageVersion}/restore', 'params' => fn (MatrixWorld $w) => [
        'page' => ($page = $w->page('project_admin'))->id, 'pageVersion' => PageVersion::factory()->create(['page_id' => $page->id])->id,
    ]],
    'list the templates' => ['GET', '/api/v1/templates'],
    'list the templates of a project' => ['GET', '/api/v1/projects/{project}/templates', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'create a template' => ['POST', '/api/v1/projects/{project}/templates', 'params' => fn (MatrixWorld $w) => ['project' => $w->web->identifier], 'body' => ['name' => 'Matrix', 'payload' => ['title' => 'Matrix'], 'schedule' => null]],
    'show a template' => ['GET', '/api/v1/templates/{template}', 'params' => fn (MatrixWorld $w) => ['template' => $w->template('project_admin')->id]],
    'replace a template' => ['PUT', '/api/v1/templates/{template}', 'params' => fn (MatrixWorld $w) => ['template' => $w->template('project_admin')->id], 'body' => ['name' => 'Matrix', 'payload' => ['title' => 'Matrix'], 'schedule' => null]],
    'delete a template' => ['DELETE', '/api/v1/templates/{template}', 'params' => fn (MatrixWorld $w) => ['template' => $w->template('project_admin')->id]],
    'draft an item from a template' => ['GET', '/api/v1/templates/{template}/draft', 'params' => fn (MatrixWorld $w) => ['template' => $w->template('project_admin')->id]],
    'preview a schedule' => ['POST', '/api/v1/templates/preview', 'ability' => 'read', 'body' => ['schedule' => ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']]]],
    'list workflows' => ['GET', '/api/v1/workflows'],
    'create a workflow' => ['POST', '/api/v1/workflows'],
    'change a workflow' => ['PUT', '/api/v1/workflows/{workflow}', 'params' => fn (MatrixWorld $w) => ['workflow' => Workflow::factory()->create()->id]],
    'delete a workflow' => ['DELETE', '/api/v1/workflows/{workflow}', 'params' => fn (MatrixWorld $w) => ['workflow' => Workflow::factory()->create()->id]],
    'count the items per state' => ['GET', '/api/v1/state-usage', 'body' => ['project' => 'WEB']],
    'list work item types' => ['GET', '/api/v1/work-item-types'],
    'create a work item type' => ['POST', '/api/v1/work-item-types'],
    'change a work item type' => ['PUT', '/api/v1/work-item-types/{workItemType}', 'params' => fn (MatrixWorld $w) => ['workItemType' => WorkItemType::factory()->create()->id]],
    'delete a work item type' => ['DELETE', '/api/v1/work-item-types/{workItemType}', 'params' => fn (MatrixWorld $w) => ['workItemType' => WorkItemType::factory()->create()->id]],
    'list properties' => ['GET', '/api/v1/properties'],
    'create a property' => ['POST', '/api/v1/properties'],
    'change a property' => ['PUT', '/api/v1/properties/{property}', 'params' => fn (MatrixWorld $w) => ['property' => Property::factory()->create()->id]],
    'delete a property' => ['DELETE', '/api/v1/properties/{property}', 'params' => fn (MatrixWorld $w) => ['property' => Property::factory()->create()->id]],
    'list labels' => ['GET', '/api/v1/labels'],
    'create a label' => ['POST', '/api/v1/labels'],
    'change a label' => ['PUT', '/api/v1/labels/{label}', 'params' => fn (MatrixWorld $w) => ['label' => Label::factory()->create()->id]],
    'delete a label' => ['DELETE', '/api/v1/labels/{label}', 'params' => fn (MatrixWorld $w) => ['label' => Label::factory()->create()->id]],
    'list relation types' => ['GET', '/api/v1/relation-types'],
    'create a relation type' => ['POST', '/api/v1/relation-types'],
    'change a relation type' => ['PUT', '/api/v1/relation-types/{relationType}', 'params' => fn (MatrixWorld $w) => ['relationType' => RelationType::factory()->create()->id]],
    'delete a relation type' => ['DELETE', '/api/v1/relation-types/{relationType}', 'params' => fn (MatrixWorld $w) => ['relationType' => RelationType::factory()->create()->id]],
    'list resolutions' => ['GET', '/api/v1/resolutions'],
    'create a resolution' => ['POST', '/api/v1/resolutions'],
    'change a resolution' => ['PUT', '/api/v1/resolutions/{resolution}', 'params' => fn (MatrixWorld $w) => ['resolution' => Resolution::factory()->create()->id]],
    'delete a resolution' => ['DELETE', '/api/v1/resolutions/{resolution}', 'params' => fn (MatrixWorld $w) => ['resolution' => Resolution::factory()->create()->id]],
    'list work items' => ['GET', '/api/v1/work-items'],
    'create a work item' => ['POST', '/api/v1/work-items', 'body' => ['project_id' => 'WEB', 'title' => 'Matrix']],
    // a read through a body (P15): a read-only token may send it
    'query work items' => ['POST', '/api/v1/work-items/query', 'body' => ['filter' => ['version' => 1, 'conditions' => []]], 'ability' => 'read'],
    'group work items' => ['POST', '/api/v1/work-items/groups', 'body' => ['group_by' => 'state'], 'ability' => 'read'],
    'count work items' => ['POST', '/api/v1/work-items/counts', 'body' => ['filters' => ['all' => ['version' => 1, 'conditions' => []]]], 'ability' => 'read'],
    'change many work items' => ['POST', '/api/v1/work-items/bulk', 'body' => ['ids' => ['WEB-1'], 'patch' => ['priority' => 'high']]],
    'show a work item' => ['GET', '/api/v1/work-items/{item}', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'change a work item' => ['PATCH', '/api/v1/work-items/{item}', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key], 'body' => ['title' => 'Matrix']],
    'move a work item' => ['POST', '/api/v1/work-items/{item}/transition', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'change the type of a work item' => ['PUT', '/api/v1/work-items/{item}/type', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'archive a work item' => ['POST', '/api/v1/work-items/{item}/archive', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin', 'closed')->key]],
    'restore a work item' => ['POST', '/api/v1/work-items/{item}/restore', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin', 'archived')->key]],
    'delete a work item' => ['DELETE', '/api/v1/work-items/{item}', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'list the subscribers of a work item' => ['GET', '/api/v1/work-items/{item}/subscribers', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'watch a work item' => ['PUT', '/api/v1/work-items/{item}/subscription', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'stop watching a work item' => ['DELETE', '/api/v1/work-items/{item}/subscription', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'list the relations of a work item' => ['GET', '/api/v1/work-items/{item}/relations', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'add a relation' => ['POST', '/api/v1/work-items/{item}/relations', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key], 'body' => ['type_id' => '', 'target_id' => 'WEB-1']],
    'show the history of a work item' => ['GET', '/api/v1/work-items/{item}/history', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'remove a relation' => ['DELETE', '/api/v1/relations/{relation}', 'params' => fn (MatrixWorld $w) => ['relation' => WorkItemRelation::factory()->create([
        'source_id' => $w->item('project_admin')->id,
        'target_id' => $w->item('project_admin')->id,
    ])->id]],
    'list the comments of a work item' => ['GET', '/api/v1/work-items/{item}/comments', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'comment on a work item' => ['POST', '/api/v1/work-items/{item}/comments', 'params' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key], 'body' => ['body' => 'Matrix']],
    'show a comment' => ['GET', '/api/v1/comments/{comment}', 'params' => fn (MatrixWorld $w) => ['comment' => Comment::factory()->for($w->item('project_admin'), 'workItem')->create()->id]],
    // the tokens are the org admin's: their own comment
    'edit a comment' => ['PATCH', '/api/v1/comments/{comment}', 'params' => fn (MatrixWorld $w) => ['comment' => Comment::factory()->for($w->item('project_admin'), 'workItem')->create(['author_id' => $w->account('org_admin')->id])->id], 'body' => ['body' => 'Matrix']],
    'delete a comment' => ['DELETE', '/api/v1/comments/{comment}', 'params' => fn (MatrixWorld $w) => ['comment' => Comment::factory()->for($w->item('project_admin'), 'workItem')->create()->id]],
    'react to a comment' => ['PUT', '/api/v1/comments/{comment}/reactions', 'params' => fn (MatrixWorld $w) => ['comment' => Comment::factory()->for($w->item('project_admin'), 'workItem')->create()->id], 'body' => ['emoji' => '👍']],
    'take back a reaction' => ['DELETE', '/api/v1/comments/{comment}/reactions', 'params' => fn (MatrixWorld $w) => ['comment' => Comment::factory()->for($w->item('project_admin'), 'workItem')->create()->id], 'body' => ['emoji' => '👍']],
    'search items, projects, people and views' => ['GET', '/api/v1/search'],
    'list who can be mentioned' => ['GET', '/api/v1/mentions', 'body' => ['project' => 'WEB']],
    'resolve references' => ['GET', '/api/v1/references', 'body' => ['items' => '01jbz7m0000000000000000000']],
    'upload an attachment' => ['POST', '/api/v1/attachments', 'body' => ['project_id' => 'WEB', 'kind' => 'inline', 'file' => UploadedFile::fake()->createWithContent('matrix.txt', 'Matrix')]],
    'show an attachment' => ['GET', '/api/v1/attachments/{attachment}', 'params' => fn (MatrixWorld $w) => ['attachment' => Attachment::factory()->forItem($w->item('project_admin'))->create()->id]],
    'delete an attachment' => ['DELETE', '/api/v1/attachments/{attachment}', 'params' => fn (MatrixWorld $w) => ['attachment' => Attachment::factory()->forItem($w->item('project_admin'), 'file')->create()->id]],
    'list views' => ['GET', '/api/v1/views'],
    'create a view' => ['POST', '/api/v1/views', 'body' => [
        'name' => 'Matrix', 'icon' => 'layers', 'filter' => ['version' => 1, 'conditions' => []],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]],
    'show a view' => ['GET', '/api/v1/views/{view}', 'params' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
    'replace a view' => ['PUT', '/api/v1/views/{view}', 'params' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
    'delete a view' => ['DELETE', '/api/v1/views/{view}', 'params' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
    'list the own favorites' => ['GET', '/api/v1/favorites'],
    'toggle a favorite' => ['POST', '/api/v1/favorites/toggle'],
    'list the own notifications' => ['GET', '/api/v1/notifications'],
    'mark notifications read' => ['POST', '/api/v1/notifications/read', 'body' => ['all' => true]],
    'mark notifications unread' => ['POST', '/api/v1/notifications/unread', 'body' => ['ids' => ['01jc0000000000000000000000']]],
    'delete a notification' => ['DELETE', '/api/v1/notifications/{notification}', 'params' => fn (MatrixWorld $w) => ['notification' => Notification::factory()->forItem($w->item('project_admin'))->create(['user_id' => $w->account('org_admin')->id])->id]],
    'show the own notification preferences' => ['GET', '/api/v1/notification-preferences'],
    'change the own notification preferences' => ['PUT', '/api/v1/notification-preferences', 'body' => ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]]],
    'show the system' => ['GET', '/api/v1/system'],
    'put failed jobs back' => ['POST', '/api/v1/system/failed-jobs/retry'],
    'send a test mail' => ['POST', '/api/v1/system/test-mail'],
    'list tokens' => ['GET', '/api/v1/tokens'],
    'create a token' => ['POST', '/api/v1/tokens', 'session' => true],
    'revoke a token' => ['DELETE', '/api/v1/tokens/{token}', 'params' => fn (MatrixWorld $w) => ['token' => $w->bot->createToken('Matrix', ['read'])->accessToken->id]],
    'change the own password' => ['PUT', '/api/v1/me/password', 'session' => true],
    'show the own second factor' => ['GET', '/api/v1/me/two-factor', 'session' => true],
    'start the setup of the second factor' => ['POST', '/api/v1/me/two-factor', 'session' => true],
    'confirm the second factor' => ['POST', '/api/v1/me/two-factor/confirm', 'session' => true],
    'turn the second factor off' => ['DELETE', '/api/v1/me/two-factor', 'session' => true],
    'make new recovery codes' => ['POST', '/api/v1/me/two-factor/recovery-codes', 'session' => true],
];
