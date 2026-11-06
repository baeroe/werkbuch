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
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\TemplateDraftResource;
use App\Http\Resources\TemplateResource;
use App\Http\Resources\TemplateRunResource;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\Template;
use App\OpenApi\OperationsSchemas;
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
    /**
     * List the templates of all projects.
     *
     * Every project the account sees; `filter[project_id]` narrows it to one. `lean=1` leaves the texts out.
     */
    #[ListOf(ListTemplates::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListTemplates::run(Actor::fromRequest($request), null, $request->query()), TemplateResource::class);
    }

    /**
     * List the templates of a project.
     */
    #[ListOf(ListTemplates::class, 'projectSpec')]
    public function projectIndex(Request $request, Project $project): JsonResponse
    {
        return ApiList::respond(ListTemplates::run(Actor::fromRequest($request), $project, $request->query()), TemplateResource::class);
    }

    /**
     * Create a template.
     *
     * 201 `{data: Template}`. Members and admins of the project may write.
     */
    #[Body(OperationsSchemas::class, 'template')]
    public function store(Request $request, Project $project): JsonResponse
    {
        return (new TemplateResource(SaveTemplate::run(Actor::fromRequest($request), $project, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Read a template.
     */
    public function show(Request $request, Template $template): TemplateResource
    {
        return new TemplateResource(GetTemplate::run(Actor::fromRequest($request), $template));
    }

    /**
     * Replace a template.
     *
     * The template as a whole: `name`, `payload` and `schedule` are all required.
     */
    #[Body(OperationsSchemas::class, 'template')]
    public function update(Request $request, Template $template): TemplateResource
    {
        return new TemplateResource(SaveTemplate::run(Actor::fromRequest($request), null, $request->all(), $template));
    }

    /**
     * Delete a template.
     *
     * 204. Items made from it stay; their `template_id` becomes `null`.
     */
    public function destroy(Request $request, Template $template): Response
    {
        DeleteTemplate::run(Actor::fromRequest($request), $template);

        return response()->noContent();
    }

    /**
     * Draft an item from a template.
     *
     * The fields of an item made from the template now, with the placeholders filled and the offsets counted from today. Needs the right to create items.
     */
    public function draft(Request $request, Template $template): TemplateDraftResource
    {
        return new TemplateDraftResource(DraftFromTemplate::run(Actor::fromRequest($request), $template));
    }

    /**
     * Run a template now.
     *
     * 200 with the run, also when it failed (then without an item, A350). A run by hand does not change the counters of the schedule.
     */
    #[Answer(200, OperationsSchemas::class, 'ran', 'The run and its item.')]
    public function run(Request $request, Template $template): JsonResponse
    {
        ['run' => $run, 'item' => $item] = RunTemplate::run(Actor::fromRequest($request), $template);

        return response()->json(['data' => [
            'run' => (new TemplateRunResource($run))->resolve($request),
            'item' => $item === null ? null : (new WorkItemResource($item))->resolve($request),
        ]]);
    }

    /**
     * List the runs of a template.
     *
     * The log of its runs, newest first.
     */
    #[ListOf(ListTemplateRuns::class)]
    public function runs(Request $request, Template $template): JsonResponse
    {
        return ApiList::respond(ListTemplateRuns::run(Actor::fromRequest($request), $template, $request->query()), TemplateRunResource::class);
    }

    /**
     * Preview a schedule.
     *
     * The next terms of a schedule and a title at the first of them (a reading POST; a read token may call it).
     */
    #[Body(OperationsSchemas::class, 'preview')]
    #[Answer(200, OperationsSchemas::class, 'previewed', 'The next terms and the rendered title.')]
    public function preview(Request $request): JsonResponse
    {
        return response()->json(['data' => PreviewSchedule::run(Actor::fromRequest($request), $request->all())]);
    }
}
