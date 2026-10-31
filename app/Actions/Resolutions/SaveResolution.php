<?php

namespace App\Actions\Resolutions;

use App\Access\Authorize;
use App\Domain\Workflow\StateCategory;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Resolution;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a resolution or replaces one as a whole (P24): a label, the category it is the default for and the archive
 * stamp (org admins). Each category (Completed, Canceled) has exactly one default at all times (P20): a new default takes
 * the mark from the old one, which gets its own `resolution.updated`; no change may leave a category without one, and a
 * default is never archived. `position` is never taken from the input: a new resolution goes last. Archiving stamps the
 * time itself; a resolution archived already keeps its stamp (P25). Runs under the catalog lock, so the label and the
 * defaults are checked against what the change before left. Only what really changes is written and recorded.
 */
final class SaveResolution
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `label`, `default_for`, `archived_at`
     *
     * @throws ValidationException
     * @throws Problem 404 for a resolution deleted meanwhile
     */
    public function handle(Actor $actor, ?Resolution $resolution, array $input): Resolution
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Resolutions);

        $input = CatalogInput::blankArchive(CatalogInput::trim($input, ['label', 'default_for']));

        // no default is `null`; an action called directly may send the blank text REST would have made `null`
        if (($input['default_for'] ?? null) === '') {
            $input['default_for'] = null;
        }

        return DB::transaction(function () use ($actor, $resolution, $input): Resolution {
            CatalogLock::take();

            $current = $resolution === null ? null : Resolution::query()->find($resolution->id) ?? throw Problem::notFound();

            /** @var array{label: string, default_for?: ?string, archived_at?: ?string} $valid */
            $valid = Validator::make($input, [
                'label' => CatalogInput::name('resolutions', $current, 'label'),
                'default_for' => ['nullable', 'string', Rule::in([StateCategory::Completed->value, StateCategory::Canceled->value])],
                'archived_at' => CatalogInput::archivedAt(),
            ], [
                ...CatalogInput::messages(),
                'default_for.string' => __('field.default_for.unknown'),
                'default_for.in' => __('field.default_for.unknown'),
            ])->validate();

            $default = $valid['default_for'] ?? null;
            $archived = ($valid['archived_at'] ?? null) !== null;

            if ($default !== null && $archived) {
                throw ValidationException::withMessages(['archived_at' => __('field.archived_at.default')]);
            }

            // another resolution cannot take the mark over within this change: it stays where it is
            if ($current?->default_for !== null && $current->default_for !== $default) {
                throw ValidationException::withMessages(['default_for' => __('field.default_for.last')]);
            }

            // the mark is unique, so the old default lets go before the new one takes it
            if ($default !== null && $default !== $current?->default_for) {
                $old = Resolution::query()->where('default_for', $default)->first();

                if ($old !== null) {
                    $old->update(['default_for' => null]);
                    EventRecorder::record(EventType::ResolutionUpdated, $actor, $old, null, ['default_for' => ['old' => $default, 'new' => null]]);
                }
            }

            $before = $current === null ? null : self::snapshot($current);

            $saved = $current ?? new Resolution(['position' => self::nextPosition()]);
            $saved->fill([
                'label' => $valid['label'],
                'default_for' => $default,
                'archived_at' => CatalogInput::archivedStamp($saved->archived_at, $archived),
            ])->save();

            if ($before === null) {
                EventRecorder::record(EventType::ResolutionCreated, $actor, $saved, null, ['label' => ['old' => null, 'new' => $saved->label]]);

                return $saved;
            }

            $changes = [];

            foreach (self::snapshot($saved) as $field => $new) {
                if ($before[$field] !== $new) {
                    $changes[$field] = ['old' => $before[$field], 'new' => $new];
                }
            }

            if ($changes !== []) {
                EventRecorder::record(EventType::ResolutionUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /** One behind the last resolution (the first one gets 0). */
    private static function nextPosition(): int
    {
        $last = Resolution::query()->max('position');

        return $last === null ? 0 : (int) $last + 1;
    }

    /**
     * What an event compares.
     *
     * @return array{label: string, default_for: ?string, archived_at: ?string}
     */
    private static function snapshot(Resolution $resolution): array
    {
        return [
            'label' => $resolution->label,
            'default_for' => $resolution->default_for,
            'archived_at' => $resolution->archived_at?->toJSON(),
        ];
    }
}
