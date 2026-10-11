import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useMemo, useRef, useState } from "preact/hooks";

/** On the phone a toast stays 5 s, long enough to reach Undo; the Mac's status line, 4 s. */
export const TOAST_MS = 5000;
export const STATUS_MS = 4000;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  key: number;
  text: string;
  action?: ToastAction;
}

interface Toasts {
  current?: Toast;
  /** Show a message, with one action (UNDO, VIEW). An UNDO also becomes the last undo. */
  say: (text: string, action?: ToastAction) => void;
  dismiss: () => void;
  /** Undo the last action that offered one (the Mac's U), if it is still undoable. */
  undo: () => boolean;
}

const Ctx = createContext<Toasts | null>(null);

export function ToastProvider({ wide, children }: { wide: boolean; children: ComponentChildren }) {
  const [current, setCurrent] = useState<Toast>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastUndo = useRef<(() => void) | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setCurrent(undefined);
  }, []);

  const say = useCallback(
    (text: string, action?: ToastAction) => {
      clearTimeout(timer.current);
      const key = Date.now() + Math.random();
      if (action?.label === "Undo") {
        // Once used, an undo is spent: a second U or tap does nothing.
        const run = action.run;
        let spent = false;
        const once = () => {
          if (spent) return;
          spent = true;
          lastUndo.current = undefined;
          setCurrent((t) => (t?.key === key ? undefined : t));
          run();
        };
        action = { ...action, run: once };
        lastUndo.current = once;
      }
      setCurrent({ key, text, action });
      timer.current = setTimeout(
        () => setCurrent((t) => (t?.key === key ? undefined : t)),
        wide ? STATUS_MS : TOAST_MS,
      );
    },
    [wide],
  );

  const undo = useCallback(() => {
    const run = lastUndo.current;
    if (!run) return false;
    run();
    return true;
  }, []);

  const value = useMemo(() => ({ current, say, dismiss, undo }), [current, say, dismiss, undo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast(): Toasts {
  const t = useContext(Ctx);
  if (!t) throw new Error("useToast outside ToastProvider");
  return t;
}

/** The phone's toast: above the tab bar or the reader's action bar. */
export function ToastView() {
  const { current } = useToast();
  return (
    <div class="toast-slot" role="status" aria-live="polite">
      {current && (
        <div key={current.key} class="toast">
          <span class="toast-text">{current.text}</span>
          {current.action && (
            <button type="button" class="toast-action" onClick={current.action.run}>
              {current.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
