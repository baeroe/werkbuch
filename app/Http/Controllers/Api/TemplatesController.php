<?php

namespace App\Http\Controllers\Api;

use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\GetTemplate;
use App\Actions\Templates\ListTemplates;
use App\Actions\Templates\SaveTemplate;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\TemplateResource;
use App\Models\Project;
use App\Models\Template;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The templates of the projects. `{template}` is bound by ULID only (any case); saving replaces a template as a whole
 * (`PUT`, A75).
 */
final class TemplatesController extends Controller
{
    /** Every project the account sees, or the one `?project=` names. */
    public function index(Request $request): JsonResponse
    {
        $project = $request->query('project');

        return ApiList::respond(ListTemplates::run(Actor::fromRequest($request), is_string($project) && $project !== '' ? $project : null, $request->query()), TemplateResource::class);
    }

    public function projectIndex(Request $request, Project $project): JsonResponse
    {
        return ApiList::respond(ListTemplates::run(Actor::fromRequest($request), $project, $request->query()), TemplateResource::class);
    }

    /** 201: the new template was just created. */
    public function store(Request $request, Project $project): TemplateResource
    {
        return new TemplateResource(SaveTemplate::run(Actor::fromRequest($request), $project, $request->all()));
    }

    public function show(Request $request, Template $template): TemplateResource
    {
        return new TemplateResource(GetTemplate::run(Actor::fromRequest($request), $template));
    }

    public function update(Request $request, Template $template): TemplateResource
    {
        return new TemplateResource(SaveTemplate::run(Actor::fromRequest($request), null, $request->all(), $template));
    }

    /** 204. */
    public function destroy(Request $request, Template $template): Response
    {
        DeleteTemplate::run(Actor::fromRequest($request), $template);

        return response()->noContent();
    }
}
