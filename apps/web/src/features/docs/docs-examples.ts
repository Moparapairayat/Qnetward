import type { Example } from "./docs-code";
import { BASE_URL } from "./docs-nav";

/**
 * One request written four ways: curl, JavaScript, Python, and Go. Built from
 * the same method, path, and body so the samples can't drift apart.
 */
export function request(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>): Example[] {
  const url = `${BASE_URL}${path}`;
  const json = body ? JSON.stringify(body, null, 2) : "";
  const indent = (s: string, n: number) => s.replace(/\n/g, "\n" + " ".repeat(n));

  const curl = [
    `curl${method === "GET" ? "" : ` -X ${method}`} ${url} \\`,
    `  -H "Authorization: Bearer $QNETWARD_API_KEY"${body ? " \\" : ""}`,
    ...(body ? [`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(body)}'`] : []),
  ].join("\n");

  const js = [
    `const res = await fetch("${url}", {`,
    ...(method === "GET" ? [] : [`  method: "${method}",`]),
    `  headers: {`,
    "    Authorization: `Bearer ${process.env.QNETWARD_API_KEY}`,",
    ...(body ? [`    "Content-Type": "application/json",`] : []),
    `  },`,
    ...(body ? [`  body: JSON.stringify(${indent(json, 2)}),`] : []),
    `});`,
    `if (!res.ok) throw new Error((await res.json()).error);`,
    `const data = await res.json();`,
  ].join("\n");

  const pyBody = body
    ? JSON.stringify(body, null, 4)
        .replace(/\btrue\b/g, "True")
        .replace(/\bfalse\b/g, "False")
        .replace(/\bnull\b/g, "None")
    : "";
  const python = [
    `import os`,
    `import requests`,
    ``,
    `res = requests.${method.toLowerCase()}(`,
    `    "${url}",`,
    `    headers={"Authorization": f"Bearer {os.environ['QNETWARD_API_KEY']}"},`,
    ...(body ? [`    json=${indent(pyBody, 4)},`] : []),
    `)`,
    `res.raise_for_status()`,
    `data = res.json()`,
  ].join("\n");

  const go = [
    ...(body ? [`body := strings.NewReader(\`${JSON.stringify(body)}\`)`] : []),
    `req, err := http.NewRequest("${method}", "${url}", ${body ? "body" : "nil"})`,
    `if err != nil {`,
    `\treturn err`,
    `}`,
    `req.Header.Set("Authorization", "Bearer "+os.Getenv("QNETWARD_API_KEY"))`,
    ...(body ? [`req.Header.Set("Content-Type", "application/json")`] : []),
    ``,
    `res, err := http.DefaultClient.Do(req)`,
    `if err != nil {`,
    `\treturn err`,
    `}`,
    `defer res.Body.Close()`,
  ].join("\n");

  return [
    { label: "curl", lang: "bash", code: curl },
    { label: "JavaScript", lang: "js", code: js },
    { label: "Python", lang: "python", code: python },
    { label: "Go", lang: "go", code: go },
  ];
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
