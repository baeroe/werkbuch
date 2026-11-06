<?php

namespace Tests\Support;

use App\Webhooks\Resolver;

/**
 * DNS for tests (plan "Global Constraints"): the names of the map resolve to their addresses, every other name to
 * nothing. It remembers which names were asked, in order.
 */
final class FakeResolver implements Resolver
{
    /** @var list<string> */
    private array $asked = [];

    /**
     * @param  array<string, list<string>>  $map  host → addresses
     */
    public function __construct(private readonly array $map) {}

    public function addresses(string $host): array
    {
        $this->asked[] = $host;

        return $this->map[$host] ?? [];
    }

    /**
     * The names asked so far.
     *
     * @return list<string>
     */
    public function asked(): array
    {
        return $this->asked;
    }
}
