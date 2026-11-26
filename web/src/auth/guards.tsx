import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";
import { Spinner } from "@/components/ui/primitives";
import NotFoundPage from "@/pages/NotFoundPage";

// UX guards only. Every rule is enforced again by the API; hiding a page is never the security.
export function RequireAuth({ children }: { children: ReactNode }) {
    const { me, loading } = useAuth();
    const location = useLocation();
    if (loading) {
        return (
            <div className="p-8">
                <Spinner />
            </div>
        );
    }
    if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return <>{children}</>;
}

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
    const { me } = useAuth();
    // Same answer as the API gives non-admins: "not found".
    if (!me || me.user.platformRole !== "SUPER_ADMIN") return <NotFoundPage />;
    return <>{children}</>;
}

/** Only allows same-site relative paths as post-login redirects (no open redirects). */
export function safeNext(next: string | null, fallback = "/") {
    if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
    return next;
}
