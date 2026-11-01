<?php

namespace App\Http\Middleware;

use App\Access\Visibility;
use App\Models\User;
use App\Models\WorkItem;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\Response;

/**
 * Old links keep working after a project was renamed (P20): a read (`GET`, `HEAD`) of an item asked for by a former
 * key moves with a 301 to the same address with the current key, the query kept. Only for an item the reader sees: for
 * everybody else the action answers 404, so a former key reveals nothing. Writes act on the item without a detour.
 * Permanent for people, never for caches (`no-store`): a rename back (A → B → A) turns the target into a former key.
 * It runs on the routes with `{item}` after the binding (routes/api.php).
 */
final class RedirectFormerItemKey
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $route = $request->route();
        $item = $route instanceof Route ? $route->parameter('item') : null;
        $user = $request->user();

        if (! in_array($request->getMethod(), ['GET', 'HEAD'], true) || ! $item instanceof WorkItem
            || ! $item->resolved_by_former_identifier || ! $user instanceof User || Visibility::roleIn($user, $item->project) === null) {
            return $next($request);
        }

        $url = URL::toRoute($route, ['item' => $item->key] + $route->originalParameters(), true);
        $query = $request->server->getString('QUERY_STRING');

        return redirect()->to($query === '' ? $url : "{$url}?{$query}", 301)->header('Cache-Control', 'no-store, private');
    }
}
