<?php

namespace App\Mcp\Support;

/**
 * A write tool `manage-<resource>` (and `get-upload-url`): the token needs `write` (besides `mcp`). Carries
 * `#[IsDestructive]`, `#[IsReadOnly(false)]` and, but for `manage-webhooks`, `#[IsOpenWorld(false)]` itself (attributes
 * are not inherited, K17).
 */
abstract class WriteTool extends WerkbuchTool
{
    final public function ability(): string
    {
        return 'write';
    }
}
