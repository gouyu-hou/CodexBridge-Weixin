import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';

type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastApi = {
  error: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
const toastIcons = { error: AlertCircle, info: Info, success: CheckCircle2 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const add = useCallback((tone: ToastTone, message: string) => {
    const id = ++nextId.current;
    setItems((current) => [...current.slice(-2), { id, message: message.slice(0, 300), tone }]);
    const timer = window.setTimeout(() => dismiss(id), 4_000);
    timers.current.set(id, timer);
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const api = useMemo<ToastApi>(() => ({
    error: (message) => add('error', message),
    info: (message) => add('info', message),
    success: (message) => add('success', message),
  }), [add]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-label="操作通知">
        {items.map((item) => {
          const Icon = toastIcons[item.tone];
          return (
            <div className="toast" data-tone={item.tone} key={item.id} role="status">
              <Icon aria-hidden="true" />
              <span>{item.message}</span>
              <IconButton label="关闭通知" onClick={() => dismiss(item.id)}><X /></IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
