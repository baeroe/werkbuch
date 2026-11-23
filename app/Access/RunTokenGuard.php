<?php

namespace App\Access;

use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Page;
use App\Models\Project;
use App\Models\Template;
use App\Models\View;
use App\Models\WorkItem;
use App\Support\Actor;

/**
 * The hard lock of run tokens (spec 11.2, A477): an agent working through the token of its run may read, write the
 * description and values of an item (its proof), comment, react, upload, add relations and write wiki pages; everything
 * werkbuch keeps to itself (status, type, assignee, archive, restore, delete, watching, removing relations, projects,
 * catalogs, people, tokens, webhooks, automations, templates, views) is a 403 `agent_forbidden`. `Authorize` asks first
 * for every policy (an allow-list of abilities per subject); the actions whose ability allows more than a run token may
 * do call `refuse` themselves.
 */
final class RunTokenGuard
{
    /** Ability → the subjects it is allowed on for a run token (`*`: any). */
    public const ALLOWED = [
        'view' => '*',
        'viewAny' => [View::class, Template::class, Project::class, Page::class],
        'viewMembers' => [Project::class],
        'update' => [WorkItem::class, Page::class, Comment::class],
        'create' => [Comment::class, Page::class],
        'react' => [Comment::class],
        'uploadInline' => [Attachment::class],
    ];

    /** Whether the actor acts through the token of a run. */
    public static function isRunToken(Actor $actor): bool
    {
        return $actor->token?->agent_run_id !== null;
    }

    /**
     * @throws Problem 403 `agent_forbidden` through a run token
     */
    public static function refuse(Actor $actor): void
    {
        if (self::isRunToken($actor)) {
            throw Problem::forbidden(__('problem.detail.agent_forbidden'), 'agent_forbidden');
        }
    }

    /**
     * Whether a run token may ask the policy at all; anybody else always may.
     *
     * @param  array<array-key, mixed>  $arguments  the arguments of the policy; the first names the subject
     */
    public static function permits(Actor $actor, string $ability, array $arguments): bool
    {
        if (! self::isRunToken($actor)) {
            return true;
        }

        $allowed = self::ALLOWED[$ability] ?? [];
        $subject = $arguments[0] ?? null;
        $class = is_object($subject) ? $subject::class : $subject;

        return $allowed === '*' || in_array($class, $allowed, true);
    }
}
