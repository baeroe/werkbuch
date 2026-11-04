<?php

use App\Domain\Schedule\Placeholders;

$berlin = new DateTimeZone('Europe/Berlin');

$german = [1 => 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
$english = [1 => 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

$render = fn (string $title, string $at, array $names, ?DateTimeZone $zone = null): string => Placeholders::render($title, new DateTimeImmutable($at), $zone ?? $berlin, $names);

describe('render', function () use ($render, $german, $english) {
    it('fills {month_name} in the language of the organisation and {year}', function () use ($render, $german) {
        expect($render('Monatsbericht {month_name} {year}', '2026-11-02T08:00:00Z', $german))->toBe('Monatsbericht November 2026');
    });

    it('fills {week} with the ISO calendar week', function () use ($render, $german) {
        expect($render('Wartung KW {week}', '2026-10-29T08:00:00Z', $german))->toBe('Wartung KW 44');
    });

    it('fills {date}, {quarter} and {month} and leaves unknown placeholders alone', function () use ($render, $english) {
        expect($render('Bericht {date} Q{quarter}/{month} {foo}', '2026-11-02T08:00:00Z', $english))->toBe('Bericht 2026-11-02 Q4/11 {foo}');
    });

    it('writes month names in German and in English', function () use ($render, $german, $english) {
        expect($render('{month_name}', '2026-03-02T08:00:00Z', $german))->toBe('März')
            ->and($render('{month_name}', '2026-03-02T08:00:00Z', $english))->toBe('March');
    });

    it('pads {month} and {week} to two digits', function () use ($render, $german) {
        // Monday 2026-02-02 is in ISO week 6
        expect($render('{year}-{month} KW {week}', '2026-02-02T08:00:00Z', $german))->toBe('2026-02 KW 06');
    });

    it('numbers the quarters 1 to 4', function () use ($render, $german) {
        $quarters = array_map(fn (string $day): string => $render('{quarter}', "{$day}T10:00:00Z", $german), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);

        expect($quarters)->toBe(['1', '2', '3', '4']);
    });

    it('reads the date in the time zone, not in UTC', function () use ($render, $german) {
        // 23:30 UTC on Halloween is already the next day in Berlin
        expect($render('{date} {month_name}', '2026-10-31T23:30:00Z', $german))->toBe('2026-11-01 November')
            ->and($render('{date} {month_name}', '2026-10-31T23:30:00Z', $german, new DateTimeZone('UTC')))->toBe('2026-10-31 Oktober');
    });

    it('uses the ISO week across the turn of the year', function () use ($render, $german) {
        // Thursday 2026-12-31 and Friday 2027-01-01 still belong to week 53 of 2026
        expect($render('KW {week}', '2026-12-31T10:00:00Z', $german))->toBe('KW 53')
            ->and($render('KW {week}', '2027-01-01T10:00:00Z', $german))->toBe('KW 53')
            ->and($render('KW {week}', '2027-01-04T10:00:00Z', $german))->toBe('KW 01');
    });

    it('replaces every occurrence of a placeholder', function () use ($render, $german) {
        expect($render('{year}/{year}', '2026-11-02T08:00:00Z', $german))->toBe('2026/2026');
    });

    it('leaves text without placeholders, odd braces and inherited names untouched', function () use ($render, $german) {
        $at = '2026-11-02T08:00:00Z';

        expect($render('Nichts zu tun', $at, $german))->toBe('Nichts zu tun')
            ->and($render('{ year } {Year} {year', $at, $german))->toBe('{ year } {Year} {year')
            ->and($render('{constructor} {toString}', $at, $german))->toBe('{constructor} {toString}');
    });

    it('knows the six placeholders of the spec', function () {
        expect(Placeholders::NAMES)->toBe(['date', 'week', 'month', 'month_name', 'quarter', 'year']);
    });
});

describe('longest', function () use ($german, $english) {
    it('{date} counts ten characters', function () use ($german) {
        expect(Placeholders::longest('{date}', $german))->toBe(10);
    });

    it('counts every placeholder with its longest filling', function () use ($german, $english) {
        // week 2, month 2, quarter 1, year 4; the longest month name is September (9) in German and English
        expect(Placeholders::longest('KW {week}/{month} Q{quarter} {year}', $german))->toBe(3 + 2 + 1 + 2 + 2 + 1 + 1 + 4)
            ->and(Placeholders::longest('Monatsbericht {month_name} {year}', $german))->toBe(14 + 9 + 1 + 4)
            ->and(Placeholders::longest('{month_name}', [1 => 'Mai', 'Dezember']))->toBe(8)
            ->and(Placeholders::longest('{month_name}', $english))->toBe(9);
    });

    it('counts characters, not bytes, and unknown placeholders as they stand', function () {
        expect(Placeholders::longest('Prüfung {foo} {month_name}', [1 => 'März']))->toBe(8 + 5 + 1 + 4)
            ->and(Placeholders::longest('Nichts zu tun', []))->toBe(13);
    });
});
