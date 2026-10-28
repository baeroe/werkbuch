/*
 * The one moment a secret is shown: the plain text of a new token (spec 4.2) and the secret of a webhook (spec 6.3).
 * The server keeps only a hash, so closing the dialog ends it: the text lives in the state of the screen that got it
 * from the call, in nothing that could bring it back, and the next dialog starts empty.
 */

import { useRef, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { CopyField } from './CopyField';

export interface Secret {
  title: string;
  description?: ReactNode;
  /** The notice above the secret: "Kopiere den Token jetzt". */
  heading: string;
  /** What it means: that the secret is shown only now, and what to do when it is lost. */
  once: string;
  /** Names the field: "Token", "Geheimnis". */
  label: string;
  value: string;
  copyLabel: string;
  /** Something the person must know before they close it, e.g. that the token has admin rights. */
  warning?: ReactNode;
}

export function SecretDialog({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  // while the dialog fades out the screen has already let go of the secret; the last one is shown until it is gone
  const shown = useRef<Secret | null>(null);
  if (secret) shown.current = secret;
  const current = secret ?? shown.current;
  if (!current) return null;

  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(open) => !open && onClose()}
      title={current.title}
      description={current.description}
      footer={<DialogClose render={<Button variant="primary">Fertig</Button>} />}
    >
      <div className="flex flex-col gap-4">
        <Banner tone="info" role="status" title={current.heading}>
          {current.once}
        </Banner>
        {current.warning}
        <CopyField label={current.label} value={current.value} buttonLabel={current.copyLabel} />
      </div>
    </Dialog>
  );
}
