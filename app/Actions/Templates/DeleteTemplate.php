<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Template;
use App\Support\Actor;
use App\Support\AttachmentTexts;
use App\Support\CatalogLock;
use App\Support\ItemLock;
use App\Support\MemberInput;
use App\Support\ReadCommitted;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a template (`DELETE /api/v1/templates/{template}`): members and admins of its project (`template.manage`).
 * Under the organization (shared), the project (`for update`; being deleted 404, archived 409, spec 4.4) and the
 * template read afresh (gone meanwhile: 404, no second event), then its pictures and files `for update` (over the morph
 * index, K13): those another text of the project still shows (a description, a value, a comment, a page, another
 * template) go over to that text, the rest go, their files after the commit (AttachmentTexts::handOverOrRemove with the
 * template as `exceptTemplates`, A233, A261); the texts are read as they are now, after the lock on the attachments
 * (ReadCommitted). Items made from the template own copies of its pictures and lose nothing. Its runs go with it; the
 * items it made stay and forget it (`work_items.template_id` null). `template.deleted` with the name in `meta`.
 */
final class DeleteTemplate
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Template $template): void
    {
        Authorize::check($actor, 'update', $template);

        ReadCommitted::run(fn () => DB::transaction(function () use ($actor, $template): void {
            CatalogLock::share();
            $project = MemberInput::lock($template->project);
            ItemLock::refuseArchivedProject($project);
            $locked = Template::query()->lockForUpdate()->find($template->id) ?? throw Problem::notFound();

            $attachments = Attachment::query()->where('attachable_type', $locked->getMorphClass())->where('attachable_id', $locked->id)
                ->orderBy('id')->lockForUpdate()->get();
            if ($attachments->isNotEmpty()) {
                AttachmentTexts::handOverOrRemove($attachments, $project->id, exceptTemplates: [$locked->id]);
            }

            $locked->delete();
            EventRecorder::record(EventType::TemplateDeleted, $actor, $locked, $project, null, ['name' => $locked->name]);
        }, 3));
    }
}
