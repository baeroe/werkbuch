<?php

namespace App\Http\Controllers;

use App\Actions\Attachments\UploadAttachment;
use App\Http\Resources\AttachmentResource;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;

/**
 * The upload through an address of MCP (`POST /api/mcp/uploads/{token}`, IssueUploadUrl): curl's form with the file
 * under `file`, its target from the signed query (nothing else of the query counts), the account the one
 * AuthenticateUploadUrl signed in. 201 with the attachment as `POST /api/v1/attachments` answers it; refusals are
 * problems (under /api), the route is no part of the OpenAPI document (not under /api/v1).
 */
final class McpUploadController
{
    public function __invoke(Request $request): JsonResponse
    {
        $file = $request->file('file');

        return (new AttachmentResource(UploadAttachment::run(
            Actor::fromMcp($request),
            Arr::only($request->query(), ['project_id', 'kind', 'work_item_id']),
            $file instanceof UploadedFile ? $file : null,
        )))->response()->setStatusCode(201);
    }
}
