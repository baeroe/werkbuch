<?php

namespace App\Http\Controllers\Api;

use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\DraftFromTemplate;
use App\Actions\Templates\GetTemplate;
use App\Actions\Templates\ListTemplateRuns;
use App\Actions\Templates\ListTemplates;
use App\Actions\Templates\PreviewSchedule;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\TemplateDraftResource;
use App\Http\Resources\TemplateResource;
use App\Http\Resources\TemplateRunResource;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\Template;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The templates of the projects. `{template}` is bound by ULID only (any case); saving replaces a template as a whole
 * (`PUT`, A75). The draft and the preview are what the server counts for the editor and the create dialog (A335).
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

    /** The fields of an item made from the template now. */
    public function draft(Request $request, Template $template): TemplateDraftResource
    {
        return new TemplateDraftResource(DraftFromTemplate::run(Actor::fromRequest($request), $template));
    }

    /** „Jetzt ausführen“: 200 with the run, also when it failed (then without an item, A350). */
    public function run(Request $request, Template $template): JsonResponse
    {
        ['run' => $run, 'item' => $item] = RunTemplate::run(Actor::fromRequest($request), $template);

        return response()->json(['data' => [
            'run' => (new TemplateRunResource($run))->resolve($request),
            'item' => $item === null ? null : (new WorkItemResource($item))->resolve($request),
        ]]);
    }

    /** The log of its runs, newest first. */
    public function runs(Request $request, Template $template): JsonResponse
    {
        return ApiList::respond(ListTemplateRuns::run(Actor::fromRequest($request), $template, $request->query()), TemplateRunResource::class);
    }

    /** The next terms of a schedule and a title at the first of them (a reading POST). */
    public function preview(Request $request): JsonResponse
    {
        return response()->json(['data' => PreviewSchedule::run(Actor::fromRequest($request), $request->all())]);
    }
}
