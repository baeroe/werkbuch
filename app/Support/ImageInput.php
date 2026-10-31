<?php

namespace App\Support;

use App\Rules\ImageDataUrl;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\MediaCollections\Filesystem;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * Pictures (logo, avatar, project picture) travel as data URLs in the JSON of a PATCH (P15) and live in the media
 * library on the private disk, one file per collection; the API shows them as the URL of `GET /media/{uuid}`.
 */
final class ImageInput
{
    /**
     * The rules of the field. `$current` is the URL of the picture there is: forms send it back unchanged.
     *
     * @return list<mixed>
     */
    public static function rules(?string $current = null): array
    {
        return ['bail', 'nullable', 'string', new ImageDataUrl($current)];
    }

    /**
     * The field messages of the rules that are not ImageDataUrl's own (P9).
     *
     * @return array<string, string>
     */
    public static function messages(string $field): array
    {
        return ["{$field}.string" => __('field.image.invalid')];
    }

    /**
     * The URL of the picture in the collection, or null without one.
     */
    public static function url(HasMedia $model, string $collection): ?string
    {
        $media = $model->getFirstMedia($collection);

        return $media === null ? null : route('media.show', $media->uuid);
    }

    /**
     * Applies a validated value: null removes the picture, a data URL replaces it, the current URL changes nothing.
     * The rows of the old picture go at once (a rollback brings them back), its files only after the commit: a change
     * that fails later in its transaction keeps the old picture whole.
     *
     * @return array{old: string|null, new: string|null}|null what changed, for the `changes` of the event; null if nothing
     */
    public static function apply(Model&HasMedia $model, string $collection, ?string $value, ?string $current): ?array
    {
        if ($value === $current) {
            return null;
        }

        $old = $model->getMedia($collection);
        $old->each(fn (Media $media) => $media->deleteQuietly());
        $model->unsetRelation('media');
        DB::afterCommit(fn () => $old->each(fn (Media $media) => app(Filesystem::class)->removeAllFiles($media)));

        if ($value === null) {
            return ['old' => $current, 'new' => null];
        }

        $extension = str_replace('jpeg', 'jpg', explode(';', substr($value, strlen('data:image/')), 2)[0]);
        $media = $model->addMediaFromBase64($value)->usingFileName("{$collection}.{$extension}")->toMediaCollection($collection);

        return ['old' => $current, 'new' => route('media.show', $media->uuid)];
    }
}
