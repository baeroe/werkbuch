<?php

use App\Access\ProjectRole;
use App\Domain\Properties\FieldType;
use App\Http\Middleware\ConvertEmptyStringsToNull;
use App\Http\Middleware\LimitJsonBody;
use App\Http\Middleware\TrustProxies;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Schema;
use App\Rules\ImageDataUrl;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull as FrameworkConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Middleware\TrustProxies as FrameworkTrustProxies;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/*
 * The limit of a JSON body under /api (A388, K8): at most LimitJsonBody::MAX_BYTES, refused with 413 before the app reads
 * the input (TrimStrings, the action). Uploads (multipart) and forms are left to their own limits.
 */

beforeEach(function () {
    Storage::fake('local');
});

/** A body of exactly `$bytes` bytes: a read query `{"q":"x"}`, padded with spaces (still valid JSON). */
$body = fn (int $bytes): string => str_pad('{"q":"x"}', $bytes);

/** Sends `$content` raw, with the headers given as server variables, and tells whether TrimStrings saw the request. */
$send = function (TestCase $test, string $uri, string $content, array $server, ?bool &$reached = null): TestResponse {
    $reached = false;
    TrimStrings::skipWhen(function () use (&$reached) {
        $reached = true;

        return false;
    });

    return $test->actingAs(User::factory()->create())
        ->call('POST', $uri, [], [], [], ['HTTP_ACCEPT' => 'application/json', ...$server], $content);
};

$refused = fn (TestResponse $response) => $response->assertStatus(413)
    ->assertHeader('Content-Type', 'application/problem+json')
    ->assertJsonPath('reason', 'payload_too_large')
    ->assertJsonPath('detail', __('problem.detail.json_too_large', ['max' => 8]));

it('allows 8 MiB', function () {
    expect(LimitJsonBody::MAX_BYTES)->toBe(8 * 1024 * 1024);
});

it('refuses a json body above the limit with 413 before it is read', function () use ($body, $send, $refused) {
    $content = $body(LimitJsonBody::MAX_BYTES + 1);

    $refused($send($this, '/api/v1/work-items/query', $content, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) strlen($content)], $reached));
    expect($reached)->toBeFalse();
});

it('refuses a Content-Length above the limit at once', function () use ($send, $refused) {
    // the header alone is enough: no body has to come
    $refused($send($this, '/api/v1/work-items/query', '{}', ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) (LimitJsonBody::MAX_BYTES + 1)], $reached));
    expect($reached)->toBeFalse();
});

it('refuses MAX + 1 without Content-Length (chunked) and with a Content-Length that lies', function (array $server) use ($body, $send, $refused) {
    $refused($send($this, '/api/v1/work-items/query', $body(LimitJsonBody::MAX_BYTES + 1), ['CONTENT_TYPE' => 'application/json', ...$server], $reached));
    expect($reached)->toBeFalse();
})->with([
    'without' => [[]],
    'a small one' => [['CONTENT_LENGTH' => '9']],
]);

it('refuses text/plain, no type and json with a charset alike', function (array $server) use ($body, $send, $refused) {
    $refused($send($this, '/api/v1/work-items/query', $body(LimitJsonBody::MAX_BYTES + 1), $server, $reached));
    expect($reached)->toBeFalse();
})->with([
    'text/plain' => [['CONTENT_TYPE' => 'text/plain']],
    'json with a charset' => [['CONTENT_TYPE' => 'application/json; charset=utf-8']],
    'json in capitals' => [['CONTENT_TYPE' => 'Application/JSON']],
    'a vendor type' => [['CONTENT_TYPE' => 'application/vnd.api+json']],
]);

it('lets the limit exactly through', function (string $type) use ($body, $send) {
    $content = $body(LimitJsonBody::MAX_BYTES);

    $send($this, '/api/v1/work-items/query', $content, ['CONTENT_TYPE' => $type, 'CONTENT_LENGTH' => (string) strlen($content)], $reached)
        ->assertOk()->assertJsonPath('meta.total', 0);
    expect($reached)->toBeTrue();
})->with(['application/json', 'application/json; charset=utf-8']);

it('lets a multipart upload above the json limit through', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $size = LimitJsonBody::MAX_BYTES + 1024 * 1024;

    // below ATTACHMENTS_MAX_MB (25): the upload has a limit of its own
    $this->actingAs($mara)
        ->withHeaders(['Content-Type' => 'multipart/form-data; boundary=werkbuch', 'Content-Length' => (string) $size])
        ->post('/api/v1/attachments', ['project_id' => 'WEB', 'kind' => 'inline', 'file' => UploadedFile::fake()->create('scan.bin', intdiv($size, 1024))], ['Accept' => 'application/json'])
        ->assertCreated()
        ->assertJsonPath('data.size', $size);
});

it('leaves forms to post_max_size', function () use ($send) {
    $content = 'q='.str_repeat('x', LimitJsonBody::MAX_BYTES);

    $send($this, '/api/v1/work-items/query', $content, ['CONTENT_TYPE' => 'application/x-www-form-urlencoded', 'CONTENT_LENGTH' => (string) strlen($content)], $reached)
        ->assertOk();
    expect($reached)->toBeTrue();
});

it('leaves web routes alone', function () use ($send) {
    $content = (string) json_encode(['email' => str_repeat('a', LimitJsonBody::MAX_BYTES), 'password' => 'x']);

    $response = $send($this, '/broadcasting/batch', $content, ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) strlen($content)], $reached);

    expect($response->status())->not->toBe(413)
        ->and($reached)->toBeTrue();
});

it('lets a logo of ImageDataUrl::MAX_BYTES through as a data URL, and the 422 of a larger one stays reachable', function () {
    $admin = User::factory()->admin()->create();
    // a real PNG padded to the limit: the header decides the type and the size (getimagesizefromstring)
    $png = str_pad((string) base64_decode(explode(',', imageDataUrl())[1]), ImageDataUrl::MAX_BYTES, "\0");

    $this->actingAs($admin)->patchJson('/api/v1/organization', ['logo_url' => 'data:image/png;base64,'.base64_encode($png)])->assertOk();
    $this->actingAs($admin)->patchJson('/api/v1/organization', ['logo_url' => 'data:image/png;base64,'.base64_encode($png."\0")])
        ->assertUnprocessable()->assertJsonPath('errors.logo_url.0', __('field.image.too_large', ['max' => 2]));
});

it('lets an item with a description and four rich text values at Schema::MAX_BYTES, pretty-printed, through', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $mara = memberOf($project, ProjectRole::Member);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    foreach (range(1, 4) as $n) {
        $property = Property::factory()->create(['key' => "notes{$n}", 'label' => "Notizen {$n}", 'field_type' => FieldType::RichText]);
        $task->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => $task->typeProperties()->count()]);
    }
    // a paragraph of umlauts as close to the limit of a text as it gets (compact UTF-8, Schema::MAX_BYTES)
    $text = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => '']]]]];
    $text['content'][0]['content'][0]['text'] = str_repeat('ü', intdiv(Schema::MAX_BYTES - strlen((string) json_encode($text, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)), 2));
    // a client like PHP's json_encode without flags: every umlaut as ü, with the spaces of pretty-printing
    $content = (string) json_encode([
        'project_id' => 'WEB',
        'title' => 'Lange Notizen',
        'description_json' => $text,
        'values' => array_combine(['notes1', 'notes2', 'notes3', 'notes4'], array_fill(0, 4, $text)),
    ], JSON_PRETTY_PRINT);

    expect(strlen((string) json_encode($text, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)))->toBeGreaterThan(Schema::MAX_BYTES - 2)
        ->and(strlen($content))->toBeGreaterThan(3 * 1024 * 1024)->toBeLessThan(LimitJsonBody::MAX_BYTES);

    $this->actingAs($mara)->call('POST', '/api/v1/work-items', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'CONTENT_LENGTH' => (string) strlen($content),
    ], $content)->assertCreated();

    expect(WorkItem::query()->sole()->values()->count())->toBe(4);
});

it('stands after the CORS headers and before the limit of PHP and the trimming of the input', function () {
    $global = app(Kernel::class)->getGlobalMiddleware();
    $at = fn (string $class) => array_search($class, $global, true);

    expect($at(LimitJsonBody::class))->toBeInt()
        ->toBeGreaterThan($at(HandleCors::class))
        ->toBe($at(ValidatePostSize::class) - 1)
        ->toBeLessThan($at(TrimStrings::class));
});

it('keeps Laravel\'s global stack otherwise', function () {
    // bootstrap/app.php names the whole stack to place the limit: a middleware a later Laravel adds must show up here
    $ours = array_map(fn (string $class) => [TrustProxies::class => FrameworkTrustProxies::class, ConvertEmptyStringsToNull::class => FrameworkConvertEmptyStringsToNull::class][$class] ?? $class,
        array_values(array_diff(app(Kernel::class)->getGlobalMiddleware(), [LimitJsonBody::class])));

    $laravel = (new Middleware)->trustHosts()->getGlobalMiddleware();

    // packages and the harness push their own around it (Inertia, RecordContract): Laravel's list is all there, in order
    expect(array_values(array_intersect($ours, $laravel)))->toBe($laravel);
});
