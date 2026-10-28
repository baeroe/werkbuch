import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/Button';

/** Start page until Task 4's router sends "/" to /my-items. */
export function Start() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-display text-ink">werkbuch</h1>
      <p className="mt-3 text-body text-pretty text-ink">Klickdummy. Die Bildschirme entstehen Schritt für Schritt; bis dahin zeigt die Galerie alle Bausteine.</p>
      <p className="mt-6">
        <Link to="/_components" className={buttonClass({ variant: 'primary' })}>
          Komponenten ansehen
        </Link>
      </p>
    </main>
  );
}
