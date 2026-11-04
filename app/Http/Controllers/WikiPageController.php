<?php

namespace App\Http\Controllers;

use App\Access\Authorize;
use App\Actions\Projects\GetProject;
use App\Models\Page;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The wiki of a project (`/projects/{identifier}/wiki`) and one of its pages (`…/wiki/{pageId}`, also the target of the
 * links in mails, A316); the page loads tree and text itself over the API (A322). The project is found by its
 * identifier or a former one: by a former one the address moves to the current identifier with a 301 and the query
 * unchanged; a project the account does not see is the 404 page, like one that does not exist, never a 301 that would
 * tell the current identifier. A page of another project the account sees moves to that project's wiki the same way.
 * A page that is no page for the account (no ULID, unknown, of a project it does not see or one being deleted) is
 * never the 404 page: the wiki shows the tree and says the page does not exist (`pageFound` false, the browser does not
 * ask for it). `pageFound` is false without a page as well; `pageId` is the stored ULID, any other text as it came.
 */
final class WikiPageController extends Controller
{
    public function __invoke(Request $request, string $identifier, ?string $pageId = null): Response|RedirectResponse
    {
        $actor = Actor::fromRequest($request);
        $project = GetProject::run($actor, $identifier);

        if ($project->resolved_by_former_identifier) {
            return self::moved($request, $project->identifier, $pageId);
        }

        $ulid = $pageId !== null && Str::isUlid($pageId) ? strtolower($pageId) : null;
        $page = $ulid === null ? null : Page::query()->with('project')->find($ulid);
        $found = $page !== null && Authorize::allows($actor, 'view', $page);

        if ($found && $page->project_id !== $project->id) {
            return self::moved($request, $page->project->identifier, $page->id);
        }

        return Inertia::render('Wiki/Show', [
            'identifier' => $project->identifier,
            'pageId' => $ulid ?? $pageId,
            'pageFound' => $found,
        ]);
    }

    /** Permanent for people, never for caches: a rename back (A → B → A) turns the target into a former identifier. */
    private static function moved(Request $request, string $identifier, ?string $pageId): RedirectResponse
    {
        $query = $request->getQueryString();

        return redirect()->to(route('projects.wiki', ['identifier' => $identifier, 'pageId' => $pageId]).($query === null ? '' : "?{$query}"), 301)
            ->header('Cache-Control', 'no-store, private');
    }
}
