import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import { ariaKeyshortcuts, Kbd } from './Kbd';
import { keptSide, optionClass, popupFocus, popupSurface } from './styles';

/*
 * Menu on tracing paper. Compose it:
 *   <Menu><MenuTrigger render={<Button …/>} /><MenuContent><MenuItem …/></MenuContent></Menu>
 */
export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;
export const MenuGroup = BaseMenu.Group;
export const MenuRadioGroup = BaseMenu.RadioGroup;

type Side = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';

type MenuContentProps = {
  children: ReactNode;
  side?: Side;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Keep the preferred side even without room. */
  keepSide?: boolean;
  className?: string;
};

export function MenuContent({ children, side = 'bottom', align = 'start', sideOffset = 6, keepSide, className }: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} collisionAvoidance={keepSide ? keptSide : undefined} className="z-50 outline-none">
        <BaseMenu.Popup {...popupFocus} className={cx(popupSurface, 'min-w-52 overflow-y-auto overscroll-contain p-1', !keepSide && 'max-h-[var(--available-height)]', className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

type ItemLook = {
  icon?: LucideIcon;
  /** Register notation; shown as kbd and exposed as aria-keyshortcuts. */
  shortcut?: string;
  className?: string;
  children: ReactNode;
};

function ItemBody({ icon: Icon, shortcut, children, iconClass }: Omit<ItemLook, 'className'> & { iconClass?: string }) {
  return (
    <>
      {Icon && <Icon className={cx('size-4 shrink-0', iconClass)} aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <Kbd keys={shortcut} aria-hidden="true" />}
    </>
  );
}

type MenuItemProps = Omit<ComponentProps<typeof BaseMenu.Item>, 'className' | 'children'> & ItemLook & { danger?: boolean };

export function MenuItem({ icon, shortcut, danger = false, className, children, ...rest }: MenuItemProps) {
  return (
    <BaseMenu.Item aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined} className={cx(optionClass, danger && 'text-danger', className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut} iconClass={danger ? undefined : 'text-muted'}>
        {children}
      </ItemBody>
    </BaseMenu.Item>
  );
}

type MenuLinkItemProps = Omit<ComponentProps<typeof BaseMenu.LinkItem>, 'className' | 'children'> & ItemLook;

/**
 * An entry that navigates: a real link, so Cmd/Ctrl- and middle-click work. Pass the router's link as `render`:
 * <MenuLinkItem icon={UserRound} render={<Link to="/me" />}>Personal settings</MenuLinkItem>
 */
export function MenuLinkItem({ icon, shortcut, className, children, ...rest }: MenuLinkItemProps) {
  return (
    <BaseMenu.LinkItem closeOnClick aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined} className={cx(optionClass, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut} iconClass="text-muted">
        {children}
      </ItemBody>
    </BaseMenu.LinkItem>
  );
}

/** Space for the tick, so checkable items line up with items that have an icon. */
function Tick({ indicator }: { indicator: ReactNode }) {
  return <span className="inline-flex size-4 shrink-0 items-center justify-center text-accent-text">{indicator}</span>;
}

type MenuCheckboxItemProps = Omit<ComponentProps<typeof BaseMenu.CheckboxItem>, 'className' | 'children'> & Omit<ItemLook, 'icon'>;

export function MenuCheckboxItem({ shortcut, className, children, ...rest }: MenuCheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem className={cx(optionClass, className)} {...rest}>
      <Tick
        indicator={
          <BaseMenu.CheckboxItemIndicator>
            <Check className="size-4" aria-hidden="true" />
          </BaseMenu.CheckboxItemIndicator>
        }
      />
      <ItemBody shortcut={shortcut}>{children}</ItemBody>
    </BaseMenu.CheckboxItem>
  );
}

type MenuRadioItemProps = Omit<ComponentProps<typeof BaseMenu.RadioItem>, 'className' | 'children'> & Omit<ItemLook, 'icon'>;

export function MenuRadioItem({ shortcut, className, children, ...rest }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem className={cx(optionClass, className)} {...rest}>
      <Tick
        indicator={
          <BaseMenu.RadioItemIndicator>
            <Check className="size-4" aria-hidden="true" />
          </BaseMenu.RadioItemIndicator>
        }
      />
      <ItemBody shortcut={shortcut}>{children}</ItemBody>
    </BaseMenu.RadioItem>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2 my-1 h-px bg-edge" />;
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return <BaseMenu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-sm text-muted">{children}</BaseMenu.GroupLabel>;
}

type MenuSubmenuProps = { label: ReactNode; icon?: LucideIcon; children: ReactNode; defaultOpen?: boolean; keepSide?: boolean };

/** An item that opens a nested menu to the side. */
export function MenuSubmenu({ label, icon: Icon, children, defaultOpen, keepSide }: MenuSubmenuProps) {
  return (
    <BaseMenu.SubmenuRoot defaultOpen={defaultOpen}>
      <BaseMenu.SubmenuTrigger className={cx(optionClass, 'data-popup-open:bg-hover')}>
        {Icon && <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </BaseMenu.SubmenuTrigger>
      <MenuContent side="inline-end" sideOffset={-2} keepSide={keepSide}>
        {children}
      </MenuContent>
    </BaseMenu.SubmenuRoot>
  );
}
