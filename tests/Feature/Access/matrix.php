<?php

use App\Actions\Media\ShowMedia;
use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Events\EventType;
use App\Support\Actor;
use Tests\Feature\Access\MatrixWorld;

/*
 * The rights matrix (RightsMatrixTest): every action × every kind of account. A row names the action, how to run it in
 * the MatrixWorld (with valid input, so an allowed call succeeds), the columns that may run it (`allowed`), the columns
 * that must not even see what it acts on (`hidden`: 404 instead of 403) and the event an allowed call records. Rows with
 * `'system' => true` are work of jobs without REST: they run once as the system and must not fail.
 *
 * Not in the matrix, on purpose:
 * - App\Actions\Auth\*: they run before any sign-in (login, password reset, first admin, invitation), without an actor
 *   whose rights could be checked (A4, P18).
 * - App\Actions\Setup\*: migrations and console commands set up roles and the default bot, nobody acts.
 * - App\Actions\Accounts\NextHandle: a reading helper that finds a free handle for the actions above, without an actor (P24).
 */

$everyone = MatrixWorld::COLUMNS;

return [
    'GetOrganization' => [
        'action' => GetOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetOrganization::run($a),
        'allowed' => $everyone,
    ],
    'UpdateOrganization' => [
        'action' => UpdateOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateOrganization::run($a, ['name' => 'Neu']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::OrganizationUpdated,
    ],
    'ShowMedia' => [
        'action' => ShowMedia::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ShowMedia::run($a, $w->logo),
        'allowed' => $everyone,
    ],
];
