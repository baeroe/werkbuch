<?php

namespace App\Actions\Views;

use App\Access\Authorize;
use App\Domain\Filter\Filter;
use App\Domain\Views\Display;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\View;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\ViewInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a view (every account with `view.create`, the actor is its creator) or replaces one as a whole (its creator
 * or org admins, `view.manage_any`; A75). A change reads the row afresh under `lockForUpdate`, so it waits for a
 * deletion or another change running at the same time and compares with what that one left; only what really changes
 * is written and recorded, the same input again writes nothing and keeps `updated_at`. The creator stays.
 */
final class SaveView
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `name`, `icon`, `filter`, `display`
     *
     * @throws ValidationException
     * @throws Problem 403, or 404 for a view deleted meanwhile
     */
    public function handle(Actor $actor, array $input, ?View $view = null): View
    {
        if ($view === null) {
            Authorize::check($actor, 'create', View::class);
            $valid = ViewInput::validate($input);

            return DB::transaction(function () use ($actor, $valid): View {
                $created = View::query()->create([...self::columns($valid), 'created_by' => $actor->user->id]);
                EventRecorder::record(EventType::ViewCreated, $actor, $created, null, [
                    'name' => ['old' => null, 'new' => $created->name],
                ]);

                return $created;
            });
        }

        return DB::transaction(function () use ($actor, $input, $view): View {
            $current = View::query()->lockForUpdate()->find($view->id) ?? throw Problem::notFound();
            Authorize::check($actor, 'update', $current);

            $valid = ViewInput::validate($input);
            $changes = CatalogInput::changes(self::snapshot($current), self::columns($valid));

            if ($changes !== []) {
                $current->fill(self::columns($valid))->save();
                EventRecorder::record(EventType::ViewUpdated, $actor, $current, null, $changes);
            }

            return $current;
        });
    }

    /**
     * The columns of a valid input, the filter and display in their normal form.
     *
     * @param  array{name: string, icon: string, filter: Filter, display: Display}  $valid
     * @return array{name: string, icon: string, filter: array<string, mixed>, display: array<string, mixed>}
     */
    private static function columns(array $valid): array
    {
        return [
            'name' => $valid['name'],
            'icon' => $valid['icon'],
            'filter' => $valid['filter']->toArray(),
            'display' => $valid['display']->toArray(),
        ];
    }

    /**
     * What an event compares: the stored columns.
     *
     * @return array{name: string, icon: string, filter: array<string, mixed>, display: array<string, mixed>}
     */
    private static function snapshot(View $view): array
    {
        return ['name' => $view->name, 'icon' => $view->icon, 'filter' => $view->filter, 'display' => $view->display];
    }
}
