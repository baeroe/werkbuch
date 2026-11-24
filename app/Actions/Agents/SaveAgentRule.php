<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRule;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\AgentRules;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the working rules of the organization for a kind of run (spec 7.3, layer 2): org admins (`org.manage_catalog`).
 * `body` is required (`null` or an empty text restores the standard); a text that equals a standard (in either
 * language) is kept as no row, so a new standard of a release reaches it (A562). `agent_rules.updated` with the old and
 * the new text of the kind, only when the text a run gets changes.
 */
final class SaveAgentRule
{
    use AsAction;

    public const FIELDS = ['body'];

    public const BODY_MAX = 20_000;

    /**
     * @param  array<array-key, mixed>  $input  `body`
     * @return array{type: RunType, body: string, standard: bool}
     *
     * @throws Problem 403, 404 for a kind that does not exist
     * @throws ValidationException
     */
    public function handle(Actor $actor, string $kind, array $input): array
    {
        Authorize::check($actor, 'manageAgentRules', Organization::class);
        $type = RunType::tryFrom($kind) ?? throw Problem::notFound();

        $valid = Validator::make($input, [
            'body' => ['present', 'nullable', 'string', 'max:'.self::BODY_MAX],
        ], [
            'body.present' => __('field.required'),
            'body' => __('field.body.rules', ['max' => self::BODY_MAX]),
        ])->validate();

        $body = AgentRules::normal((string) ($valid['body'] ?? ''));
        $own = $body !== '' && ! AgentRules::isStandard($type, $body);

        DB::transaction(function () use ($actor, $type, $body, $own): void {
            CatalogLock::take();
            $row = AgentRule::query()->lockForUpdate()->where('type', $type->value)->first();
            $old = $row === null ? AgentRules::standard($type, Locale::default()) : $row->body;
            $new = $own ? $body : AgentRules::standard($type, Locale::default());

            if ($own) {
                ($row ?? new AgentRule(['type' => $type]))->fill(['body' => $body, 'updated_by' => $actor->user->id])->save();
            } else {
                $row?->delete();
            }

            if ($old !== $new || ($row !== null) !== $own) {
                EventRecorder::record(EventType::AgentRulesUpdated, $actor, Organization::current(), null, [
                    $type->value => ['old' => $old, 'new' => $new],
                ], ['standard' => ! $own]);
            }
        }, 3);

        return ['type' => $type, 'body' => AgentRules::text($type), 'standard' => ! $own];
    }
}
