<?php

namespace App\Http\Controllers;

use App\Actions\Projects\GetProject;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The settings of a project, one address per section (`/projects/{identifier}/settings/{section?}`, General without a
 * section). The project is found by its identifier or a former one; asked for by a former one, the page moves to the
 * current identifier with a 301, so old links keep working after a rename (P32: the action says so, this only reads the
 * flag). A project the account does not see is the 404 page, like one that does not exist. Which sections there are
 * is the page's business: an unknown one says so and keeps the list.
 */
final class ProjectSettingsPageController extends Controller
{
    public function __invoke(Request $request, string $identifier, ?string $section = null): Response|RedirectResponse
    {
        $project = GetProject::run(Actor::fromRequest($request), $identifier);

        if ($project->resolved_by_former_identifier) {
            // permanent for people, never for caches: a rename back (A → B → A) turns the target into a former identifier
            return redirect()->route('projects.settings', ['identifier' => $project->identifier, 'section' => $section], 301)
                ->header('Cache-Control', 'no-store, private');
        }

        return Inertia::render('Projects/Settings', ['identifier' => $project->identifier, 'section' => $section ?? 'general']);
    }
}
