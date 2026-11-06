<?php

namespace App\Mcp\Servers;

use Laravel\Mcp\Server;

/**
 * The MCP server of werkbuch at /mcp (spec 6.2), served by laravel/mcp 1.1.1 (routes/ai.php). Stateless Streamable
 * HTTP: the current protocol `2026-07-28` through `server/discover`, the legacy handshake `initialize` with `2025-11-25`,
 * `2025-06-18` and `2025-03-26` (an older version gets `2025-11-25`), as the package answers them.
 *
 * Checked against the installed package (phase 13, task 1): `Laravel\Mcp\Server\Registrar::web`, `Tool::toArray`,
 * `Primitive::eligibleForRegistration`, `Middleware\ValidateMcpHeaders`, `Enums\ProtocolVersion`, `Methods\Initialize`
 * and `Server::boot()` carry the names the plan uses. The capabilities come from the property `$capabilities` of
 * `Laravel\Mcp\Server` (handed to `ServerContext` by `createContext()`); this server sets it without prompts (P4).
 * ValidateMcpHeaders reads the body whatever its `Content-Type` and lets a body without matching headers pass (400 only
 * for a header that contradicts the body), so the refusal of a body that is no JSON (415) stays at the POST route
 * (GuardMcpRequest).
 */
final class WerkbuchServer extends Server
{
    protected string $name = 'werkbuch';

    protected string $instructions = <<<'MARKDOWN'
        werkbuch is a self-hosted project management tool: projects, work items, a wiki per project, views, templates and webhooks.
        MARKDOWN;

    /** Tools and resources, no prompts (P4). */
    protected array $capabilities = [
        self::CAPABILITY_TOOLS => ['listChanged' => false],
        self::CAPABILITY_RESOURCES => ['listChanged' => false],
    ];

    protected array $tools = [];

    protected array $resources = [];

    public int $defaultPaginationLength = 50;

    public int $maxPaginationLength = 50;

    protected function boot(): void
    {
        $this->version = (string) config('werkbuch.version');
    }
}
