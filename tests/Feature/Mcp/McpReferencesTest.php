<?php

use App\Domain\Filter\CoreField;
use App\Domain\Filter\Op;
use App\Domain\Properties\FieldType;
use App\Models\User;
use Illuminate\Support\Facades\Exceptions;
use Tests\Support\Mcp\McpClient;
use Tests\TestCase;

/*
 * The references of the MCP server (phase 13, task 11; K10): the filter, markdown and field type sections of the English
 * docs, read at run time between the marks `<!-- reference:start -->` and `<!-- reference:end -->`, served as resources.
 */

const REFERENCE_URIS = ['werkbuch://reference/filters', 'werkbuch://reference/markdown', 'werkbuch://reference/field-types'];

/** The text of a reference as the server reads it. */
$text = function (TestCase $test, string $uri): string {
    $plain = apiToken(User::factory()->create(), ['mcp']);
    $result = McpClient::for($test, $plain)->read($uri);

    expect($result['contents'])->toHaveCount(1)
        ->and($result['contents'][0]['uri'])->toBe($uri)
        ->and($result['contents'][0]['mimeType'])->toBe('text/markdown');

    return $result['contents'][0]['text'];
};

it('lists the three references for a token with only mcp', function () {
    $resources = McpClient::for($this, apiToken(User::factory()->create(), ['mcp']))->resources();

    expect(array_column($resources, 'uri'))->toBe(REFERENCE_URIS);
    foreach ($resources as $resource) {
        expect($resource['mimeType'])->toBe('text/markdown')
            ->and($resource['title'])->not->toBe('')
            ->and($resource['description'])->not->toBe('');
    }
});

it('reads the filter reference from the english docs', function () use ($text) {
    $reference = $text($this, 'werkbuch://reference/filters');

    foreach (Op::cases() as $op) {
        expect($reference)->toContain('`'.$op->value.'`');
    }
    foreach (CoreField::cases() as $field) {
        expect($reference)->toContain('`'.$field->value.'`');
    }
    expect($reference)->toContain('"version": 1')
        ->and($reference)->not->toContain('reference:start')
        ->and($reference)->not->toContain('State in the address');
});

it('reads the markdown reference', function () use ($text) {
    $reference = $text($this, 'werkbuch://reference/markdown');

    expect($reference)->toContain('@handle', 'page:', 'attachment:', 'WEB-123', 'Writing over REST')
        ->and($reference)->not->toContain('reference:end');
});

it('reads the field types', function () use ($text) {
    $reference = $text($this, 'werkbuch://reference/field-types');

    foreach (FieldType::cases() as $type) {
        expect($reference)->toContain('`'.$type->value.'`');
    }
    expect($reference)->not->toContain('Required values and defaults');
});

it('says when a page or its marks are missing', function (string $uri, string $page, ?string $content) {
    Exceptions::fake();
    $root = sys_get_temp_dir().'/werkbuch-docs-'.bin2hex(random_bytes(4));
    mkdir($root.'/en/concepts', 0777, true);
    if ($content !== null) {
        file_put_contents($root.'/en/'.$page, $content);
    }
    config(['werkbuch.docs_path' => $root]);

    $response = McpClient::for($this, apiToken(User::factory()->create(), ['mcp']))->rpc('resources/read', ['uri' => $uri]);

    $response->assertStatus(500)->assertJsonPath('error.code', -32603);
    expect($response->json('error.message'))->toBe("503 reference_missing: {$page} lacks its reference marks");
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === "{$page} lacks its reference marks");

    array_map('unlink', glob($root.'/en/concepts/*') ?: []);
    rmdir($root.'/en/concepts');
    rmdir($root.'/en');
    rmdir($root);
})->with([
    'no page' => ['werkbuch://reference/filters', 'concepts/views.md', null],
    'no start mark' => ['werkbuch://reference/markdown', 'concepts/rich-text.md', "text\n<!-- reference:end -->\n"],
    'no end mark' => ['werkbuch://reference/field-types', 'concepts/types-and-properties.md', "<!-- reference:start -->\ntext\n"],
]);
