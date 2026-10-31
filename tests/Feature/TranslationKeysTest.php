<?php

it('finds literal keys in code', function () {
    expect(translationKeysIn("t('a.b'); tn('c.d', 2); __('auth.failed'); @lang('mail.layout.regards'); t(`dyn.\${x}`); t(name)"))
        ->toBe(['a.b', 'c.d.one', 'c.d.other', 'auth.failed', 'mail.layout.regards']);
});

it('skips calls that only look like translations', function () {
    expect(translationKeysIn("format('a.b'); \$this->t('a.b'); Foo::t('a.b'); \$t('a.b'); __(\"x.{\$y}\"); trans(\$key)"))->toBe([]);
});

it('defines every key used in code', function () {
    $used = usedTranslationKeys();

    expect($used)->not->toBeEmpty();

    [$groups, $json] = $used->partition(fn (string $key) => preg_match('/^(auth|passwords|validation|pagination)\./', $key) === 1);

    expect($json->diff(langKeys('en'))->values()->all())->toBe([])
        ->and($groups->filter(fn (string $key) => trans($key, [], 'en') === $key || trans($key, [], 'de') === $key)->values()->all())->toBe([]);
});

it('finds the texts of the shipped catalog, which the migration names in the language of the organization', function () {
    // a typo there would ship the raw key as a workflow name, and only in that language
    $builtIn = collect(langKeys('en'))->filter(fn (string $key) => str_starts_with($key, 'catalog.builtin.'))->values();

    expect($builtIn)->toHaveCount(15)
        ->and($builtIn->diff(usedTranslationKeys())->values()->all())->toBe([]);
});
