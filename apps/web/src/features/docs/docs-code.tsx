"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "@/components/icons";
import { highlight, type Lang } from "./highlight";

export type Example = { label: string; lang: Lang; code: string };

// The language picked in one block applies to every block, and is remembered.
const KEY = "qnw-docs-lang";
const EVENT = "qnw-docs-lang";
function readLang() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function pickLang(label: string) {
  try {
    localStorage.setItem(KEY, label);
  } catch {
    // Private windows: the choice just isn't remembered.
  }
  window.dispatchEvent(new Event(EVENT));
}

function Highlighted({ code, lang }: { code: string; lang: Lang }) {
  const lines = highlight(code, lang);
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block min-h-[1.7em]">
          {line.map((t, j) => (t.kind ? <span key={j} className={`tok-${t.kind}`}>{t.text}</span> : t.text))}
        </span>
      ))}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`docs-copy ${done ? "docs-copy-done" : ""}`}
      aria-label={done ? "Copied" : "Copy code"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** A code sample in several languages, with tabs and a copy button. */
export function CodeTabs({ examples, title }: { examples: Example[]; title?: string }) {
  const stored = useSyncExternalStore(subscribe, readLang, () => null);
  const active = examples.find((e) => e.label === stored) ?? examples[0];
  return (
    <div className="docs-code">
      <div className="docs-code-bar" role="tablist" aria-label={title ?? "Code sample"}>
        {title ? <span className="mr-2 text-[13px] text-[var(--d-muted)]">{title}</span> : null}
        {examples.length > 1
          ? examples.map((e) => (
              <button key={e.label} type="button" role="tab" aria-selected={e === active} className="docs-tab" onClick={() => pickLang(e.label)}>
                {e.label}
              </button>
            ))
          : null}
        <CopyButton text={active.code} />
      </div>
      <pre key={active.label} className="docs-pre docs-pre-fade">
        <code>
          <Highlighted code={active.code} lang={active.lang} />
        </code>
      </pre>
    </div>
  );
}

/** One block of code, such as a response, with an optional status line. */
export function CodeBlock({ code, lang, title, status }: { code: string; lang: Lang; title?: string; status?: string }) {
  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        {title ? <span className="text-[13px] text-[var(--d-muted)]">{title}</span> : null}
        {status ? <span className="docs-mono ml-2 text-[12px] text-[#86efac]">{status}</span> : null}
        <CopyButton text={code} />
      </div>
      <pre className="docs-pre">
        <code>
          <Highlighted code={code} lang={lang} />
        </code>
      </pre>
    </div>
  );
}
