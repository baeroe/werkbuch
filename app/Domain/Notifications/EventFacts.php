<?php

namespace App\Domain\Notifications;

/**
 * What `Recipients` needs to know about an event of the outbox; the consumer reads it (phase 8, task 5). IDs are the
 * ULIDs of the accounts; who is a person, active and still sees the project, the caller checks afterwards.
 */
final readonly class EventFacts
{
    /**
     * @param  string  $type  the event type, `work_item.updated`
     * @param  list<string>  $changedFields  the fields of the change as `fieldsOf()` reads them
     * @param  list<string>  $mentioned  the people mentioned anew (`meta.mentioned`), only people, without the actor
     * @param  ?string  $assignee  the new assignee of `work_item.assigned` and `work_item.created`, otherwise null
     * @param  list<string>  $watchers  the subscribers of the item without `unsubscribed_at`
     * @param  list<string>  $optedOut  the subscribers of the item with `unsubscribed_at`
     * @param  ?string  $leadId  the lead of the project
     * @param  ?array<string, mixed>  $stateSnapshot  `meta.states` of `work_item.state_changed`
     * @param  ?string  $templateAuthorId  who wrote the template of `template.run_failed` (`meta.author_id`)
     * @param  ?string  $causedBy  the person an automation or a template run acted for (`meta.on_behalf_of`, A342,
     *                             K12): left out like the actor
     */
    public function __construct(
        public string $type,
        public ?string $actorId,
        public ?string $projectId,
        public ?string $itemId,
        public array $changedFields,
        public array $mentioned,
        public ?string $assignee,
        public array $watchers,
        public array $optedOut,
        public ?string $leadId,
        public ?array $stateSnapshot,
        public ?string $templateAuthorId = null,
        public ?string $causedBy = null,
    ) {}

    /**
     * The fields an event changed, in the order of its `changes`: without `rank` (the manual order is no change anyone
     * hears of, A270), `attachment` for `changes.attachments`, `relation` for a relation added or removed.
     *
     * @param  ?array<string, mixed>  $changes
     * @return list<string>
     */
    public static function fieldsOf(string $type, ?array $changes): array
    {
        if (in_array($type, ['work_item.relation_added', 'work_item.relation_removed'], true)) {
            return ['relation'];
        }

        $fields = [];
        foreach (array_keys($changes ?? []) as $field) {
            if ($field !== 'rank') {
                $fields[] = $field === 'attachments' ? 'attachment' : $field;
            }
        }

        return $fields;
    }
}
