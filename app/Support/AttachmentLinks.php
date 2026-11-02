<?php

namespace App\Support;

use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

/**
 * Gives a saved text its uploads (A232, A233): the images and files the texts name that nobody owns yet, that the
 * writer uploaded into the project, now belong to the owner of the texts. Inside the caller's transaction, after its
 * locks (organization, project, owner): the rows are read `for update`, so a DeleteAttachment of the same upload waits
 * (or the text waits for it) and a text never points to an attachment that went meanwhile. What the rules of saving
 * let through (RichTextRules::usable()) is checked again under that lock; an attachment that is gone or no longer
 * usable is the same 422 `field.rich_text.attachment` at the key that sent the text. Attachments another text of the
 * project owns stay with it.
 */
final class AttachmentLinks
{
    /**
     * @param  array<string, Document>  $texts  the key that sent a text (`description_json`, `values.notes`) → the text
     *
     * @throws ValidationException
     */
    public static function link(Model $owner, Project $project, User $writer, array $texts): void
    {
        $fields = [];
        foreach ($texts as $field => $text) {
            foreach ($text->attachmentIds() as $id) {
                $fields[$id] ??= $field;
            }
        }
        if ($fields === []) {
            return;
        }

        $ids = array_map(strval(...), array_keys($fields));
        $rows = Attachment::query()->whereKey($ids)->lockForUpdate()->get()->keyBy('id');
        $errors = [];
        foreach ($fields as $id => $field) {
            $row = $rows->get($id);
            if ($row === null || ! RichTextRules::usable($row, $project, $writer)) {
                $errors[$field] ??= [__('field.rich_text.attachment')];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        Attachment::query()->whereKey($ids)->whereNull('attachable_id')->where('uploaded_by', $writer->id)->where('project_id', $project->id)
            ->update(['attachable_type' => $owner->getMorphClass(), 'attachable_id' => $owner->getKey()]);
    }
}
