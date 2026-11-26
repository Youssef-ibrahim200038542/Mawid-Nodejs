import {
    forwardRef,
    useEffect,
    useId,
    useRef,
    type ButtonHTMLAttributes,
    type InputHTMLAttributes,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router";
import { CircleNotch, WarningCircle, X } from "@phosphor-icons/react";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/cx";

// ───────────────────────────── Buttons
type Variant = "primary" | "ink" | "secondary" | "ghost" | "danger" | "dangerGhost";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
    primary: "bg-malachite text-white hover:bg-malachite-deep disabled:bg-malachite/50",
    ink: "bg-ink text-paper hover:bg-ink/90 disabled:bg-ink/50",
    secondary: "border border-rule-strong bg-surface text-ink hover:bg-paper disabled:text-graphite",
    ghost: "text-ink hover:bg-ink/5 disabled:text-graphite",
    danger: "bg-carmine text-white hover:bg-carmine-deep disabled:bg-carmine/50",
    dangerGhost: "text-carmine-deep hover:bg-carmine-tint disabled:text-graphite",
};
const sizes: Record<Size, string> = {
    md: "min-h-11 px-4 text-sm",
    sm: "min-h-9 px-3 text-sm",
};
export const buttonClass = (variant: Variant = "secondary", size: Size = "md", extra?: string) =>
    cx(
        "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-150 select-none cursor-pointer disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        extra
    );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
    ref
) {
    return (
        <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
            {loading ? <CircleNotch aria-hidden size={16} className="animate-spin" /> : icon}
            {children}
        </button>
    );
});

export function ButtonLink({ variant = "secondary", size = "md", className, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
    return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

// ───────────────────────────── Form fields
interface FieldProps {
    label: ReactNode;
    error?: string;
    help?: ReactNode;
    optional?: boolean;
    children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
    className?: string;
}
// Visible label + persistent help + error right under the field, wired with aria-describedby.
export function Field({ label, error, help, optional, children, className }: FieldProps) {
    const id = useId();
    const helpId = help ? `${id}-help` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
    const { t } = useI18n();
    return (
        <div className={cx("flex flex-col gap-1.5", className)}>
            <label htmlFor={id} className="text-sm font-medium text-ink">
                {label}
                {optional && <span className="ms-1.5 font-normal text-graphite">({t("common.optional")})</span>}
            </label>
            {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
            {help && !error && (
                <p id={helpId} className="text-xs text-graphite">
                    {help}
                </p>
            )}
            {error && (
                <p id={errorId} className="flex items-center gap-1.5 text-xs font-medium text-carmine">
                    <WarningCircle aria-hidden size={14} weight="fill" />
                    {error}
                </p>
            )}
        </div>
    );
}

const controlBase =
    "w-full rounded-control border border-rule-strong bg-surface px-3 text-base text-ink placeholder:text-graphite/80 transition-colors focus:border-malachite focus:outline-none focus-visible:outline-2 focus-visible:outline-malachite aria-[invalid=true]:border-carmine disabled:bg-paper disabled:text-graphite";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(controlBase, "min-h-11", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(controlBase, "min-h-24 py-2.5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
    return (
        <select ref={ref} className={cx(controlBase, "min-h-11 cursor-pointer pe-8", className)} {...rest}>
            {children}
        </select>
    );
});

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
    const id = useId();
    return (
        <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input id={id} type="checkbox" className="size-4.5 cursor-pointer accent-malachite" {...rest} />
            {label}
        </label>
    );
}

/** Error summary shown after a failed submit; receives focus so screen readers announce it. */
export function ErrorSummary({ message, items }: { message: string; items?: string[] }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current?.focus();
    }, [message]);
    return (
        <div ref={ref} tabIndex={-1} role="alert" className="rounded-control border border-carmine/40 bg-carmine-tint px-4 py-3 text-sm text-carmine-deep">
            <p className="flex items-center gap-2 font-medium">
                <WarningCircle aria-hidden size={18} weight="fill" />
                {message}
            </p>
            {items && items.length > 0 && <ul className="mt-1.5 list-disc ps-8">{items.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>
    );
}

// ───────────────────────────── Feedback states
export function Spinner({ label }: { label?: string }) {
    const { t } = useI18n();
    return (
        <span role="status" className="inline-flex items-center gap-2 text-sm text-graphite">
            <CircleNotch aria-hidden size={18} className="animate-spin" />
            {label ?? t("common.loading")}
        </span>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cx("animate-pulse rounded-control bg-ink/[0.06]", className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
    const { t } = useI18n();
    return (
        <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-3">
            {Array.from({ length: rows }, (_, i) => (
                <Skeleton key={i} className="h-14" />
            ))}
        </div>
    );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
    return (
        <div className="flex flex-col items-start gap-3 rounded-sheet border border-dashed border-rule-strong px-6 py-8">
            {icon && <div className="text-graphite">{icon}</div>}
            <p className="text-base font-medium text-ink">{title}</p>
            {body && <p className="max-w-prose text-sm text-graphite">{body}</p>}
            {action}
        </div>
    );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const { t, errorMessage } = useI18n();
    return (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-sheet border border-carmine/30 bg-carmine-tint/60 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium text-carmine-deep">
                <WarningCircle aria-hidden size={18} weight="fill" />
                {errorMessage(error)}
            </p>
            {onRetry && (
                <Button size="sm" onClick={onRetry}>
                    {t("common.retry")}
                </Button>
            )}
        </div>
    );
}

// ───────────────────────────── Layout helpers
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">{title}</h1>
                {description && <p className="mt-1.5 max-w-prose text-sm text-graphite">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
    );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cx("rounded-sheet bg-surface p-5 ring-1 ring-rule md:p-6", className)}>
            {(title || actions) && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    {title && <h2 className="text-lg font-semibold">{title}</h2>}
                    {actions}
                </div>
            )}
            {children}
        </section>
    );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
    const { t } = useI18n();
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) return null;
    return (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
            <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                {t("common.previous")}
            </Button>
            <span className="tabular text-graphite">{t("common.page", { page, pages })}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
                {t("common.next")}
            </Button>
        </nav>
    );
}

// ───────────────────────────── Dialog (native <dialog>: focus trap + Esc for free)
export function Dialog({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
    const ref = useRef<HTMLDialogElement>(null);
    const { t } = useI18n();
    const titleId = useId();
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
            dialog.querySelector<HTMLElement>("[data-dialog-body]")?.scrollTo(0, 0);
        }
        if (!open && dialog.open) dialog.close();
    }, [open]);
    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            onClose={onClose}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            className={cx(
                "m-auto w-[calc(100%-2rem)] rounded-sheet bg-surface p-0 text-ink shadow-float backdrop:bg-ink/40 open:animate-ink",
                size === "lg" ? "max-w-2xl" : "max-w-lg"
            )}
        >
            {open && (
                <div className="flex max-h-[85dvh] flex-col">
                    <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
                        <h2 id={titleId} className="text-lg font-semibold">
                            {title}
                        </h2>
                        <button type="button" autoFocus onClick={onClose} className="-m-2 rounded-control p-2 text-graphite hover:bg-ink/5 hover:text-ink" aria-label={t("common.close")}>
                            <X aria-hidden size={18} />
                        </button>
                    </div>
                    <div data-dialog-body className="overflow-y-auto px-5 py-4">{children}</div>
                    {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-4">{footer}</div>}
                </div>
            )}
        </dialog>
    );
}

// ───────────────────────────── Segmented control / tabs
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
    return (
        <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-control bg-ink/[0.05] p-1">
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={cx(
                        "min-h-9 rounded-[4px] px-3 text-sm font-medium transition-colors",
                        value === option.value ? "bg-surface text-ink shadow-sm" : "text-graphite hover:text-ink"
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
