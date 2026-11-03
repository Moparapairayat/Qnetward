"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { getPasskey, passkeyErrorMessage, passkeysSupported, type RequestOptionsJSON } from "@/lib/webauthn";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

type Providers = { google: boolean; passkeys: boolean };

/**
 * Google and passkey sign-in. Each button works when the server has it set up
 * and otherwise says why, rather than starting a flow that would fail.
 */
export function AlternateSignIn({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: () => apiRequest<Providers>("/api/auth/providers"), staleTime: 60_000 });
  const verb = mode === "signin" ? "Sign in" : "Sign up";
  const google = providers.data?.google === true;
  const passkeys = providers.data?.passkeys === true;

  async function signInWithPasskey() {
    setNotice(null);
    if (mode === "signup") {
      setNotice("Create your account with email first, then add a passkey under Password and sessions.");
      return;
    }
    if (!passkeys || !passkeysSupported()) {
      setNotice(passkeys ? "This browser can't use passkeys." : "Passkeys aren't set up on this server yet. Use your email for now.");
      return;
    }
    setBusy(true);
    try {
      const begin = await apiRequest<{ token: string; options: RequestOptionsJSON }>("/api/auth/passkey/begin", { method: "POST", body: "{}" });
      const assertion = await getPasskey(begin.options);
      await apiRequest(`/api/auth/passkey/finish?token=${encodeURIComponent(begin.token)}`, { method: "POST", body: JSON.stringify(assertion) });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/overview");
    } catch (error) {
      setNotice(passkeyErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        {google ? (
          // A full page load on purpose: <Link> would prefetch the API route and start OAuth by itself.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a className="auth-provider-button" href="/api/auth/google/start" aria-label={`${verb} with Google`}>
            <GoogleMark />
            <span>Google</span>
          </a>
        ) : (
          <button
            type="button"
            className="auth-provider-button"
            aria-label={`${verb} with Google (not set up yet)`}
            onClick={() => setNotice(`${verb} with Google isn't set up on this server yet. Use your email for now.`)}
          >
            <GoogleMark />
            <span>Google</span>
            {providers.isSuccess ? <span className="auth-soon-tag">Soon</span> : null}
          </button>
        )}
        <button
          type="button"
          className="auth-provider-button"
          aria-label={mode === "signin" ? "Sign in with a passkey" : "Use a passkey"}
          disabled={busy}
          onClick={signInWithPasskey}
        >
          <Fingerprint className="h-4 w-4 text-[var(--lp-muted)]" aria-hidden="true" />
          <span>{busy ? "Waiting…" : "Passkey"}</span>
          {providers.isSuccess && !passkeys ? <span className="auth-soon-tag">Soon</span> : null}
        </button>
      </div>

      {notice ? (
        <p role="status" className="rounded-lg border border-[var(--lp-border)] bg-white/[0.03] px-3 py-2 text-center text-[12px] text-[var(--lp-muted)]">
          {notice}
        </p>
      ) : null}

      <div className="auth-divider">Or continue with email</div>
    </div>
  );
}
