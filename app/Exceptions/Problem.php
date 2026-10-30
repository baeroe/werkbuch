<?php

namespace App\Exceptions;

use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * A refusal the API explains: rendered as application/problem+json on /api (App\Http\Api\ProblemResponse).
 * It is an HttpExceptionInterface, so a web route answers with its status instead of a 500.
 */
final class Problem extends RuntimeException implements HttpExceptionInterface
{
    /** @var list<string> */
    public const REASONS = [
        'transition_not_allowed', 'not_closed', 'not_archived', 'archived', 'project_archived', 'forbidden', 'not_found',
        'validation_failed', 'description_conflict', 'page_conflict', 'parent_not_epic', 'epic_has_no_parent', 'last_admin',
        'in_use', 'unauthenticated', 'too_many_requests', 'bad_request', 'method_not_allowed', 'payload_too_large',
        'csrf_token_mismatch', 'conflict', 'server_error', 'service_unavailable', 'http_error',
    ];

    /**
     * @param  array<string, list<string>>  $errors  messages per field path
     * @param  array<string, mixed>  $extensions  extra members of the problem body
     */
    public function __construct(
        public readonly int $status,
        public readonly string $reason,
        public readonly ?string $detail = null,
        public readonly array $errors = [],
        public readonly array $extensions = [],
    ) {
        parent::__construct($detail ?? $reason);
    }

    public static function forbidden(?string $detail = null): self
    {
        return new self(403, 'forbidden', $detail);
    }

    /** A 404 never carries a detail, so nothing leaks about resources the caller must not see. */
    public static function notFound(): self
    {
        return new self(404, 'not_found');
    }

    /** @param  array<string, mixed>  $extensions */
    public static function conflict(string $reason, array $extensions = []): self
    {
        return new self(409, $reason, extensions: $extensions);
    }

    /** @param  array<string, list<string>>  $errors */
    public static function invalid(array $errors): self
    {
        return new self(422, 'validation_failed', errors: $errors);
    }

    public static function locked(string $reason): self
    {
        return new self(409, $reason);
    }

    public function getStatusCode(): int
    {
        return $this->status;
    }

    /** @return array<string, string> */
    public function getHeaders(): array
    {
        return [];
    }
}
