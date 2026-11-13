"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { SessionResponse } from "@/lib/types";

/** Small "try it" entry under the auth card, for visitors who just want to look around. */
export function DemoLoginButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const demoLogin = useMutation({
    mutationFn: () => apiRequest<SessionResponse>("/api/auth/demo-login", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/overview");
    },
  });

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        className="auth-demo-pill"
        disabled={demoLogin.isPending}
        title="Shared sandbox. Other visitors can see what you run."
        onClick={() => demoLogin.mutate()}
      >
        {demoLogin.isPending ? "Opening demo…" : "Explore the demo workspace"}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {demoLogin.isError ? (
        <p role="alert" className="text-xs text-[#ff8fb3]">
          {(demoLogin.error as ApiError).message || "Couldn't open the demo."}
        </p>
      ) : null}
    </div>
  );
}
