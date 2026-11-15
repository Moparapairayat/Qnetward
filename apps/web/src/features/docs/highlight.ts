/**
 * A small syntax highlighter for the docs' code samples. It knows just enough
 * of bash, JavaScript, Python, Go, and JSON to colour strings, comments,
 * keywords, numbers, and JSON keys; anything else stays plain.
 */

export type Lang = "bash" | "js" | "python" | "go" | "json" | "http";
export type Token = { text: string; kind?: "comment" | "string" | "keyword" | "number" | "key" | "fn" | "flag" };

const KEYWORDS: Record<Lang, string[]> = {
  bash: ["curl", "export", "echo"],
  js: ["const", "let", "await", "async", "function", "return", "if", "else", "new", "import", "from", "throw", "true", "false", "null"],
  python: ["import", "from", "def", "return", "if", "else", "for", "in", "with", "as", "True", "False", "None", "raise"],
  go: ["package", "import", "func", "return", "if", "else", "var", "defer", "nil", "err", "true", "false", ":="],
  json: ["true", "false", "null"],
  http: ["GET", "POST", "DELETE", "PUT", "PATCH"],
};

const COMMENT: Record<Lang, RegExp | null> = {
  bash: /^#.*/,
  js: /^\/\/.*/,
  python: /^#.*/,
  go: /^\/\/.*/,
  json: null,
  http: null,
};

export function highlight(code: string, lang: Lang): Token[][] {
  const keywords = new Set(KEYWORDS[lang]);
  const comment = COMMENT[lang];
  return code.split("\n").map((line) => {
    const out: Token[] = [];
    let rest = line;
    const push = (text: string, kind?: Token["kind"]) => {
      const last = out[out.length - 1];
      if (!kind && last && !last.kind) last.text += text;
      else out.push({ text, kind });
    };
    while (rest.length) {
      let m: RegExpMatchArray | null;
      if (comment && (m = rest.match(comment))) {
        push(m[0], "comment");
      } else if ((m = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/))) {
        // A JSON key is a string followed by a colon.
        const isKey = lang === "json" && /^\s*:/.test(rest.slice(m[0].length));
        push(m[0], isKey ? "key" : "string");
      } else if ((m = rest.match(/^-{1,2}[A-Za-z][\w-]*/)) && lang === "bash") {
        push(m[0], "flag");
      } else if ((m = rest.match(/^\d+(\.\d+)?/))) {
        push(m[0], "number");
      } else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
        const word = m[0];
        const after = rest.slice(word.length);
        if (keywords.has(word)) push(word, "keyword");
        else if (after.startsWith("(")) push(word, "fn");
        else push(word);
      } else if ((m = rest.match(/^:=/)) && keywords.has(":=")) {
        push(m[0], "keyword");
      } else {
        push(rest[0]);
        rest = rest.slice(1);
        continue;
      }
      rest = rest.slice(m[0].length);
    }
    return out;
  });
}
