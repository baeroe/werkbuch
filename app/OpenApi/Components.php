<?php

namespace App\OpenApi;

use Dedoc\Scramble\Contracts\DocumentTransformer;
use Dedoc\Scramble\OpenApiContext;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\SecurityScheme;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;

/**
 * The shared parts of the document: the schemas of `Schemas` under `components.schemas` and the two ways to sign in
 * under `components.securitySchemes` (`token`, `session`); the operations name them in `security` (`Abilities`). The
 * responses `Problem<status>` come with the operations that use them (`ProblemResponses`).
 */
final class Components implements DocumentTransformer
{
    /** Resource → property → the method of `CatalogSchemas` that writes its schema. */
    private const PATCHES = [
        'PropertyResource' => ['settings' => 'propertySettings', 'default_value' => 'defaultValue'],
        'AutomationResource' => ['settings' => 'automationSettings'],
    ];

    public function handle(OpenApi $document, OpenApiContext $context): void
    {
        $components = $document->components;

        foreach ([
            'Problem' => Schemas::problem(),
            'RichTextDocument' => Schemas::richTextDocument(),
            'ListLinks' => Schemas::listLinks(),
            'ListMeta' => Schemas::listMeta(),
        ] as $name => $schema) {
            $components->addSchema($name, Schema::fromType(new JsonSchema($schema)));
        }

        // the parts of a resource that Scramble cannot read from its code (a cast to an object, a mixed value)
        foreach (self::PATCHES as $name => $properties) {
            $type = ($components->schemas[$name] ?? null)?->type;

            if ($type instanceof ObjectType) {
                foreach ($properties as $property => $method) {
                    $type->addProperty($property, new JsonSchema(CatalogSchemas::{$method}()));
                }
            }
        }

        $components->addSecurityScheme('token', SecurityScheme::http('bearer', '<id>|wb_<secret>')->setDescription(
            'An API token (`Authorization: Bearer <id>|wb_<secret>`), created in the personal settings under “API & MCP”. '
            .'It reads with the ability `read` and writes with `write` (`x-werkbuch-ability` of each operation).'
        ));
        $components->addSecurityScheme('session', SecurityScheme::apiKey('cookie', (string) config('session.cookie'))->setDescription(
            'The session of the web app. Writing requests also send the header `X-XSRF-TOKEN` with the value of the '
            .'cookie `XSRF-TOKEN`; without it they get 419. Some operations take only the session (`x-werkbuch-session-only`).'
        ));
    }
}
