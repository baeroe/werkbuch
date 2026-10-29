import type { User } from '@/types';

/** What every section of the personal settings gets from the frame: the signed-in person. */
export interface SectionProps {
  user: User;
}
