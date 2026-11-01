<?php

namespace App\Http\Controllers;

use App\Actions\Views\GetView;
use App\Exceptions\Problem;
use App\Models\View;
use App\Support\Actor;
use App\Support\Ids;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The items of a saved view (`/views/{viewId}`), the list the page loads itself over the API. The view is found by its
 * id in any spelling; anything else, and a view that is gone, is the 404 page. The page gets the id as it is stored.
 */
final class ViewPageController extends Controller
{
    /**
     * @throws Problem 404
     */
    public function __invoke(Request $request, string $viewId): Response
    {
        $id = Ids::normalize($viewId);
        $view = (is_string($id) && Str::isUlid($id) ? View::query()->find($id) : null) ?? throw Problem::notFound();

        return Inertia::render('Views/Show', ['viewId' => GetView::run(Actor::fromRequest($request), $view)->id]);
    }
}
