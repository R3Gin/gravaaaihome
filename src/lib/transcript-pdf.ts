import { jsPDF } from "jspdf";

export type PdfSegment = { start: number; text: string };

const BRAND: [number, number, number] = [232, 76, 61];
const GRAY: [number, number, number] = [136, 136, 136];
const TEXT: [number, number, number] = [26, 26, 26];

const M = 56; // margem
const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - M * 2;

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtDate(d: Date) {
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `Gerado em ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()} às ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Marca "Gravaai": triângulo de play vermelho + wordmark */
function drawLogo(doc: jsPDF, x: number, y: number, size: number) {
  const r = size / 2;
  doc.setFillColor(...BRAND);
  doc.roundedRect(x, y - r, size, size, size * 0.28, size * 0.28, "F");
  doc.setFillColor(255, 255, 255);
  const p = size * 0.3;
  doc.triangle(
    x + p, y - r + p,
    x + p, y + r - p,
    x + size - p * 0.85, y,
    "F",
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size * 0.95);
  doc.setTextColor(...TEXT);
  doc.text("Gravaai", x + size + size * 0.4, y + size * 0.33);
}

export function buildTranscriptPdf(opts: {
  title?: string;
  summary?: string | null;
  segments: PdfSegment[];
  date?: Date;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const date = opts.date ?? new Date();
  const pageTop = M;
  const bottomLimit = PAGE_H - M - 24;
  let y = pageTop;
  let firstPage = true;

  const header = () => {
    if (firstPage) {
      drawLogo(doc, M, pageTop + 8, 22);
      y = pageTop + 52;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(...TEXT);
      doc.text(opts.title ?? "Transcrição e Resumo", M, y);
      y += 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...GRAY);
      doc.text(fmtDate(date), M, y);
      y += 14;
      doc.setDrawColor(...BRAND);
      doc.setLineWidth(2);
      doc.line(M, y, M + CONTENT_W, y);
      y += 28;
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...BRAND);
      doc.text("Gravaai", M, pageTop);
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.6);
      doc.line(M, pageTop + 6, M + CONTENT_W, pageTop + 6);
      y = pageTop + 28;
    }
  };

  const newPage = () => {
    doc.addPage();
    firstPage = false;
    header();
  };

  const ensure = (h: number) => {
    if (y + h > bottomLimit) newPage();
  };

  header();

  const sectionTitle = (label: string) => {
    ensure(40);
    doc.setFillColor(...BRAND);
    doc.rect(M, y - 11, 4, 15, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...TEXT);
    doc.text(label, M + 14, y);
    y += 22;
  };

  if (opts.summary && opts.summary.trim()) {
    sectionTitle("Resumo");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    const lines = doc.splitTextToSize(opts.summary.trim(), CONTENT_W) as string[];
    for (const line of lines) {
      ensure(17);
      doc.text(line, M, y);
      y += 17;
    }
    y += 18;
  }

  sectionTitle("Transcrição completa");

  for (const seg of opts.segments) {
    const text = seg.text.trim();
    if (!text) continue;
    ensure(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(fmtTime(seg.start), M, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    const indent = 46;
    const lines = doc.splitTextToSize(text, CONTENT_W - indent) as string[];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) ensure(16);
      doc.text(lines[i], M + indent, y);
      y += 16;
    }
    y += 10;
  }

  // Rodapé em todas as páginas
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text(`gravaai.online · Página ${p} de ${total}`, PAGE_W - M, PAGE_H - M + 12, {
      align: "right",
    });
  }

  return doc;
}

export function downloadTranscriptPdf(
  fileName: string,
  opts: Parameters<typeof buildTranscriptPdf>[0],
) {
  buildTranscriptPdf(opts).save(fileName);
}
