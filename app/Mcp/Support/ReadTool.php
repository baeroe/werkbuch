<?php

namespace App\Mcp\Support;

/**
 * A read tool `<resource>`: the token needs `read` (besides `mcp`). Carries `#[IsReadOnly]` and `#[IsOpenWorld(false)]`
 * itself (attributes are not inherited, K17).
 */
abstract class ReadTool extends WerkbuchTool
{
    final public function ability(): string
    {
        return 'read';
    }
}
