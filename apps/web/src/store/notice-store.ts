import { create } from "zustand";

export type LiveNotice = {
  /** Event id, used to drop repeats when a stream replays after reconnecting. */
  id: string;
  severity: "critical" | "warning" | "success" | "info" | string;
  title: string;
  body?: string;
  href?: string;
  at: number;
};

type NoticeState = {
  notices: LiveNotice[];
  /** Alerts that arrived while the tab was in the background, for the title badge. */
  unseen: number;
  push: (n: LiveNotice) => void;
  dismiss: (id: string) => void;
  clearUnseen: () => void;
};

// At most this many toasts are on screen; older ones give way.
const MAX_SHOWN = 4;

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  unseen: 0,
  push: (n) =>
    set((state) => {
      if (state.notices.some((x) => x.id === n.id)) return state;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      return { notices: [...state.notices, n].slice(-MAX_SHOWN), unseen: hidden ? state.unseen + 1 : state.unseen };
    }),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  clearUnseen: () => set({ unseen: 0 }),
}));
