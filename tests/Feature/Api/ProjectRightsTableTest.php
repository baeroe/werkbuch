<?php

use App\Access\ProjectRole;
use App\Models\User;
use App\Models\Workflow;
use Tests\Feature\Access\MatrixWorld;

/*
 * "Behaves like the tables of spec 4.3", through REST: every kind of account against the public project WEB and the
 * private project OPS with the calls on a project. Each case runs in its own world, as the calls change it (archive,
 * delete, join).
 */

/** The calls: name => [method, path after the project, body for the call]. */
const RIGHTS_CALLS = [
    'GET project' => ['GET', '', []],
    'GET members' => ['GET', '/members', []],
    'PATCH project' => ['PATCH', '', ['name' => 'Neu']],
    'POST members' => ['POST', '/members', 'new person'],
    'POST join' => ['POST', '/join', []],
    'POST archive' => ['POST', '/archive', []],
    'PUT workflow' => ['PUT', '/workflow', 'new workflow'],
    'DELETE project' => ['DELETE', '', []],
    'PATCH member' => ['PATCH', '/members/{member}', ['role' => 'viewer']],
    'DELETE member' => ['DELETE', '/members/{member}', []],
    'POST restore' => ['POST', '/restore', 'archived first'],
];

/**
 * The status per call (in the order of RIGHTS_CALLS) for each account against the public and the private project. The
 * accounts are members of both, except the org admin and the outsider. Not seeing a project is always a 404, never a 403.
 */
function rightsTable(): array
{
    $admin = [200, 200, 200, 201, 201, 200, 200, 202, 200, 204, 200];
    $member = [200, 200, 403, 403, 409, 403, 403, 403, 403, 403, 403];

    return [
        // org admin without a membership: admin rights everywhere, joining makes them a member
        'org admin' => ['org_admin', 'web' => $admin, 'ops' => $admin],
        'project admin' => ['project_admin', 'web' => [200, 200, 200, 201, 409, 200, 200, 202, 200, 204, 200], 'ops' => [200, 200, 200, 201, 409, 200, 200, 202, 200, 204, 200]],
        'project member' => ['project_member', 'web' => $member, 'ops' => $member],
        'project viewer' => ['project_viewer', 'web' => $member, 'ops' => $member],
        // not a member: a public project is read as a viewer and joined with one click, a private one does not exist
        'outsider' => ['outsider_public', 'web' => [200, 200, 403, 403, 201, 403, 403, 403, 403, 403, 403], 'ops' => array_fill(0, 11, 404)],
    ];
}

$cases = [];

foreach (rightsTable() as $label => $row) {
    foreach (['web', 'ops'] as $which) {
        foreach (array_keys(RIGHTS_CALLS) as $index => $call) {
            $cases["{$label} × ".strtoupper($which)." × {$call}"] = [$row[0], $which, $call, $row[$which][$index]];
        }
    }
}

it('answers each call as the tables of spec 4.3 say', function (string $column, string $which, string $call, int $status) {
    $w = MatrixWorld::build();
    $project = $which === 'web' ? $w->web : $w->ops;
    [$method, $path, $body] = RIGHTS_CALLS[$call];

    // the person a call adds is somebody new, and so is the workflow a project switches to; the member a call changes
    // or removes is a member of this project only; a project to restore is archived first
    if ($body === 'archived first') {
        $project->update(['archived_at' => now()]);
    }
    $body = match ($body) {
        'new person' => ['user_id' => User::factory()->create()->id, 'role' => 'member'],
        'new workflow' => ['workflow_id' => Workflow::factory()->create()->id, 'mapping' => []],
        'archived first' => [],
        default => $body,
    };
    if (str_contains($path, '{member}')) {
        $path = str_replace('{member}', memberOf($project, ProjectRole::Member)->id, $path);
    }

    $this->actingAs($w->account($column))->json($method, "/api/v1/projects/{$project->identifier}{$path}", $body)
        ->assertStatus($status);
})->with($cases);

it('lets every account of the organization create a project', function (string $column) {
    $w = MatrixWorld::build();

    $this->actingAs($w->account($column))->postJson('/api/v1/projects', ['name' => 'Neu', 'identifier' => 'NEU', 'visibility' => 'private'])
        ->assertCreated()->assertJsonPath('data.my_role', 'admin');
})->with(['org_admin', 'project_admin', 'project_member', 'project_viewer', 'outsider_public', 'outsider_private']);

it('gives the lead no rights of their own', function () {
    $w = MatrixWorld::build();
    $lead = $w->account('project_member');
    $w->web->update(['lead_id' => $lead->id]);
    $other = memberOf($w->web, ProjectRole::Viewer);
    $this->actingAs($lead);

    // leading a project reads it as its role does, and manages nothing a member does not
    $this->getJson('/api/v1/projects/WEB')->assertOk()->assertJsonPath('data.lead_id', $lead->id)->assertJsonPath('data.my_role', 'member');
    $this->patchJson('/api/v1/projects/WEB', ['name' => 'Neu'])->assertForbidden();
    $this->postJson('/api/v1/projects/WEB/archive')->assertForbidden();
    $this->patchJson("/api/v1/projects/WEB/members/{$other->id}", ['role' => 'admin'])->assertForbidden();
    $this->deleteJson("/api/v1/projects/WEB/members/{$other->id}")->assertForbidden();
    $this->deleteJson('/api/v1/projects/WEB')->assertForbidden();
});
