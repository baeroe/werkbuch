<?php

namespace App\Http\Controllers;

use App\Actions\WorkItems\GetWorkItem;
use App\Support\Actor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The page of an item (`/items/{key}`), found by its key, also one with a former identifier of its project, or by its
 * id. Asked for by a former key, the page moves to the current key with a 301, so old links keep working after a
 * rename (the action says so, this only reads the flag). An item the account does not see is the 404 page, like one
 * that does not exist, also by a former key: never a 301 that would tell the current one. The page gets the key in the
 * spelling the item has and loads the item itself over the API.
 */
final class ItemPageController extends Controller
{
    public function __invoke(Request $request, string $key): Response|RedirectResponse
    {
        $item = GetWorkItem::run(Actor::fromRequest($request), $key);

        if ($item->resolved_by_former_identifier) {
            // permanent for people, never for caches: a rename back (A → B → A) turns the target into a former key
            return redirect()->route('items.show', ['key' => $item->key], 301)->header('Cache-Control', 'no-store, private');
        }

        return Inertia::render('Items/Show', ['itemKey' => $item->key]);
    }
}
