<?php

namespace App\Mcp\Servers;

use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureMcpToken;
use App\Http\Middleware\GuardMcpRequest;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\ThrottleApi;
use App\Mcp\Tools\AttachmentsTool;
use App\Mcp\Tools\AutomationsTool;
use App\Mcp\Tools\CommentsTool;
use App\Mcp\Tools\GetUploadUrlTool;
use App\Mcp\Tools\ManageAttachmentsTool;
use App\Mcp\Tools\ManageAutomationsTool;
use App\Mcp\Tools\ManageCommentsTool;
use App\Mcp\Tools\ManageOrganizationTool;
use App\Mcp\Tools\ManagePagesTool;
use App\Mcp\Tools\ManagePeopleTool;
use App\Mcp\Tools\ManageProjectsTool;
use App\Mcp\Tools\ManageRelationsTool;
use App\Mcp\Tools\ManageTemplatesTool;
use App\Mcp\Tools\ManageViewsTool;
use App\Mcp\Tools\ManageWorkItemsTool;
use App\Mcp\Tools\OrganizationTool;
use App\Mcp\Tools\PagesTool;
use App\Mcp\Tools\PeopleTool;
use App\Mcp\Tools\ProjectsTool;
use App\Mcp\Tools\RelationsTool;
use App\Mcp\Tools\SearchTool;
use App\Mcp\Tools\TemplatesTool;
use App\Mcp\Tools\ViewsTool;
use App\Mcp\Tools\WhoamiTool;
use App\Mcp\Tools\WorkItemsTool;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;
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
    /**
     * The door in front of the package's middleware (K1): the throttle `mcp` before everything, then the language of the
     * account, a bearer token, an active account and a personal access token with `mcp`.
     */
    public const DOOR = [ThrottleApi::class.':mcp', SetLocale::class.':'.SetLocale::API, 'auth:sanctum', EnsureAccountIsActive::class, EnsureMcpToken::class];

    protected string $name = 'werkbuch';

    protected string $instructions = <<<'MARKDOWN'
        werkbuch is a self-hosted project management tool: projects, work items, a wiki per project, views, templates and webhooks.
        MARKDOWN;

    /** Tools and resources, no prompts (P4). */
    protected array $capabilities = [
        self::CAPABILITY_TOOLS => ['listChanged' => false],
        self::CAPABILITY_RESOURCES => ['listChanged' => false],
    ];

    protected array $tools = [
        WhoamiTool::class,
        SearchTool::class,
        GetUploadUrlTool::class,
        OrganizationTool::class,
        ManageOrganizationTool::class,
        PeopleTool::class,
        ManagePeopleTool::class,
        ProjectsTool::class,
        ManageProjectsTool::class,
        AutomationsTool::class,
        ManageAutomationsTool::class,
        WorkItemsTool::class,
        ManageWorkItemsTool::class,
        RelationsTool::class,
        ManageRelationsTool::class,
        CommentsTool::class,
        ManageCommentsTool::class,
        AttachmentsTool::class,
        ManageAttachmentsTool::class,
        PagesTool::class,
        ManagePagesTool::class,
        TemplatesTool::class,
        ManageTemplatesTool::class,
        ViewsTool::class,
        ManageViewsTool::class,
    ];

    protected array $resources = [];

    public int $defaultPaginationLength = 50;

    public int $maxPaginationLength = 50;

    /**
     * Serves an MCP server at `$path` behind the door: this one at /mcp (routes/ai.php), a test server at `mcp/_t`. The
     * door is a group around the route, so it runs before the package's middleware; GuardMcpRequest (a foreign Origin,
     * a body that is no JSON) hangs on the POST route alone, GET and DELETE answer 405.
     *
     * @param  class-string<Server>  $server
     */
    public static function serve(string $path, string $server = self::class): void
    {
        Route::middleware(self::DOOR)->group(fn () => Mcp::web($path, $server)->middleware(GuardMcpRequest::class));
    }

    protected function boot(): void
    {
        $this->version = (string) config('werkbuch.version');
    }
}
