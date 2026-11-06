<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Actions\System\RetryFailedJobs;
use App\Actions\Templates\PreviewSchedule;
use App\Actions\Templates\SaveTemplate;
use App\Actions\Webhooks\SaveWebhook;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Schedule\Schedule;
use App\Domain\WorkItems\Priority;
use App\Models\Notification;
use App\Models\Page;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\WorkItem;
use App\Support\ItemInput;
use App\Support\TemplateInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;
use Tests\Support\RichTextFixtures as F;
use Tests\Support\ScriptedTransport;

/*
 * The wiki, the templates, the notifications, the system page and the webhooks in the document (Phase 12, Task 12).
 * What Scramble cannot read from the actions the controllers say with `#[Body]` and `#[Answer]`; this file holds that
 * against the code:
 *  (a) every operation, its success status and its tag are the ones the server answers,
 *  (b) the resources say what they hold (the tree of pages is recursive, a template its payload and schedule, a
 *      notification its data), the answers that are no `{data: Resource}`,
 *  (c) the keys of a body are the ones the server reads (`FIELDS`); every body is open (K2) and takes the keys of its own
 *      answer back as read-only (A75); the schedule alone is closed, its parser refuses an unknown key,
 *  (d) a client can send every key the document names (a full request per operation, `Contract::sentKeys`, K15),
 *  (e) the descriptions say what the server does: the conflict, the secret shown once, the limit of sending.
 * The answers themselves are held against the document by the contract of every test.
 */

$tags = ['Pages', 'PageVersions', 'Templates', 'Notifications', 'NotificationPreferences', 'System', 'Webhooks'];

$body = fn (string $method, string $path): array => Document::operation($method, $path)['requestBody']['content']['application/json']['schema'] ?? [];
$answer = fn (string $method, string $path, int $status): array => Document::operation($method, $path)['responses'][(string) $status]['content']['application/json']['schema'] ?? [];
$schema = fn (string $name): array => Document::get()['components']['schemas'][$name];
$writable = fn (array $object): array => array_keys(array_filter($object['properties'], fn (array $property) => ! ($property['readOnly'] ?? false)));

/** The operations of these tags: `"<METHOD> <path>" => success status`. */
$operations = [
    'GET /projects/{project}/pages' => 200, 'POST /projects/{project}/pages' => 201, 'GET /pages/{page}' => 200, 'PATCH /pages/{page}' => 200,
    'DELETE /pages/{page}' => 200, 'POST /pages/{page}/move' => 200,
    'GET /pages/{page}/versions' => 200, 'GET /pages/{page}/versions/{pageVersion}' => 200, 'POST /pages/{page}/versions/{pageVersion}/restore' => 200,
    'GET /templates' => 200, 'GET /projects/{project}/templates' => 200, 'POST /projects/{project}/templates' => 201, 'GET /templates/{template}' => 200,
    'PUT /templates/{template}' => 200, 'DELETE /templates/{template}' => 204, 'GET /templates/{template}/draft' => 200, 'POST /templates/{template}/run' => 200,
    'GET /templates/{template}/runs' => 200, 'POST /templates/preview' => 200,
    'GET /notifications' => 200, 'POST /notifications/read' => 200, 'POST /notifications/unread' => 200, 'DELETE /notifications/{notification}' => 204,
    'GET /notification-preferences' => 200, 'PUT /notification-preferences' => 200,
    'GET /system' => 200, 'POST /system/failed-jobs/retry' => 200, 'POST /system/test-mail' => 200,
    'GET /webhooks' => 200, 'POST /webhooks' => 201, 'GET /webhooks/{webhook}' => 200, 'PUT /webhooks/{webhook}' => 200, 'DELETE /webhooks/{webhook}' => 204,
    'POST /webhooks/{webhook}/rotate-secret' => 200, 'GET /webhooks/{webhook}/deliveries' => 200, 'POST /webhooks/{webhook}/ping' => 200,
    'POST /webhooks/{webhook}/deliveries/{delivery}/redeliver' => 200,
];

it('documents the success status the server answers for every operation', function () use ($operations, $tags) {
    foreach ($operations as $key => $status) {
        [$method, $path] = explode(' ', $key, 2);
        $operation = Document::operation($method, $path);
        $success = array_map('intval', array_values(array_filter(array_keys($operation['responses']), fn ($s) => (int) $s >= 200 && (int) $s < 300)));

        expect($success)->toBe([$status], $key)
            ->and(in_array($operation['tags'][0], $tags, true))->toBeTrue($key)
            ->and($operation['summary'] ?? '')->not->toBe('', $key);
    }

    $tagged = array_keys(array_filter(Document::operations(), fn ($op) => array_intersect($op['tags'] ?? [], $tags) !== []));
    expect($tagged)->toEqualCanonicalizing(array_keys($operations));
});

it('names the resource every answer carries', function () use ($answer, $operations) {
    foreach ([
        'POST /projects/{project}/pages' => 'PageResource', 'GET /pages/{page}' => 'PageResource', 'PATCH /pages/{page}' => 'PageResource',
        'POST /pages/{page}/move' => 'PageResource', 'POST /pages/{page}/versions/{pageVersion}/restore' => 'PageResource',
        'GET /pages/{page}/versions/{pageVersion}' => 'PageVersionResource',
        'POST /projects/{project}/templates' => 'TemplateResource', 'GET /templates/{template}' => 'TemplateResource', 'PUT /templates/{template}' => 'TemplateResource',
        'GET /templates/{template}/draft' => 'TemplateDraftResource', 'GET /system' => 'SystemStatusResource',
        'POST /webhooks' => 'WebhookResource', 'GET /webhooks/{webhook}' => 'WebhookResource', 'PUT /webhooks/{webhook}' => 'WebhookResource',
        'POST /webhooks/{webhook}/rotate-secret' => 'WebhookResource',
        'POST /webhooks/{webhook}/ping' => 'WebhookDeliveryResource', 'POST /webhooks/{webhook}/deliveries/{delivery}/redeliver' => 'WebhookDeliveryResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);

        expect(basename((string) ($answer($method, $path, $operations[$key])['properties']['data']['$ref'] ?? '')))->toBe($resource, $key);
    }

    foreach ([
        'GET /pages/{page}/versions' => 'PageVersionResource', 'GET /templates' => 'TemplateResource', 'GET /projects/{project}/templates' => 'TemplateResource',
        'GET /templates/{template}/runs' => 'TemplateRunResource', 'GET /notifications' => 'NotificationResource', 'GET /webhooks' => 'WebhookResource',
        'GET /webhooks/{webhook}/deliveries' => 'WebhookDeliveryResource', 'GET /notification-preferences' => 'NotificationPreferenceResource',
        'PUT /notification-preferences' => 'NotificationPreferenceResource', 'GET /projects/{project}/pages' => 'PageNodeResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);

        expect(basename((string) ($answer($method, $path, 200)['properties']['data']['items']['$ref'] ?? '')))->toBe($resource, $key);
    }
});

it('describes the tree of pages as a recursive node without cursor', function () use ($answer, $schema) {
    $tree = $answer('GET', '/projects/{project}/pages', 200);
    $node = $schema('PageNodeResource')['properties'];

    expect($tree['required'])->toBe(['data', 'meta'])
        ->and($tree['properties']['meta']['required'])->toBe(['total'])
        ->and($node['children']['items']['$ref'])->toBe('#/components/schemas/PageNodeResource')
        ->and($schema('PageNodeResource')['required'])->toContain('children')
        ->and($schema('PageNodeResource')['required'])->not->toContain('content')
        ->and($schema('PageNodeResource')['required'])->not->toContain('content_json')
        ->and($node['content_json']['anyOf'][0]['$ref'])->toBe('#/components/schemas/RichTextDocument')
        ->and($node['created_at']['format'])->toBe('date-time');
});

it('describes a page and a version with their text, their numbers and their times', function () use ($schema) {
    $page = $schema('PageResource');
    $version = $schema('PageVersionResource');

    expect($page['properties']['version']['minimum'])->toBe(1)
        ->and($page['properties']['content']['type'])->toBe(['string', 'null'])
        ->and($page['properties']['content_json']['anyOf'][0]['$ref'])->toBe('#/components/schemas/RichTextDocument')
        ->and($page['properties']['updated_at']['format'])->toBe('date-time')
        ->and($page['required'])->not->toContain('content')
        ->and($page['required'])->not->toContain('content_json')
        ->and($version['required'])->not->toContain('content')
        ->and($version['required'])->not->toContain('content_json')
        ->and($version['properties']['content_json']['anyOf'][0]['$ref'])->toBe('#/components/schemas/RichTextDocument')
        ->and($version['properties']['created_at']['format'])->toBe('date-time');
});

it('describes a template with its payload, its schedule and its runs', function () use ($schema, $answer) {
    $template = $schema('TemplateResource');
    $payload = $template['properties']['payload'];
    $run = $schema('TemplateRunResource')['properties'];
    $ran = $answer('POST', '/templates/{template}/run', 200)['properties']['data'];

    expect($payload['required'])->toBe(['type_id', 'title', 'priority', 'assignee_id', 'label_ids', 'values', 'parent_id', 'start_offset_days', 'due_offset_days'])
        ->and($payload['properties']['priority']['enum'])->toBe(array_column(Priority::cases(), 'value'))
        ->and($payload['properties']['description_json']['anyOf'][0]['$ref'])->toBe('#/components/schemas/RichTextDocument')
        ->and($template['properties']['schedule']['anyOf'][0]['$ref'])->toBe('#/components/schemas/Schedule')
        ->and($template['properties']['next_run_at']['format'])->toBe('date-time')
        ->and($run['status']['enum'])->toBe(['created', 'failed'])
        ->and($run['scheduled_for']['format'])->toBe('date-time')
        ->and($ran['required'])->toBe(['run', 'item'])
        ->and($ran['properties']['run']['$ref'])->toBe('#/components/schemas/TemplateRunResource')
        ->and($ran['properties']['item']['anyOf'][0]['$ref'])->toBe('#/components/schemas/WorkItemResource')
        ->and($ran['properties']['item']['anyOf'][1])->toBe(['type' => 'null'])
        ->and($schema('TemplateDraftResource')['properties']['start_date']['format'])->toBe('date');
});

it('describes the schedule with the keys its parser reads and nothing else', function () use ($schema) {
    $schedule = $schema('Schedule');
    $known = (new ReflectionClassConstant(Schedule::class, 'KEYS'))->getValue();

    expect(array_keys($schedule['properties']))->toBe($known)
        ->and($schedule['required'])->toBe(['frequency', 'interval', 'time', 'starts_on', 'ends'])
        ->and($schedule['properties']['frequency']['enum'])->toBe(['daily', 'weekly', 'monthly', 'yearly'])
        ->and($schedule['properties']['interval']['maximum'])->toBe(999)
        ->and($schedule['properties']['nth_weekday']['properties']['n']['enum'])->toBe([1, 2, 3, 4, -1])
        ->and($schedule['properties']['ends']['properties']['count']['maximum'])->toBe(9999)
        // the parser refuses a key it does not know (`field.schedule.shape`) at the schedule, at `ends` and at `nth_weekday`
        // (the harness opens the whole subtree of a body marked `x-werkbuch-open`, so this is documentation only there)
        ->and($schedule['description'])->toContain('A key that is not listed is `field.schedule.shape`.')
        ->and($schedule['additionalProperties'])->toBeFalse()
        ->and($schedule['properties']['ends']['additionalProperties'])->toBeFalse()
        ->and($schedule['properties']['nth_weekday']['additionalProperties'])->toBeFalse();
});

it('describes a notification with its data, its times and its excerpt', function () use ($schema) {
    $notification = $schema('NotificationResource')['properties'];
    $data = $notification['data'];

    expect(array_keys($data['properties']))->toBe(['source', 'comment_id', 'from', 'to', 'fields', 'due_date', 'overdue', 'template_id', 'error', 'webhook_id', 'name'])
        ->and($data['x-werkbuch-open'])->toBeTrue()
        ->and($data['properties']['source']['enum'])->toBe(['comment', 'description', 'values'])
        ->and($notification['read_at']['format'])->toBe('date-time')
        ->and($notification['mailed_at']['format'])->toBe('date-time')
        ->and($notification['excerpt']['type'])->toBe(['string', 'null'])
        ->and($schema('NotificationPreferenceResource')['properties']['enabled']['type'])->toBe('boolean')
        ->and($schema('NotificationPreferenceResource')['properties']['event']['enum'])->toBe(array_column(NotificationKind::cases(), 'value'));
});

it('describes the system status and a webhook with its attempts', function () use ($schema) {
    $system = $schema('SystemStatusResource')['properties'];
    $webhook = $schema('WebhookResource')['properties'];
    $attempt = $schema('WebhookDeliveryResource')['properties'];

    expect($system['queues']['items']['required'])->toBe(['queue', 'pending', 'oldest_at'])
        ->and($system['failed_jobs']['items']['required'])->toBe(['id', 'queue', 'job', 'error', 'failed_at'])
        ->and($system['search']['enum'])->toBe(['ok', 'down'])
        ->and($system['live']['enum'])->toBe(['ok', 'down', 'off'])
        ->and($system['search_tasks']['anyOf'][1])->toBe(['type' => 'null'])
        ->and($system['mail_configured']['type'])->toBe('boolean')
        ->and($webhook['disabled_at']['format'])->toBe('date-time')
        ->and($webhook['failing_since']['format'])->toBe('date-time')
        ->and($attempt['kind']['enum'])->toBe(['scheduled', 'manual', 'ping'])
        ->and($attempt['status_code']['type'])->toBe(['integer', 'null'])
        ->and($attempt['created_at']['format'])->toBe('date-time');
});

it('describes the answers that are no resource', function () use ($answer) {
    $secret = $answer('POST', '/webhooks', 201);

    expect($answer('DELETE', '/pages/{page}', 200)['required'])->toBe(['deleted'])
        ->and($answer('POST', '/notifications/read', 200)['required'])->toBe(['updated'])
        ->and($answer('POST', '/notifications/unread', 200)['required'])->toBe(['updated'])
        ->and($answer('POST', '/system/failed-jobs/retry', 200)['required'])->toBe(['retried'])
        ->and($answer('POST', '/system/test-mail', 200)['required'])->toBe(['sent_to'])
        ->and($secret['required'])->toBe(['data', 'secret'])
        ->and($secret['properties']['secret']['description'])->toContain('Shown once')
        ->and($answer('POST', '/webhooks/{webhook}/rotate-secret', 200)['properties']['secret']['description'])->toContain('Shown once')
        ->and($answer('POST', '/templates/preview', 200)['properties']['data']['required'])->toBe(['runs', 'title'])
        ->and($answer('POST', '/templates/preview', 200)['properties']['data']['properties']['runs']['maxItems'])->toBe(5);
});

/** Per operation with a body: the keys the server reads. Every one is open: no action refuses a key it does not know (K2). */
$bodies = [
    'POST /projects/{project}/pages' => CreatePage::FIELDS,
    'PATCH /pages/{page}' => UpdatePage::FIELDS,
    'POST /pages/{page}/move' => MovePage::FIELDS,
    'POST /projects/{project}/templates' => SaveTemplate::FIELDS,
    'PUT /templates/{template}' => SaveTemplate::FIELDS,
    'POST /templates/preview' => PreviewSchedule::FIELDS,
    'POST /notifications/read' => MarkNotificationsRead::FIELDS,
    'POST /notifications/unread' => MarkNotificationsUnread::FIELDS,
    'PUT /notification-preferences' => SaveNotificationPreferences::FIELDS,
    'POST /system/failed-jobs/retry' => RetryFailedJobs::FIELDS,
    'POST /webhooks' => SaveWebhook::FIELDS,
    'PUT /webhooks/{webhook}' => SaveWebhook::FIELDS,
];

it('documents the keys the server reads and keeps every body open', function () use ($bodies, $body, $writable) {
    foreach ($bodies as $key => $keys) {
        [$method, $path] = explode(' ', $key, 2);
        $schema = $body($method, $path);
        $content = array_keys(Document::operation($method, $path)['requestBody']['content']);

        expect($content)->toBe(['application/json'], $key)
            ->and($writable($schema))->toEqualCanonicalizing($keys, $key)
            ->and($schema['x-werkbuch-open'])->toBeTrue($key);
    }
});

it('says what a body requires', function () use ($body) {
    expect($body('POST', '/projects/{project}/pages')['required'])->toBe(['title'])
        ->and($body('PATCH', '/pages/{page}'))->not->toHaveKey('required')
        ->and($body('POST', '/pages/{page}/move')['required'])->toBe(MovePage::FIELDS)
        ->and($body('POST', '/projects/{project}/templates')['required'])->toBe(TemplateInput::FIELDS)
        ->and($body('PUT', '/templates/{template}')['required'])->toBe(TemplateInput::FIELDS)
        ->and($body('POST', '/projects/{project}/templates')['properties']['payload']['required'])->toBe(['title'])
        ->and($body('POST', '/projects/{project}/templates')['properties']['schedule']['anyOf'][1])->toBe(['type' => 'null'])
        ->and($body('POST', '/templates/preview')['required'])->toBe(['schedule'])
        ->and($body('POST', '/notifications/read'))->not->toHaveKey('required')
        ->and($body('POST', '/notifications/unread')['required'])->toBe(['ids'])
        ->and($body('PUT', '/notification-preferences')['required'])->toBe(['preferences'])
        ->and($body('PUT', '/notification-preferences')['properties']['preferences']['items']['required'])->toBe(['event', 'channel', 'enabled'])
        ->and($body('PUT', '/notification-preferences')['properties']['preferences']['items']['x-werkbuch-open'])->toBeTrue()
        ->and($body('POST', '/system/failed-jobs/retry'))->not->toHaveKey('required')
        ->and($body('POST', '/webhooks')['required'])->toBe(SaveWebhook::FIELDS)
        ->and($body('PUT', '/webhooks/{webhook}')['required'])->toBe(SaveWebhook::FIELDS)
        ->and($body('POST', '/webhooks')['properties']['url']['maxLength'])->toBe(2048)
        ->and($body('POST', '/webhooks')['properties']['events']['items']['enum'])->toContain('work_item.created')
        ->and($body('POST', '/webhooks')['properties']['events']['items']['enum'])->toContain('work_item.*')
        ->and($body('POST', '/templates/preview')['properties']['title']['maxLength'])->toBe(ItemInput::TITLE_MAX)
        ->and($body('POST', '/projects/{project}/pages')['properties']['title']['maxLength'])->toBe(200)
        ->and(Document::operation('POST', '/projects/{project}/pages')['requestBody']['required'])->toBeTrue()
        ->and(Document::operation('PATCH', '/pages/{page}')['requestBody']['required'] ?? false)->toBeFalse();
});

it('takes the keys of its own answer back in a body as read-only (A75, K2)', function () use ($body) {
    foreach ([
        ['PATCH', '/pages/{page}', ['id', 'project_id', 'parent_id', 'rank', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at']],
        ['POST', '/projects/{project}/templates', ['id', 'project_id', 'run_count', 'last_run_at', 'next_run_at', 'created_by', 'created_at', 'updated_at']],
        ['PUT', '/templates/{template}', ['id', 'project_id', 'run_count', 'last_run_at', 'next_run_at', 'created_by', 'created_at', 'updated_at']],
        ['POST', '/webhooks', ['id', 'disabled_at', 'failing_since', 'last_success_at', 'created_by', 'created_at', 'updated_at', 'secret']],
        ['PUT', '/webhooks/{webhook}', ['id', 'disabled_at', 'failing_since', 'last_success_at', 'created_by', 'created_at', 'updated_at', 'secret']],
    ] as [$method, $path, $keys]) {
        $properties = $body($method, $path)['properties'];

        foreach ($keys as $key) {
            expect($properties[$key]['readOnly'])->toBeTrue("{$method} {$path} {$key}")
                ->and($properties[$key]['description'] ?? '')->toContain('ignored');
        }
    }

    expect($body('POST', '/projects/{project}/templates')['properties']['payload']['properties']['values_markdown']['readOnly'])->toBeTrue()
        ->and($body('PUT', '/notification-preferences')['properties']['preferences']['items']['properties']['user_id']['readOnly'])->toBeTrue();
});

it('says what the server does in the descriptions', function () use ($body) {
    $update = Document::operation('PATCH', '/pages/{page}');
    $ping = Document::operation('POST', '/webhooks/{webhook}/ping');
    $again = Document::operation('POST', '/webhooks/{webhook}/deliveries/{delivery}/redeliver');

    expect($update['description'])->toContain('409 `page_conflict`')
        ->and($body('PATCH', '/pages/{page}')['description'])->toContain('base_version')
        ->and($body('PATCH', '/pages/{page}')['description'])->toContain('keep_current')
        ->and($body('POST', '/pages/{page}/move')['description'])->toContain('field.parent_page.cycle')
        ->and(Document::operation('POST', '/webhooks')['description'])->toContain('shown once')
        ->and(Document::operation('POST', '/webhooks/{webhook}/rotate-secret')['description'])->toContain('shown once')
        ->and($ping['description'])->toContain('6 a minute')
        ->and($again['description'])->toContain('6 a minute')
        ->and($ping['description'])->toContain('503 `webhook_not_logged`')
        ->and($again['description'])->toContain('503 `webhook_not_logged`')
        ->and($body('PATCH', '/pages/{page}')['description'])->toContain('leave out `content`')
        ->and(array_key_exists('429', $ping['responses']))->toBeTrue()
        ->and(array_key_exists('429', $again['responses']))->toBeTrue()
        ->and(Document::operation('POST', '/system/test-mail')['description'])->toContain('6 a minute')
        ->and(Document::operation('POST', '/templates/preview')['description'])->toContain('read token')
        ->and($body('POST', '/projects/{project}/templates')['description'])->toContain('counts from now');
});

it('lets a client send and read everything the document names', function () use ($bodies, $body, $writable) {
    $mara = User::factory()->admin()->create(['name' => 'Mara', 'handle' => 'mara', 'email' => 'mara@example.com']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $other = Page::factory()->for($web)->withText('Daneben')->create(['title' => 'Daneben']);
    $item = WorkItem::factory()->for($web)->create();
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('ok')]);
    $this->actingAs($mara, 'web');

    // the wiki: every key of create, update and move; the versions
    $page = $this->postJson("/api/v1/projects/{$web->identifier}/pages", ['title' => 'Plan', 'emoji' => '📘', 'parent_id' => null, 'content' => 'Danke @mara'])->assertCreated()->json('data');
    $this->postJson("/api/v1/projects/{$web->id}/pages", ['title' => 'Unter', 'parent_id' => $page['id'], 'content_json' => F::doc(F::p('Zwei'))])->assertCreated();
    $saved = $this->patchJson("/api/v1/pages/{$page['id']}", ['title' => 'Plan 2', 'emoji' => null, 'content_json' => F::doc(F::p('Neu')), 'base_version' => 1, 'keep_current' => true])->assertOk()->json('data');
    $this->patchJson("/api/v1/pages/{$page['id']}", ['content' => 'Noch neuer', 'base_version' => $saved['version'], 'keep_current' => false])->assertOk();
    $this->patchJson("/api/v1/pages/{$page['id']}", [...array_diff_key($saved, ['content' => 1]), 'title' => 'Anders', 'base_version' => 1])->assertConflict()->assertJsonPath('current.id', $page['id']);
    $this->postJson("/api/v1/pages/{$other->id}/move", ['parent_id' => $page['id'], 'before_id' => null])->assertOk();
    $this->postJson("/api/v1/pages/{$other->id}/move", ['parent_id' => null, 'before_id' => $page['id']])->assertOk();
    $this->getJson("/api/v1/projects/{$web->id}/pages")->assertOk();
    $versions = $this->getJson("/api/v1/pages/{$page['id']}/versions")->assertOk()->json('data');
    $this->getJson("/api/v1/pages/{$page['id']}/versions/{$versions[0]['id']}")->assertOk();
    $this->postJson("/api/v1/pages/{$page['id']}/versions/{$versions[0]['id']}/restore")->assertOk();
    $this->deleteJson("/api/v1/pages/{$page['id']}")->assertOk()->assertJsonPath('deleted', 2);

    // templates: both forms of the description, every key of the payload, a schedule of each frequency, the echo of the answer
    $payload = ['type_id' => null, 'title' => 'Bericht {month_name}', 'description_json' => F::doc(F::p('Zahlen')), 'priority' => 'low', 'assignee_id' => $mara->id,
        'label_ids' => [], 'values' => [], 'parent_id' => null, 'start_offset_days' => 1, 'due_offset_days' => 3];
    $schedule = ['frequency' => 'monthly', 'interval' => 1, 'weekdays' => [], 'month_day' => 'last', 'nth_weekday' => null, 'yearly_date' => null,
        'time' => '09:00', 'starts_on' => '2036-01-01', 'ends' => ['type' => 'count', 'count' => 5], 'paused' => false];
    $template = $this->postJson("/api/v1/projects/{$web->id}/templates", ['name' => 'Bericht', 'payload' => $payload, 'schedule' => $schedule])->assertCreated()->json('data');
    $this->postJson("/api/v1/projects/{$web->id}/templates", ['name' => 'Wöchentlich', 'payload' => ['title' => 'Wartung', 'description' => 'Text'],
        'schedule' => ['frequency' => 'weekly', 'interval' => 2, 'weekdays' => [1, 3], 'time' => '08:30', 'starts_on' => '2036-01-01', 'ends' => ['type' => 'on', 'date' => '2037-01-01']]])->assertCreated();
    $this->postJson("/api/v1/projects/{$web->id}/templates", ['name' => 'Jährlich', 'payload' => ['title' => 'Prüfung'],
        'schedule' => ['frequency' => 'yearly', 'interval' => 1, 'yearly_date' => '02-29', 'time' => '08:30', 'starts_on' => '2036-01-01', 'ends' => ['type' => 'never']]])->assertCreated();
    $this->postJson("/api/v1/projects/{$web->id}/templates", ['name' => 'Täglich', 'payload' => ['title' => 'Tag'], 'schedule' => null])->assertCreated();
    $this->putJson("/api/v1/templates/{$template['id']}", [...$template, 'payload' => array_diff_key($template['payload'], ['description' => 1])])->assertOk();
    $this->getJson('/api/v1/templates?lean=1')->assertOk();
    $this->getJson("/api/v1/templates/{$template['id']}/draft")->assertOk();
    $this->postJson('/api/v1/templates/preview', ['schedule' => $schedule, 'title' => 'Bericht {month_name}', 'run_count' => 1])->assertOk();
    // the parser refuses a key it does not know, at the schedule, at `ends` and at `nth_weekday`
    $this->postJson('/api/v1/templates/preview', ['schedule' => [...$schedule, 'extra' => 1]])->assertUnprocessable()->assertJsonPath('reason', 'validation_failed');
    $this->postJson('/api/v1/templates/preview', ['schedule' => [...$schedule, 'ends' => ['type' => 'never', 'extra' => 1]]])->assertUnprocessable();
    $this->postJson('/api/v1/templates/preview', ['schedule' => [...$schedule, 'nth_weekday' => ['n' => 1, 'weekday' => 1, 'extra' => 1]]])->assertUnprocessable();
    $this->postJson("/api/v1/templates/{$template['id']}/run")->assertOk()->assertJsonPath('data.run.status', 'created');
    $this->getJson("/api/v1/templates/{$template['id']}/runs")->assertOk()->assertJsonCount(1, 'data');
    $this->deleteJson("/api/v1/templates/{$template['id']}")->assertNoContent();

    // notifications: by ids, all of them, only the mentions; the matrix both ways
    $notes = Notification::factory()->count(3)->forItem($item)->create(['user_id' => $mara->id]);
    Notification::factory()->forItem($item)->kind(NotificationKind::Mentioned, ['source' => 'description'])->create(['user_id' => $mara->id]);
    Notification::factory()->forItem($item)->kind(NotificationKind::StateChanged, ['from' => ['id' => 'a', 'name' => 'A', 'category' => 'backlog'], 'to' => ['id' => 'b', 'name' => 'B', 'category' => 'started']])->create(['user_id' => $mara->id]);
    $this->getJson('/api/v1/notifications?filter[unread]=1&per_page=3')->assertOk()->assertJsonCount(3, 'data');
    $this->postJson('/api/v1/notifications/read', ['ids' => [$notes[0]->id]])->assertOk()->assertJsonPath('updated', 1);
    $this->postJson('/api/v1/notifications/read', ['all' => true, 'mentions_only' => true])->assertOk()->assertJsonPath('updated', 1);
    $this->postJson('/api/v1/notifications/read', ['all' => true])->assertOk();
    $this->postJson('/api/v1/notifications/unread', ['ids' => [$notes[0]->id]])->assertOk()->assertJsonPath('updated', 1);
    $this->deleteJson("/api/v1/notifications/{$notes[1]->id}")->assertNoContent();
    $matrix = $this->getJson('/api/v1/notification-preferences')->assertOk()->json('data');
    $this->putJson('/api/v1/notification-preferences', ['preferences' => [$matrix[0], ['event' => 'comment', 'channel' => 'mail', 'enabled' => true]]])->assertOk();

    // the system: the status, retrying by id and all, the test mail
    DB::table('failed_jobs')->insert(['uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
        'payload' => '{"attempts":2}', 'exception' => 'x', 'failed_at' => now()->utc()]);
    $this->getJson('/api/v1/system')->assertOk();
    $this->postJson('/api/v1/system/failed-jobs/retry', ['ids' => [$uuid]])->assertOk()->assertJsonPath('retried', 1);
    $this->postJson('/api/v1/system/failed-jobs/retry', [])->assertOk();
    ScriptedTransport::use(fn () => null);
    $this->postJson('/api/v1/system/test-mail')->assertOk();

    // webhooks: every key, the echo of the answer, the secret once, the log, ping and again
    $hook = $this->postJson('/api/v1/webhooks', ['name' => 'Agent', 'url' => 'https://receiver.example.com/hook', 'project_id' => $web->id,
        'events' => ['work_item.*', 'page.created'], 'bot_id' => User::defaultBot()->id, 'active' => true])->assertCreated();
    $this->postJson('/api/v1/webhooks', ['name' => 'Alles', 'url' => 'https://receiver.example.com/all', 'project_id' => null, 'events' => ['project.created'], 'bot_id' => null, 'active' => false])->assertCreated();
    expect($hook->json('secret'))->toStartWith('whsec_');
    $this->putJson("/api/v1/webhooks/{$hook->json('data.id')}", $hook->json('data'))->assertOk();
    $this->postJson("/api/v1/webhooks/{$hook->json('data.id')}/rotate-secret")->assertOk();
    $this->postJson("/api/v1/webhooks/{$hook->json('data.id')}/ping")->assertOk();
    $delivery = WebhookDelivery::query()->latest('id')->firstOrFail();
    $this->postJson("/api/v1/webhooks/{$hook->json('data.id')}/deliveries/{$delivery->id}/redeliver")->assertOk();
    $this->getJson("/api/v1/webhooks/{$hook->json('data.id')}/deliveries?filter[kind]=ping&filter[succeeded]=1")->assertOk();
    $this->getJson('/api/v1/webhooks?filter[active]=1')->assertOk();
    $this->deleteJson("/api/v1/webhooks/{$hook->json('data.id')}")->assertNoContent();
    expect(Webhook::query()->count())->toBe(1);

    foreach ($bodies as $key => $keys) {
        [$method, $path] = explode(' ', $key, 2);
        $missing = array_diff($writable($body($method, $path)), Contract::sentKeys($method, $path));

        expect($missing)->toBe([], "{$key} was never sent with: ".implode(', ', $missing));
    }

    expect(Contract::violations())->toBe([]);
});

it('has no empty schema in the documents of these tags', function () use ($tags) {
    expect(array_values(array_filter(
        Contract::emptySchemas(Document::get(), $tags),
        fn (string $place) => preg_match('~/(PageResource|PageNodeResource|PageVersionResource|TemplateResource|TemplateRunResource|TemplateDraftResource|NotificationResource|NotificationPreferenceResource|SystemStatusResource|WebhookResource|WebhookDeliveryResource|Schedule)/~', $place) === 1,
    )))->toBe([]);
});

it('has no body for the operations that take none', function () {
    foreach (['GET /projects/{project}/pages', 'GET /pages/{page}', 'DELETE /pages/{page}', 'GET /pages/{page}/versions', 'GET /pages/{page}/versions/{pageVersion}',
        'POST /pages/{page}/versions/{pageVersion}/restore', 'GET /templates', 'GET /templates/{template}', 'DELETE /templates/{template}', 'GET /templates/{template}/draft',
        'POST /templates/{template}/run', 'GET /templates/{template}/runs', 'GET /notifications', 'DELETE /notifications/{notification}', 'GET /notification-preferences',
        'GET /system', 'POST /system/test-mail', 'GET /webhooks', 'GET /webhooks/{webhook}', 'DELETE /webhooks/{webhook}', 'POST /webhooks/{webhook}/rotate-secret',
        'GET /webhooks/{webhook}/deliveries', 'POST /webhooks/{webhook}/ping', 'POST /webhooks/{webhook}/deliveries/{delivery}/redeliver'] as $key) {
        [$method, $path] = explode(' ', $key, 2);

        expect(array_key_exists('requestBody', Document::operation($method, $path) ?? []))->toBeFalse($key);
    }
});
