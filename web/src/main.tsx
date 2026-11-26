import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import "./styles.css";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./auth/AuthProvider";
import { ToastProvider } from "./components/ui/Toast";
import { router } from "./router";
import { ApiError } from "./api/client";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            // Don't hammer the API on 4xx — those won't fix themselves.
            retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
        },
        mutations: { retry: false },
    },
});

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <AuthProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </AuthProvider>
            </I18nProvider>
        </QueryClientProvider>
    </StrictMode>
);
