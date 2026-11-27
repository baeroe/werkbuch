<?php

namespace App\Http\Resources;

use App\Domain\Agents\Contract;
use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Support\AgentRules;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The working rules of the organization for a kind of run (spec 7.3, 10.5): the text, whether it is the standard, and
 * the contract of the kind as it goes into the prompt (read only), and the standard in the language of the organization,
 * which the settings show when someone restores it (A620).
 */
final class AgentRuleResource extends JsonResource
{
    /**
     * @return array{type: string, body: string, standard: bool, contract: string, standard_body: string}
     */
    public function toArray(Request $request): array
    {
        /** @var array{type: RunType, body: string, standard: bool} $rule */
        $rule = $this->resource;

        return ['type' => $rule['type']->value, 'body' => $rule['body'], 'standard' => $rule['standard'], 'contract' => Contract::for($rule['type'], Locale::default()->value), 'standard_body' => AgentRules::standard($rule['type'], Locale::default())];
    }
}
