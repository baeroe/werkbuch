<?php

namespace Database\Factories;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Ranking\Rank;
use App\Models\Page;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use App\RichText\Document;
use App\RichText\MarkdownContext;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A page at the top of the wiki of a new project, without text, in version 1, created and last saved by the first member
 * of the project, ranked after its last sibling. No events, no versions (those are the work of App\Actions\Pages).
 *
 * @extends Factory<Page>
 */
class PageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'title' => rtrim(fake()->sentence(3), '.'),
            'version' => 1,
            'created_by' => fn (array $attributes) => self::member($attributes['project_id']),
            'updated_by' => fn (array $attributes) => $attributes['created_by'],
        ];
    }

    /**
     * The rank after the highest of its siblings, unless given. A batch (`count(n)`) is made before any of it is
     * stored, so the ranks it gave are kept per row of siblings here (as WorkItemFactory does per project).
     */
    public function configure(): static
    {
        /** @var array<string, string> $given the highest rank per row of siblings made by this factory */
        $given = [];

        return $this->afterMaking(function (Page $page) use (&$given) {
            $row = $page->project_id.'|'.($page->parent_id ?? '');

            if ($page->getAttribute('rank') === null) {
                $stored = Page::query()->where('project_id', $page->project_id)->where('parent_id', $page->parent_id)->max('rank');
                $page->rank = Rank::between(self::higher(is_string($stored) ? $stored : null, $given[$row] ?? null), null);
            }

            $given[$row] = self::higher($page->rank, $given[$row] ?? null) ?? $page->rank;
        });
    }

    /** A child of the page, in its project. */
    public function childOf(Page $parent): static
    {
        return $this->state(fn (array $attributes) => ['project_id' => $parent->project_id, 'parent_id' => $parent->id]);
    }

    /** With the Markdown as content (read without a project: mentions and references stay text). */
    public function withText(string $markdown): static
    {
        $text = Document::fromMarkdown($markdown, new MarkdownContext);

        return $this->state(fn (array $attributes) => ['content' => $text->toJson(), 'content_text' => $text->toText()]);
    }

    /** The higher of two ranks, byte by byte (as `ascii_bin` compares them). */
    private static function higher(?string $a, ?string $b): ?string
    {
        return $a === null || ($b !== null && strcmp($b, $a) > 0) ? $b : $a;
    }

    /** The first member of the project; a new person as a member when it has none. */
    private static function member(mixed $projectId): string
    {
        $project = Project::query()->whereKey($projectId)->firstOrFail();
        $member = ProjectMember::query()->where('project_id', $project->id)->orderBy('id')->value('user_id');
        if (is_string($member)) {
            return $member;
        }

        $user = User::factory()->create();
        app(RoleAssignments::class)->setProjectRole($user, $project, ProjectRole::Member);

        return $user->id;
    }
}
