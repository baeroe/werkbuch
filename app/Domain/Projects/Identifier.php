<?php

namespace App\Domain\Projects;

/**
 * The identifier of a project (spec 4.4): 2 to 10 capital letters or digits, starting with a letter; the prefix of the
 * item keys (`WEB-123`). Uniqueness across current and former identifiers is the actions' job.
 */
final class Identifier
{
    public const PATTERN = '/^[A-Z][A-Z0-9]{1,9}\z/';

    /**
     * What a person typed, the way it is stored: without surrounding blanks, in capitals.
     */
    public static function normalize(string $raw): string
    {
        return strtoupper(trim($raw));
    }

    public static function isValid(string $identifier): bool
    {
        return preg_match(self::PATTERN, $identifier) === 1;
    }
}
