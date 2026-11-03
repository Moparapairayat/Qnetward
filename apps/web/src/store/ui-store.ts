import { create } from "zustand";
import { persist } from "zustand/middleware";

type ShellState = {
  /** Mobile drawer visibility. Not persisted. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Desktop icon-only rail. Persisted per browser. */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  /** Sections the user opened (true) or folded (false). Unset ones use the section default. Persisted. */
  sectionState: Record<string, boolean>;
  setSectionOpen: (label: string, open: boolean) => void;
  /** Command palette (Ctrl/Cmd+K). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      sectionState: {},
      setSectionOpen: (label, open) => set((state) => ({ sectionState: { ...state.sectionState, [label]: open } })),
      paletteOpen: false,
      setPaletteOpen: (open) => set({ paletteOpen: open }),
    }),
    {
      name: "qnetward-shell",
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, sectionState: state.sectionState }),
    },
  ),
);
