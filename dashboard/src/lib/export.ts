import writeXlsxFile from "write-excel-file";

export interface ExportCol<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  type?: "number" | "percent" | "text";
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportarCsv<T>(rows: T[], cols: ExportCol<T>[], nome: string) {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [cols.map((c) => esc(c.header)).join(";"), ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(";"))];
  baixar(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }), `${nome}.csv`);
}

export async function exportarXlsx<T>(rows: T[], cols: ExportCol<T>[], nome: string) {
  const header = cols.map((c) => ({ value: c.header, fontWeight: "bold" as const }));
  const data = rows.map((r) =>
    cols.map((c) => {
      const v = c.value(r);
      if (v == null || v === "") return null;
      if (c.type === "percent") return { type: Number, value: Number(v), format: "0.00%" };
      if (c.type === "number" || typeof v === "number") return { type: Number, value: Number(v), format: "#,##0" };
      return { type: String, value: String(v) };
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await writeXlsxFile([header, ...data] as any, { fontFamily: "Arial", fontSize: 10 });
  baixar(blob as Blob, `${nome}.xlsx`);
}
