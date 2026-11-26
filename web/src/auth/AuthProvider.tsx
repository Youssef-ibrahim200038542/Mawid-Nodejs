import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/api/endpoints";
import { ApiError, setCsrfToken } from "@/api/client";
import type { Locale, MePayload, MyClinic } from "@/api/types";
import { useI18n } from "@/i18n";

// Session-based auth: the HttpOnly cookie is the credential. The client only keeps the
// non-secret "who am I" payload from GET /auth/me (role and memberships come from the DB).
interface AuthContextValue {
    me: MePayload | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<MePayload>;
    signup: (name: string, email: string, password: string) => Promise<MePayload>;
    logout: () => Promise<void>;
    refresh: () => Promise<unknown>;
    clinicBySlug: (slug: string | undefined) => MyClinic | undefined;
    setLocalePreference: (locale: Locale) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const meQueryKey = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const { locale, setLocale } = useI18n();

    const query = useQuery({
        queryKey: meQueryKey,
        queryFn: async () => {
            try {
                return await authApi.me();
            } catch (error) {
                if (error instanceof ApiError && error.status === 401) return null;
                throw error;
            }
        },
        staleTime: 60_000,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    });

    // The account's saved language wins once we know who the user is.
    const savedLocale = query.data?.user.locale;
    useEffect(() => {
        if (savedLocale && savedLocale !== locale) setLocale(savedLocale);
        // Only react to the server value changing, not to local toggles.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savedLocale]);

    const afterAuth = useCallback(
        async (payload: { csrfToken: string } & MePayload) => {
            setCsrfToken(payload.csrfToken);
            // Clear anything cached for a previous user before showing this one's data.
            queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
            queryClient.setQueryData(meQueryKey, { user: payload.user, clinics: payload.clinics });
            return { user: payload.user, clinics: payload.clinics };
        },
        [queryClient]
    );

    const value = useMemo<AuthContextValue>(
        () => ({
            me: query.data ?? null,
            loading: query.isPending,
            login: async (email, password) => afterAuth(await authApi.login({ email, password })),
            signup: async (name, email, password) => afterAuth(await authApi.signup({ name, email, password, locale })),
            logout: async () => {
                await authApi.logout().catch(() => undefined);
                setCsrfToken(null);
                queryClient.clear();
                queryClient.setQueryData(meQueryKey, null);
            },
            refresh: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
            clinicBySlug: (slug) => query.data?.clinics.find((clinic) => clinic.slug === slug),
            setLocalePreference: async (next) => {
                setLocale(next);
                if (query.data) {
                    await authApi.updateMe({ locale: next }).catch(() => undefined);
                    queryClient.setQueryData<MePayload | null>(meQueryKey, (old) => (old ? { ...old, user: { ...old.user, locale: next } } : old));
                }
            },
        }),
        [query.data, query.isPending, afterAuth, queryClient, locale, setLocale]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
    return context;
}
