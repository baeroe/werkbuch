import type { Project, TypeTone } from '@/types';
import { cx } from './cx';

/** The order is chosen so the demo projects keep their moodboard tones: WEB sky, APP moss, OPS ochre. */
const TONES: TypeTone[] = ['sky', 'plum', 'ochre', 'moss', 'sand', 'slate'];

/** The same identifier always gets the same muted tone. */
export function projectTone(identifier: string): TypeTone {
  let sum = 0;
  for (const char of identifier) sum += char.codePointAt(0)!;
  return TONES[sum % TONES.length];
}

type ProjectBadgeProps = {
  project: Pick<Project, 'identifier' | 'image_url'>;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * A project's mark: its image, or the first letter of its identifier on its tone (radius 6). Decorative: the
 * project's name always stands next to it.
 */
export function ProjectBadge({ project, size = 'sm', className }: ProjectBadgeProps) {
  const box = size === 'sm' ? 'size-5 text-2xs' : 'size-8 text-sm';
  if (project.image_url) {
    return <img src={project.image_url} alt="" aria-hidden="true" className={cx('shrink-0 rounded-chip object-cover', box, className)} />;
  }
  return (
    <span
      aria-hidden="true"
      data-tone={projectTone(project.identifier)}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-chip bg-[var(--tab-bg)] font-bold text-[var(--tab-ink)]', box, className)}
    >
      {project.identifier.charAt(0)}
    </span>
  );
}
