<?php

use App\Access\ProjectRole;
use App\Actions\Attachments\UploadAttachment;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Comments\EditComment;
use App\Actions\Comments\RemoveReaction;
use App\Actions\RichText\ListMentionables;
use App\Actions\RichText\ResolveReferences;
use App\Actions\Search\QuerySearch;
use App\Actions\Views\ListViews;
use App\Domain\Emoji;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\OpenApi\ContentDocs;
use App\Search\SearchIndexer;
use App\Support\AttachmentTexts;
use App\Support\ViewInput;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;
use Tests\Support\RichTextFixtures as F;

/*
 * The content of work items in the document (Phase 12, Task 11): comments and reactions, attachments, rich text
 * (mentions, references), the search and the views. What Scramble cannot read from the actions the controllers say
 * with `#[Body]`, `#[Answer]` and `ContentDocs`; this file holds that against the code:
 *  (a) every operation, its success status and its tag are the ones the server answers,
 *  (b) the resources say what they hold (reactions, owner and addresses of an attachment, the filter and display of a
 *      view, key_match), the answers that are no `{data: Resource}`,
 *  (c) the keys of a body and of a query are the ones the server reads (`FIELDS`, `KEYS`); every body is open, because
 *      no action refuses unknown keys (K2); the upload is `multipart/form-data`,
 *  (d) a client can send every key the document names (a full request per operation, `Contract::sentKeys`, K15),
 *  (e) the descriptions say what the server does: the limit of an upload, where the file is, how to react.
 * The answers themselves are held against the document by the contract of every test.
 */

beforeEach(function () {
    Storage::fake('local');
});

$tags = ['Comments', 'Attachments', 'RichText', 'Search', 'Views'];

$body = fn (string $method, string $path, string $type = 'application/json'): array => Document::operation($method, $path)['requestBody']['content'][$type]['schema'] ?? [];
$answer = fn (string $method, string $path, int $status): array => Document::operation($method, $path)['responses'][(string) $status]['content']['application/json']['schema'] ?? [];
$schema = fn (string $name): array => Document::get()['components']['schemas'][$name];

/** The operations of these tags: `"<METHOD> <path>" => success status`. */
$operations = [
    'GET /work-items/{item}/comments' => 200, 'POST /work-items/{item}/comments' => 201, 'GET /comments/{comment}' => 200,
    'PATCH /comments/{comment}' => 200, 'DELETE /comments/{comment}' => 204,
    'PUT /comments/{comment}/reactions' => 200, 'DELETE /comments/{comment}/reactions' => 200,
    'POST /attachments' => 201, 'GET /attachments/{attachment}' => 200, 'DELETE /attachments/{attachment}' => 204,
    'GET /mentions' => 200, 'GET /references' => 200, 'GET /search' => 200,
    'GET /views' => 200, 'POST /views' => 201, 'GET /views/{view}' => 200, 'PUT /views/{view}' => 200, 'DELETE /views/{view}' => 204,
];

it('documents the success status the server answers for every operation of the content', function () use ($operations, $tags) {
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
        'POST /work-items/{item}/comments' => 'CommentResource', 'GET /comments/{comment}' => 'CommentResource', 'PATCH /comments/{comment}' => 'CommentResource',
        'PUT /comments/{comment}/reactions' => 'CommentResource', 'DELETE /comments/{comment}/reactions' => 'CommentResource',
        'POST /attachments' => 'AttachmentResource', 'GET /attachments/{attachment}' => 'AttachmentResource',
        'GET /search' => 'SearchResultsResource', 'POST /views' => 'ViewResource', 'GET /views/{view}' => 'ViewResource', 'PUT /views/{view}' => 'ViewResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);

        expect(basename((string) ($answer($method, $path, $operations[$key])['properties']['data']['$ref'] ?? '')))->toBe($resource, $key);
    }

    foreach ([
        'GET /work-items/{item}/comments' => 'CommentResource', 'GET /mentions' => 'UserResource', 'GET /views' => 'ViewResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);

        expect(basename((string) ($answer($method, $path, 200)['properties']['data']['items']['$ref'] ?? '')))->toBe($resource, $key);
    }
});

it('describes a comment with its reactions and its text in both forms', function () use ($schema) {
    $comment = $schema('CommentResource');
    $properties = $comment['properties'];
    $reaction = $properties['reactions']['items'];

    expect($comment['required'])->toBe(['id', 'work_item_id', 'author_id', 'body', 'body_json', 'created_at', 'edited_at', 'reactions'])
        ->and($properties['body_json']['$ref'])->toBe('#/components/schemas/RichTextDocument')
        ->and($reaction['required'])->toBe(['emoji', 'user_ids'])
        ->and($reaction['properties']['user_ids']['items']['type'])->toBe('string')
        ->and($properties['created_at']['format'])->toBe('date-time')
        ->and($properties['edited_at']['type'])->toBe(['string', 'null'])
        ->and($properties['edited_at']['format'])->toBe('date-time');
});

it('describes an attachment with its owner and addresses that are relative', function () use ($schema) {
    $attachment = $schema('AttachmentResource')['properties'];

    expect($attachment['owner']['type'])->toBe(['object', 'null'])
        ->and($attachment['owner']['description'])->toContain('template')
        ->and($attachment['owner']['required'])->toBe(['type', 'id'])
        ->and($attachment['owner']['properties']['type']['enum'])->toBe(AttachmentTexts::OWNERS)
        ->and($attachment['kind']['enum'])->toBe(Attachment::KINDS)
        ->and($attachment['url']['format'])->toBe('uri-reference')
        ->and($attachment['preview_url']['format'])->toBe('uri-reference')
        ->and($attachment['preview_url']['type'])->toBe(['string', 'null'])
        ->and($attachment['url']['description'])->toContain('?download=1')
        ->and($attachment['size']['minimum'])->toBe(0);
});

it('describes a view with the filter and the display the server stores', function () use ($schema) {
    $view = $schema('ViewResource')['properties'];

    expect($view['filter']['$ref'])->toBe('#/components/schemas/Filter')
        ->and($view['display']['$ref'])->toBe('#/components/schemas/Display')
        ->and($view['created_at']['format'])->toBe('date-time')
        ->and($view['updated_at']['format'])->toBe('date-time')
        ->and($schema('SearchResultsResource')['properties']['key_match']['type'])->toBe(['string', 'null'])
        ->and($schema('SearchResultsResource')['properties']['views']['items']['$ref'])->toBe('#/components/schemas/ViewResource')
        // the text of a page reached from the search and the references is no empty schema (the rest of PageResource is Task 12's)
        ->and($schema('PageResource')['properties']['content_json']['anyOf'])->toBe([['$ref' => '#/components/schemas/RichTextDocument'], ['type' => 'null']])
        ->and(array_values(array_filter(
            Contract::emptySchemas(Document::get(), ['Comments', 'Attachments', 'RichText', 'Search', 'Views']),
            fn (string $place) => preg_match('~/(CommentResource|AttachmentResource|ViewResource|SearchResultsResource|PageResource|Filter|Display|SortSpec)/~', $place) === 1,
        )))->toBe([]);
});

it('describes the references as lean items and pages', function () use ($answer) {
    $data = $answer('GET', '/references', 200)['properties']['data'];

    expect($data['required'])->toBe(['items', 'pages'])
        ->and($data['properties']['items']['items']['$ref'])->toBe('#/components/schemas/WorkItemResource')
        ->and($data['properties']['pages']['items']['$ref'])->toBe('#/components/schemas/PageResource')
        ->and($data['description'])->toContain('left out');
});

/** Per operation with a body: the keys the server reads, the required ones, the media type. No action refuses other keys. */
$bodies = [
    'POST /work-items/{item}/comments' => [AddComment::FIELDS, 'application/json'],
    'PATCH /comments/{comment}' => [EditComment::FIELDS, 'application/json'],
    'PUT /comments/{comment}/reactions' => [AddReaction::FIELDS, 'application/json'],
    'DELETE /comments/{comment}/reactions' => [RemoveReaction::FIELDS, 'application/json'],
    'POST /attachments' => [UploadAttachment::FIELDS, 'multipart/form-data'],
    'POST /views' => [ViewInput::FIELDS, 'application/json'],
    'PUT /views/{view}' => [ViewInput::FIELDS, 'application/json'],
];

it('documents the keys the server reads and keeps every body open', function () use ($bodies, $body) {
    foreach ($bodies as $key => [$keys, $type]) {
        [$method, $path] = explode(' ', $key, 2);
        $schema = $body($method, $path, $type);
        $content = array_keys(Document::operation($method, $path)['requestBody']['content']);

        expect($content)->toBe([$type], $key)
            ->and(array_keys(array_filter($schema['properties'], fn (array $property) => ! ($property['readOnly'] ?? false))))->toEqualCanonicalizing($keys, $key)
            // K2: no action refuses a key it does not know, so none of these bodies is closed
            ->and($schema['x-werkbuch-open'])->toBeTrue($key);
    }
});

it('says what a body requires', function () use ($body) {
    $comment = $body('POST', '/work-items/{item}/comments');

    // exactly one of the two texts: both is 422 `field.rich_text.both`, none 422 at `body`
    expect($comment)->not->toHaveKey('required')
        ->and($comment['oneOf'])->toBe([['required' => ['body']], ['required' => ['body_json']]])
        ->and($body('PATCH', '/comments/{comment}')['oneOf'])->toBe($comment['oneOf'])
        ->and(Document::operation('POST', '/work-items/{item}/comments')['requestBody']['required'])->toBeTrue()
        // the emoji of a PUT and of a DELETE may come as the query `?emoji=`, so the body is optional there
        ->and($body('PUT', '/comments/{comment}/reactions'))->not->toHaveKey('required')
        ->and($body('DELETE', '/comments/{comment}/reactions'))->not->toHaveKey('required')
        ->and($body('POST', '/attachments', 'multipart/form-data')['required'])->toBe(['project_id', 'kind', 'file'])
        ->and($body('POST', '/views')['required'])->toBe(ViewInput::FIELDS)
        ->and($body('PUT', '/views/{view}')['required'])->toBe(ViewInput::FIELDS)
        ->and($body('POST', '/views')['properties']['filter']['$ref'])->toBe('#/components/schemas/Filter')
        ->and($body('POST', '/views')['properties']['display']['$ref'])->toBe('#/components/schemas/Display')
        ->and($body('POST', '/views')['properties']['name']['maxLength'])->toBe(ViewInput::NAME_MAX)
        ->and($body('POST', '/views')['properties']['icon']['anyOf'][0]['enum'])->toBe(ViewInput::ICONS)
        ->and($body('PUT', '/comments/{comment}/reactions')['properties']['emoji']['maxLength'])->toBe(Emoji::MAX_BYTES);
});

it('takes the keys of its own answer back in the body of a view as read-only (A75, K2)', function () use ($body) {
    foreach ([['POST', '/views'], ['PUT', '/views/{view}']] as [$method, $path]) {
        $properties = $body($method, $path)['properties'];

        foreach (['id', 'created_by', 'created_at', 'updated_at'] as $key) {
            expect($properties[$key]['readOnly'])->toBeTrue("{$method} {$key}")
                ->and($properties[$key]['description'])->toContain('sent back, ignored');
        }
        expect($body($method, $path)['x-werkbuch-open'])->toBeTrue()
            ->and($body($method, $path)['required'])->toBe(ViewInput::FIELDS);
    }
});

it('documents the upload as a multipart body with the file as binary and the limit of the server', function () use ($body) {
    $upload = $body('POST', '/attachments', 'multipart/form-data');
    $operation = Document::operation('POST', '/attachments');

    expect($upload['properties']['file']['type'])->toBe('string')
        ->and($upload['properties']['file']['format'])->toBe('binary')
        ->and($upload['properties']['kind']['enum'])->toBe(Attachment::KINDS)
        ->and($upload['description'])->toContain('413 `payload_too_large`')
        ->and($upload['description'])->toContain(Attachment::maxMegabytes().' MB')
        ->and($operation['requestBody']['required'])->toBeTrue()
        ->and(array_key_exists('413', $operation['responses']))->toBeTrue()
        ->and($operation['description'])->toContain('multipart/form-data');
});

it('says where the file of an attachment is and that a read token reaches it', function () {
    $show = Document::operation('GET', '/attachments/{attachment}')['description'];

    expect($show)->toContain('/attachments/{id}')
        ->and($show)->toContain('?download=1')
        ->and($show)->toContain('bearer token with `read`')
        ->and($show)->toContain('outside `/api/v1`');
});

it('documents the query of the search, the mentions and the references with their limits', function () {
    $params = fn (string $path) => collect(Document::operation('GET', $path)['parameters'])->keyBy('name');
    $search = $params('/search');
    $mentions = $params('/mentions');
    $references = $params('/references');

    expect($search->keys()->all())->toEqualCanonicalizing(QuerySearch::KEYS)
        ->and($search['q']['required'])->toBeTrue()
        ->and($search['q']['schema']['maxLength'])->toBe(QuerySearch::Q_MAX)
        ->and($search['types']['schema']['items']['enum'])->toBe(QuerySearch::TYPES)
        ->and($search['types']['explode'])->toBeFalse()
        ->and($search['limit']['schema']['maximum'])->toBe(QuerySearch::MAX_LIMIT)
        ->and($search['limit']['schema']['default'])->toBe(QuerySearch::DEFAULT_LIMIT)
        ->and($search['include_archived']['schema']['enum'])->toBe([1, 0])
        ->and($mentions->keys()->all())->toEqualCanonicalizing(ListMentionables::KEYS)
        ->and($mentions['project']['required'])->toBeTrue()
        ->and($mentions['q']['schema']['maxLength'])->toBe(ListMentionables::Q_MAX)
        ->and($mentions['limit']['schema']['maximum'])->toBe(ListMentionables::MAX_LIMIT)
        ->and($references->keys()->all())->toEqualCanonicalizing(ResolveReferences::KEYS)
        ->and($references['items']['schema']['items']['pattern'])->toBe('^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$')
        ->and($references['items']['description'])->toContain((string) ResolveReferences::MAX_ITEMS)
        ->and($references['pages']['explode'])->toBeFalse();

    foreach (['PUT', 'DELETE'] as $method) {
        $emoji = collect(Document::operation($method, '/comments/{comment}/reactions')['parameters'])->firstWhere('name', 'emoji');
        expect($emoji['in'])->toBe('query', $method);
    }

    $views = collect(Document::operation('GET', '/views')['parameters'])->pluck('name')->all();
    expect($views)->toEqualCanonicalizing(['cursor', 'per_page', 'sort', ...array_map(fn ($filter) => "filter[{$filter->name}]", array_values(ListViews::spec()->filters))]);
});

it('gives the query parameters the document shows', function () {
    foreach (['/search' => ContentDocs::searchParameters(), '/mentions' => ContentDocs::mentionsParameters()] as $path => $given) {
        $shown = collect(Document::operation('GET', $path)['parameters'])->keyBy('name');

        expect(array_keys($given))->toEqualCanonicalizing($shown->keys()->all(), $path);
        foreach ($given as $name => $parameter) {
            expect($parameter['schema'])->toBe($shown[$name]['schema'], "{$path} {$name}")
                ->and($parameter['description'])->toBe($shown[$name]['description'], "{$path} {$name}")
                ->and($parameter['required'])->toBe($shown[$name]['required'] ?? false, "{$path} {$name}");
        }
    }
});

it('lets a client send and read everything the document names', function () use ($bodies, $body) {
    $mara = User::factory()->create(['name' => 'Mara Kontakt', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['name' => 'Kontakt Website', 'lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular prüfen']);
    $page = Page::factory()->for($web)->withText('Kontaktformular')->create(['title' => 'Support']);
    searchEngine();
    app(SearchIndexer::class)->rebuild();
    $this->actingAs($mara, 'web');

    // comments: the text in both forms, edited in both forms
    $first = $this->postJson("/api/v1/work-items/{$item->key}/comments", ['body' => 'Danke @mara!'])->assertCreated()->json('data');
    $this->postJson("/api/v1/work-items/{$item->key}/comments", ['body_json' => F::doc(F::p('Zwei'))])->assertCreated();
    $this->patchJson("/api/v1/comments/{$first['id']}", ['body' => 'Anders'])->assertOk();
    $this->patchJson("/api/v1/comments/{$first['id']}", ['body_json' => F::doc(F::p('Noch anders'))])->assertOk();
    $this->putJson("/api/v1/comments/{$first['id']}/reactions", ['emoji' => '👍'])->assertOk()->assertJsonPath('data.reactions.0.user_ids', [$mara->id]);
    $this->deleteJson("/api/v1/comments/{$first['id']}/reactions", ['emoji' => '👍'])->assertOk()->assertJsonPath('data.reactions', []);
    $this->putJson("/api/v1/comments/{$first['id']}/reactions", ['emoji' => '🎉'])->assertOk();
    $this->deleteJson("/api/v1/comments/{$first['id']}/reactions?emoji=".urlencode('🎉'))->assertOk()->assertJsonPath('data.reactions', []);
    $this->getJson("/api/v1/work-items/{$item->key}/comments")->assertOk()->assertJsonCount(2, 'data');

    // the upload of both kinds, as a multipart form
    $png = fn () => UploadedFile::fake()->createWithContent('skizze.png', (string) base64_decode(explode(',', imageDataUrl())[1]));
    $inline = $this->post('/api/v1/attachments', ['project_id' => $web->identifier, 'kind' => 'inline', 'file' => $png()], ['Accept' => 'application/json'])->assertCreated()->json('data');
    $file = $this->post('/api/v1/attachments', ['project_id' => $web->id, 'kind' => 'file', 'work_item_id' => $item->key, 'file' => $png()], ['Accept' => 'application/json'])->assertCreated()->json('data');
    $this->getJson("/api/v1/attachments/{$inline['id']}")->assertOk()->assertJsonPath('data.owner', null);
    $this->getJson("/api/v1/attachments/{$file['id']}")->assertOk()->assertJsonPath('data.owner.type', 'work_item');
    $this->deleteJson("/api/v1/attachments/{$inline['id']}")->assertNoContent();

    // views: created and replaced with an icon name and with an emoji
    $input = fn (string $icon) => [
        'name' => 'Offen', 'icon' => $icon,
        'filter' => ['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'in', 'value' => ['urgent', 'high']]]],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ];
    $view = $this->postJson('/api/v1/views', $input('list-todo'))->assertCreated()->json('data');
    $this->putJson("/api/v1/views/{$view['id']}", $input('🔥'))->assertOk()->assertJsonPath('data.icon', '🔥');
    $this->getJson('/api/v1/views?filter[name]=Off&sort=-created_at&per_page=5')->assertOk()->assertJsonCount(1, 'data');

    // the reads with every parameter
    $this->getJson('/api/v1/search?q=kontakt&types=items,pages,projects,people,views&limit=5&include_archived=1')->assertOk()->assertJsonPath('data.items.0.id', $item->id);
    $this->getJson('/api/v1/search?q='.$item->key)->assertOk()->assertJsonPath('data.key_match', $item->id);
    $this->getJson("/api/v1/mentions?project={$web->identifier}&q=mar&limit=3")->assertOk()->assertJsonPath('data.0.id', $mara->id);
    $this->getJson("/api/v1/references?items={$item->id}&pages={$page->id}")->assertOk()->assertJsonPath('data.items.0.id', $item->id)->assertJsonPath('data.pages.0.id', $page->id);

    foreach ($bodies as $key => [$keys, $type]) {
        if ($type !== 'application/json') {
            continue;
        }
        [$method, $path] = explode(' ', $key, 2);
        $writable = array_keys(array_filter($body($method, $path)['properties'], fn (array $property) => ! ($property['readOnly'] ?? false)));
        $missing = array_diff($writable, Contract::sentKeys($method, $path));

        expect($missing)->toBe([], "{$key} was never sent with: ".implode(', ', $missing));
    }

    expect(Contract::violations())->toBe([]);
});

it('keeps the contract for a comment, an attachment and a view with null in every nullable field', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create();
    $comment = Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id]);
    $view = View::factory()->create(['created_by' => $mara->id]);
    $this->actingAs($mara, 'web');

    // never edited, no reaction, no owner and no preview: every nullable field is null or empty
    $this->getJson("/api/v1/comments/{$comment->id}")->assertOk()->assertJsonPath('data.edited_at', null)->assertJsonPath('data.reactions', []);
    $this->getJson("/api/v1/views/{$view->id}")->assertOk();
    $this->getJson("/api/v1/search?q={$item->key}&types=items")->assertOk();
    $this->getJson('/api/v1/mentions?project='.$web->identifier)->assertOk();

    expect(Contract::violations())->toBe([]);
});

it('has no body for the operations that take none', function () {
    foreach (['GET /work-items/{item}/comments', 'GET /comments/{comment}', 'DELETE /comments/{comment}', 'GET /attachments/{attachment}',
        'DELETE /attachments/{attachment}', 'GET /mentions', 'GET /references', 'GET /search', 'GET /views', 'GET /views/{view}', 'DELETE /views/{view}'] as $key) {
        [$method, $path] = explode(' ', $key, 2);

        expect(array_key_exists('requestBody', Document::operation($method, $path) ?? []))->toBeFalse($key);
    }
});
