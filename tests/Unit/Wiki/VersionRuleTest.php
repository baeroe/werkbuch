<?php

use App\Domain\Wiki\VersionRule;

it('keeps a foreign version', function () {
    expect(VersionRule::keepBefore('w', 'other', 1000, 1001, false))->toBeTrue();
});

it('keeps after a pause of ten minutes, not after nine minutes 59', function () {
    expect(VersionRule::keepBefore('w', 'w', 1000, 1600, false))->toBeTrue()
        ->and(VersionRule::keepBefore('w', 'w', 1000, 1599, false))->toBeFalse();
});

it('keeps when asked', function () {
    expect(VersionRule::keepBefore('w', 'w', 1000, 1001, true))->toBeTrue();
});

it('keeps nothing for the same writer within the pause', function () {
    expect(VersionRule::keepBefore('w', 'w', 1000, 1100, false))->toBeFalse();
});
