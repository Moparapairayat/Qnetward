"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye } from "@/components/icons";
import { apiRequest } from "@/lib/api";
import type { WorkspaceContextResponse } from "@/lib/types";

/**
 * Viewers can see a workspace but not change it (the server refuses), so say
 * so up front instead of letting buttons fail one by one.
 */
export function ViewerBanner() {
  const query = useQuery({
    queryKey: ["workspace-general"],
    queryFn: () => apiRequest<WorkspaceContextResponse>("/api/workspace"),
    staleTime: 60_000,
  });
  const workspace = query.data?.workspace;
  if (workspace?.role !== "viewer") return null;
  return (
    <div role="status" className="mb-5 flex items-start gap-2.5 rounded-lg border border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] px-3.5 py-2.5 text-sm text-[#bfdbfe]">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        You have <strong className="font-medium">view-only</strong> access to {workspace.name}. You can look at everything and export it; to make
        changes, ask an owner or admin for the member role.
      </p>
    </div>
  );
}
