<?php

namespace App\Http\Controllers\Api;

use App\Actions\Automations\ListAutomations;
use App\Actions\Automations\SaveAutomation;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\AutomationResource;
use App\Models\Project;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The four automations of a project (spec 4.13, A346): the list, always four, and switching one by its key (a value of
 * AutomationKey, anything else is a 404).
 */
final class AutomationsController extends Controller
{
    /**
     * List the four automations of a project, also those never saved.
     */
    public function index(Request $request, Project $project): AnonymousResourceCollection
    {
        return AutomationResource::collection(ListAutomations::run(Actor::fromRequest($request), $project));
    }

    /**
     * Switch an automation of a project and set its settings (the admins of the project).
     */
    #[Body(CatalogSchemas::class, 'automation')]
    public function update(Request $request, Project $project, string $key): AutomationResource
    {
        return new AutomationResource(SaveAutomation::run(Actor::fromRequest($request), $project, $key, $request->all()));
    }
}
