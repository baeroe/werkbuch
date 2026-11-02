<?php

namespace App\Http\Controllers;

use App\Actions\Projects\GetProject;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The items of a project (`/projects/{identifier}`), the list the page loads itself over the API. The project is found
 * by its identifier or a former one; asked for by a former one, the page moves to the current identifier with a 301
 * and the query unchanged (the state of the list lives there: `?layout=board`), so old links keep working after a
 * rename (P32: the action says so, this only reads the flag). A project the account does not see is the 404 page, like
 * one that does not exist, also by a former identifier: never a 301 that would tell the current one.
 */
final class ProjectItemsPageController extends Controller
{
    public function __invoke(Request $request, string $identifier): Response|RedirectResponse
    {
        $project = GetProject::run(Actor::fromRequest($request), $identifier);

        if ($project->resolved_by_former_identifier) {
            // permanent for people, never for caches: a rename back (A → B → A) turns the target into a former identifier
            $query = $request->getQueryString();

            return redirect()->to(route('projects.show', ['identifier' => $project->identifier]).($query === null ? '' : "?{$query}"), 301)
                ->header('Cache-Control', 'no-store, private');
        }

        return Inertia::render('Projects/Show', ['identifier' => $project->identifier]);
    }
}
