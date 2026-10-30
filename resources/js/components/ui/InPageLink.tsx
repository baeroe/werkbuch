import type { ComponentProps } from 'react';

/**
 * A link to a place on the same page, such as "Skip to content": it moves the focus there itself and leaves the address as
 * it is. A plain `#main` would change the route of the review build, whose router lives in the hash. A target that
 * takes no focus (a heading) takes it for the jump only.
 */
export function InPageLink({ to, onClick, ...rest }: { to: string } & Omit<ComponentProps<'a'>, 'href'>) {
  return (
    <a
      href={`#${to}`}
      onClick={(event) => {
        onClick?.(event);
        const target = document.getElementById(to);
        if (event.defaultPrevented || !target) return;
        event.preventDefault();
        if (!target.hasAttribute('tabindex')) {
          target.setAttribute('tabindex', '-1');
          target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        }
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: 'start' });
      }}
      {...rest}
    />
  );
}
