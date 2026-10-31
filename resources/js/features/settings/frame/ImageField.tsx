/*
 * Choosing a picture: the logo of the organisation, an avatar, the picture of a project (P15). The file is cut to its
 * middle square and scaled to 128 px in the browser; the PNG goes to the server as a data URL in the JSON of the change,
 * where `ImageDataUrl` checks it and medialibrary keeps it. `null` takes the picture away.
 */

import { ImagePlus } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { describedBy, Field } from '@/components/ui/Field';
import { t } from '@/lib/i18n';

/** The middle square of an image file as a 128 px PNG data URL. Rejects when the file is no readable image. */
export async function readSquareImage(file: File, size = 128): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not an image');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('unreadable image'));
      element.src = url;
    });
    const width = image.naturalWidth || size;
    const height = image.naturalHeight || size;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

type ImageFieldProps = {
  label: string;
  /** What the picture looks like now (the logo, the badge, the avatar). */
  preview: ReactNode;
  hasImage: boolean;
  hint?: ReactNode;
  /** What the server said about the picture; one the browser could not read replaces it. */
  error?: string;
  disabled?: boolean;
  /** The new picture as a data URL, or null to take it away. */
  onChange: (image: string | null) => void;
};

export function ImageField({ label, preview, hasImage, hint, error, disabled, onChange }: ImageFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [unreadable, setUnreadable] = useState(false);
  // the server's word on the picture before this one: it is not about the new choice
  const [settled, setSettled] = useState<string | undefined>(undefined);
  const shown = unreadable ? t('settings.frame.image.unreadable') : error !== settled ? error : undefined;
  const labelId = `${id}-label`;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(await readSquareImage(file));
      setUnreadable(false);
      setSettled(error);
    } catch {
      setUnreadable(true);
    }
  }

  return (
    <Field id={id} label={label} hint={hint} error={shown}>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-3">
        <span className="shrink-0">{preview}</span>
        {/* the name starts with what the button says and names the field (WCAG 2.5.3): "Choose picture … Logo" */}
        <Button
          id={id}
          variant="secondary"
          icon={ImagePlus}
          disabled={disabled}
          aria-labelledby={`${id}-choose ${labelId}`}
          aria-describedby={describedBy(id, { hint, error: shown })}
          onClick={() => input.current?.click()}
        >
          <span id={`${id}-choose`}>{t('settings.frame.image.choose')}</span>
        </Button>
        {hasImage && (
          <Button
            variant="ghost"
            disabled={disabled}
            aria-labelledby={`${id}-remove ${labelId}`}
            onClick={() => {
              setUnreadable(false);
              setSettled(error);
              onChange(null);
            }}
          >
            <span id={`${id}-remove`}>{t('settings.frame.image.remove')}</span>
          </Button>
        )}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden tabIndex={-1} onChange={(event) => void choose(event)} />
      </div>
    </Field>
  );
}
