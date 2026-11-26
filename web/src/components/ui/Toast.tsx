import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";

type Tone = "success" | "error";
interface ToastItem {
    id: number;
    tone: Tone;
    message: string;
}

const ToastContext = createContext<{ notify: (message: string, tone?: Tone) => void } | null>(null);

// Polite live region: announced by screen readers without stealing focus; auto-dismiss after 4.5 s.
export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const { t } = useI18n();

    const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
    const notify = useCallback(
        (message: string, tone: Tone = "success") => {
            const id = nextId.current++;
            setItems((current) => [...current.slice(-2), { id, tone, message }]);
            window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
        },
        [dismiss]
    );

    const value = useMemo(() => ({ notify }), [notify]);
    return (
        <ToastContext.Provider value={value}>
            {children}
            <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-[var(--radius-sheet)] bg-ink px-4 py-3 text-sm text-paper shadow-float animate-ink"
                    >
                        {item.tone === "success" ? (
                            <CheckCircle aria-hidden size={20} weight="fill" className="mt-0.5 shrink-0 text-malachite-tint" />
                        ) : (
                            <WarningCircle aria-hidden size={20} weight="fill" className="mt-0.5 shrink-0 text-saffron" />
                        )}
                        <span className="flex-1">{item.message}</span>
                        <button type="button" onClick={() => dismiss(item.id)} className="-m-1 p-1 text-paper/80 hover:text-paper" aria-label={t("common.close")}>
                            <X aria-hidden size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) throw new Error("useToast must be used inside <ToastProvider>");
    return context;
}
