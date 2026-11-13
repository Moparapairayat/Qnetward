"use client";

// The last resort, when the root layout itself fails: it has to bring its own html and styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#141417", color: "#ededf0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <p style={{ color: "#ff3d7f", fontFamily: "monospace", fontSize: 13 }}>{error.digest ? `Error · ${error.digest}` : "Error"}</p>
          <h1 style={{ fontSize: 24, margin: "8px 0 12px" }}>Something went wrong</h1>
          <p style={{ color: "#a3a3ab", fontSize: 15, lineHeight: 1.5 }}>Qnetward couldn&apos;t load. Trying again usually fixes it.</p>
          <button type="button" onClick={reset} style={{ marginTop: 24, height: 40, padding: "0 16px", border: 0, borderRadius: 8, background: "#ff3d7f", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
