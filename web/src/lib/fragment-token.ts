import { useState } from "react";

// Email links carry their token in the URL fragment (#token=…). Fragments never reach a server
// (no access logs, no Referer). The token is read once and removed from the address bar at once,
// so it doesn't stay in history or get copied with the URL. It is kept in memory only — never in
// localStorage / sessionStorage. `remember` keeps an invitation token across the in-app login
// detour (same tab, no reload).
const remembered = new Map<string, string>();

function readFragmentToken(): string | null {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]{20,100})/.exec(window.location.hash);
    if (!match) return null;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    return match[1];
}

export function useFragmentToken(rememberKey?: string) {
    const [token] = useState<string | null>(() => {
        const fromUrl = readFragmentToken();
        if (fromUrl) {
            if (rememberKey) remembered.set(rememberKey, fromUrl);
            return fromUrl;
        }
        return rememberKey ? remembered.get(rememberKey) ?? null : null;
    });
    return token;
}

export function forgetToken(rememberKey: string) {
    remembered.delete(rememberKey);
}
