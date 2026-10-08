import { useCallback, useRef, useState, type ReactNode } from 'react';
import Sheet, { type SheetDismiss } from './Sheet';

/**
 * An in-app confirmation for destructive actions, in place of the browser's
 * own confirm() box: the same sheet as the rest of the app, with the
 * destructive choice named and coloured and Cancel always one tap (or one
 * swipe down) away.
 *
 *   const [confirm, confirmSheet] = useConfirm();
 *   if (!(await confirm({ title: 'Delete this goal?', confirmLabel: 'Delete' }))) return;
 *   ...
 *   return <>{page}{confirmSheet}</>;
 */
type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
};

export default function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const sheet = useRef<SheetDismiss | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  function finish(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const element = pending ? (
    <Sheet onClose={() => finish(false)} dismissRef={sheet} className="gd-confirm-sheet">
      <h2>{pending.title}</h2>
      {pending.message && <p className="muted">{pending.message}</p>}
      <div className="gd-confirm-actions">
        <button type="button" className="gd-confirm-destructive" onClick={() => sheet.current?.(() => finish(true))}>
          {pending.confirmLabel}
        </button>
        <button type="button" className="secondary" onClick={() => sheet.current?.()}>
          Cancel
        </button>
      </div>
    </Sheet>
  ) : null;

  return [confirm, element];
}
