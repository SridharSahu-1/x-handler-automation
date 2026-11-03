import ts from "typescript";

/** Syntax-checks JS/TS snippets so broken code never ships as an image. Other languages pass through. */
export function codeProblems(language: string, code: string): string[] {
  const lang = language.toLowerCase();
  const isTs = ["ts", "typescript", "tsx"].includes(lang);
  const isJs = ["js", "javascript", "jsx", "mjs"].includes(lang);
  if (!isTs && !isJs) return [];
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    fileName: `snippet.${lang.includes("x") ? (isTs ? "tsx" : "jsx") : isTs ? "ts" : "js"}`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
  });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
