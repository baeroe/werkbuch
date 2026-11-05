<?php

use App\Access\Authorize;
use App\Models\Organization;
use App\Models\User;
use Tests\Feature\Access\MatrixWorld;

// Who manages webhooks (spec 4.3): accounts with `org.manage`, the org admins and the default bot over a token; everybody
// else gets 403 with the sentence, never 404: the section is there for everybody, as the system page (K14).

it('lets org admins and the default bot manage webhooks', function () {
    $world = MatrixWorld::build();

    foreach (MatrixWorld::COLUMNS as $column) {
        $account = $world->account($column);
        $allowed = in_array($column, ['org_admin', 'default_bot'], true);

        expect(Authorize::allows(actor($account), 'manageWebhooks', Organization::class))
            ->toBe($allowed, "column {$column}");
    }
});

it('refuses members, other bots and deactivated admins with 403 and the sentence', function () {
    foreach ([
        User::factory()->create(),
        User::factory()->bot()->create(),
        User::factory()->admin()->disabled()->create(),
    ] as $account) {
        expect(refusal($account, 'manageWebhooks', Organization::class))
            ->status->toBe(403)
            ->detail->toBe(__('problem.detail.webhooks_admins_only'));
    }
});
