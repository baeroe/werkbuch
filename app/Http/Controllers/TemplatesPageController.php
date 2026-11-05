<?php

namespace App\Http\Controllers;

use App\Actions\Projects\GetProject;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The templates of a project (`/projects/{identifier}/templates`) and one of them (`…/templates/{templateId}`, also the
 * target of the links in the mails of failed runs); the page loads them itself over the API. The project is found by
 * its identifier or a former one: by a former one the address moves to the current identifier with a 301 and the query
 * unchanged; a project the account does not see is the 404 page, like one that does not exist, never a 301 that would
 * tell the current identifier. `templateId` is `new` (the editor of a new template), a ULID in lower case or any other
 * text as it came (the page says it does not exist); without one null.
 */
final class TemplatesPageController extends Controller
{
    public function __invoke(Request $request, string $identifier, ?string $templateId = null): Response|RedirectResponse
    {
        $project = GetProject::run(Actor::fromRequest($request), $identifier);
        $templateId = $templateId !== null && Str::isUlid($templateId) ? strtolower($templateId) : $templateId;

        if ($project->resolved_by_former_identifier) {
            // permanent for people, never for caches: a rename back (A → B → A) turns the target into a former identifier
            $query = $request->getQueryString();

            return redirect()->to(route('projects.templates', ['identifier' => $project->identifier, 'templateId' => $templateId]).($query === null ? '' : "?{$query}"), 301)
                ->header('Cache-Control', 'no-store, private');
        }

        return Inertia::render('Templates/Index', [
            'identifier' => $project->identifier,
            'templateId' => $templateId,
        ]);
    }
}
