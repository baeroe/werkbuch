<?php

namespace App\Domain\Notifications;

/**
 * Who hears of an event and as what (spec 4.14, phase plan 8 "Empfängerregel"):
 * - `mentioned`: the people mentioned anew in `work_item.created|updated` and `comment.created|updated`.
 * - `assigned`: only the new assignee of `work_item.assigned` and `work_item.created` (A268).
 * - `comment`, `state_changed`, `item_changed`: the watchers of `comment.created`, `work_item.state_changed`,
 *   `work_item.updated` (with a field other than the rank), `work_item.assigned` (all but the new assignee) and
 *   `work_item.relation_added|removed`.
 * - `item_created`: only the lead, for `work_item.created`.
 * - `template_run_failed`: only the lead and the author of the template, for `template.run_failed` (phase 10).
 * The lead watches every item of the project unless they unsubscribed from it (A269); whoever unsubscribed only hears
 * of mentions and assignments (A113). The actor never hears of their own event, nor does the person an automation or a
 * template run acted for (`causedBy`, A342, K12). Every other event tells nobody (A270),
 * `comment.updated` only the people mentioned anew.
 */
final class Recipients
{
    private const MENTIONING = ['work_item.created', 'work_item.updated', 'comment.created', 'comment.updated'];

    /**
     * One recipient per person with all their kinds by rank, sorted by the ID of the person; who and as what the caller
     * still checks against access, the kind of account and the preferences (A267).
     *
     * @return list<Recipient>
     */
    public static function of(EventFacts $facts): array
    {
        /** @var array<string, list<NotificationKind>> $kinds */
        $kinds = [];
        $add = function (NotificationKind $kind, array $people) use (&$kinds, $facts): void {
            foreach ($people as $person) {
                if ($person !== $facts->actorId && $person !== $facts->causedBy && ! in_array($kind, $kinds[$person] ?? [], true)) {
                    $kinds[$person][] = $kind;
                }
            }
        };

        if (in_array($facts->type, self::MENTIONING, true)) {
            $add(NotificationKind::Mentioned, $facts->mentioned);
        }

        $watchers = self::watchers($facts);
        $assignee = $facts->assignee === null ? [] : [$facts->assignee];
        $changed = array_values(array_diff($facts->changedFields, ['rank'])) !== [];

        switch ($facts->type) {
            case 'comment.created':
                $add(NotificationKind::Comment, $watchers);
                break;
            case 'work_item.created':
                $add(NotificationKind::Assigned, $assignee);
                $add(NotificationKind::ItemCreated, array_values(array_intersect($watchers, [$facts->leadId])));
                break;
            case 'work_item.assigned':
                $add(NotificationKind::Assigned, $assignee);
                $add(NotificationKind::ItemChanged, array_values(array_diff($watchers, $assignee)));
                break;
            case 'work_item.updated':
                $add(NotificationKind::ItemChanged, $changed ? $watchers : []);
                break;
            case 'work_item.state_changed':
                $add(NotificationKind::StateChanged, $watchers);
                break;
            case 'work_item.relation_added':
            case 'work_item.relation_removed':
                $add(NotificationKind::ItemChanged, $watchers);
                break;
            case 'template.run_failed':
                $add(NotificationKind::TemplateRunFailed, array_values(array_filter([$facts->leadId, $facts->templateAuthorId], 'is_string')));
                break;
        }

        ksort($kinds, SORT_STRING);
        $recipients = [];
        foreach ($kinds as $person => $theirs) {
            usort($theirs, fn (NotificationKind $a, NotificationKind $b) => $a->rank() <=> $b->rank());
            $recipients[] = new Recipient((string) $person, $theirs);
        }

        return $recipients;
    }

    /**
     * The watchers and the lead, each once, without everyone who unsubscribed.
     *
     * @return list<string>
     */
    private static function watchers(EventFacts $facts): array
    {
        $watchers = $facts->leadId === null ? $facts->watchers : [...$facts->watchers, $facts->leadId];

        return array_values(array_diff(array_unique($watchers), $facts->optedOut));
    }
}
