"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "@/components/icons";
import { paletteSections, type NavItem } from "@/components/app/nav-config";
import { useShellStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

type Entry = NavItem & { section: string };

/** Ctrl/Cmd+K jump-to-page palette. Keyboard: arrows to move, Enter to open, Esc to close. */
export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const { paletteOpen, setPaletteOpen } = useShellStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!useShellStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  // Mounting the dialog only while open gives it fresh state on every open.
  return paletteOpen ? <PaletteDialog isAdmin={isAdmin} onClose={() => setPaletteOpen(false)} /> : null;
}

function PaletteDialog({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const router = useRouter();
  const setPaletteOpen = (open: boolean) => {
    if (!open) onClose();
  };
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(
    () => paletteSections(isAdmin).flatMap((s) => s.items.map((item) => ({ ...item, section: s.label }))),
    [isAdmin],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.label} ${e.section} ${e.keywords ?? ""}`.toLowerCase().includes(q));
  }, [entries, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const open = (entry?: Entry) => {
    if (!entry) return;
    setPaletteOpen(false);
    router.push(entry.href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={() => setPaletteOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go to page"
        className="console-popover w-full max-w-[560px] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--lp-border)] px-4">
          <Search className="h-4 w-4 text-[var(--lp-subtle)]" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                open(results[index]);
              } else if (e.key === "Escape") {
                setPaletteOpen(false);
              }
            }}
            placeholder="Search pages…"
            aria-label="Search pages"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            className="h-12 flex-1 !border-0 !bg-transparent px-0 text-[15px] !shadow-none outline-none"
          />
          <kbd className="rounded border border-[var(--lp-border)] px-1.5 py-0.5 text-[11px] text-[var(--lp-subtle)]">Esc</kbd>
        </div>
        <ul ref={listRef} id="palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length ? (
            results.map((entry, i) => (
              <li
                key={entry.href}
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => open(entry)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px]",
                  i === index ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-muted)]",
                )}
              >
                <entry.icon className={cn("h-4 w-4", i === index ? "text-[var(--lp-accent)]" : "text-[var(--lp-subtle)]")} />
                <span className="flex-1">{entry.label}</span>
                <span className="text-[12px] text-[var(--lp-subtle)]">{entry.section}</span>
                {i === index ? <CornerDownLeft className="h-3.5 w-3.5 text-[var(--lp-subtle)]" /> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-8 text-center text-[13px] text-[var(--lp-subtle)]">No pages match “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
