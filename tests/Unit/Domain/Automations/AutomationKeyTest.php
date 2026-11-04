<?php

use App\Domain\Automations\AutomationKey;

it('names the four automations', function () {
    expect(array_map(fn (AutomationKey $key) => $key->value, AutomationKey::cases()))
        ->toBe(['auto_archive', 'auto_close', 'close_parent', 'assign_on_start']);
});

it('has the defaults of the settings', function () {
    expect(AutomationKey::AutoArchive->defaults())->toBe(['days' => 30])
        ->and(AutomationKey::AutoClose->defaults())->toBe(['days' => 90, 'state_id' => null])
        ->and(AutomationKey::CloseParent->defaults())->toBe([])
        ->and(AutomationKey::AssignOnStart->defaults())->toBe([]);
});

it('runs only the automations of the night every day', function () {
    expect(AutomationKey::AutoArchive->daily())->toBeTrue()
        ->and(AutomationKey::AutoClose->daily())->toBeTrue()
        ->and(AutomationKey::CloseParent->daily())->toBeFalse()
        ->and(AutomationKey::AssignOnStart->daily())->toBeFalse();
});

it('bounds the days', function () {
    expect(AutomationKey::MIN_DAYS)->toBe(1)
        ->and(AutomationKey::MAX_DAYS)->toBe(3650);
});
