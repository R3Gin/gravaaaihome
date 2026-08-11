// Carrega apresentações locais (PDF ou PPTX) e transforma cada slide em um
// <canvas> pré-renderizado. Assim a navegação, o preview e a gravação usam
// exatamente a mesma fonte de imagem (facilita compor com a bolha da webcam).

export interface SlideDeck {
  width: number;
  height: number;
  slides: HTMLCanvasElement[];
  name: string;
}

export type SlideProgress = (done: number, total: number) => void;

const EMU_PER_PX = 9525;

export function isSupportedFile(file: File) {
  const n = file.name.toLowerCase();
  return n.endsWith(".pdf") || n.endsWith(".pptx");
}

export async function loadDeck(
  file: File,
  onProgress?: SlideProgress,
): Promise<SlideDeck> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return loadPdfDeck(file, onProgress);
  if (name.endsWith(".pptx")) return loadPptxDeck(file, onProgress);
  throw new Error("Formato não suportado. Envie um arquivo .pdf ou .pptx.");
}

/* ------------------------------- PDF -------------------------------- */

async function loadPdfDeck(
  file: File,
  onProgress?: SlideProgress,
): Promise<SlideDeck> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const slides: HTMLCanvasElement[] = [];
  let width = 1280;
  let height = 720;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1920 / base.width, 1080 / base.height, 3);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (i === 1) {
      width = canvas.width;
      height = canvas.height;
    }
    slides.push(canvas);
    onProgress?.(i, doc.numPages);
  }

  if (slides.length === 0) throw new Error("Este PDF não tem páginas.");
  return { width, height, slides, name: file.name };
}

/* ------------------------------- PPTX ------------------------------- */

interface TextRun {
  text: string;
  size: number;
  bold: boolean;
  color: string;
}

function attr(el: Element | null | undefined, name: string) {
  return el?.getAttribute(name) ?? null;
}

function local(el: Element, tag: string): Element[] {
  return Array.from(el.getElementsByTagName("*")).filter(
    (n) => n.localName === tag,
  );
}

function firstLocal(el: Element, tag: string): Element | null {
  return local(el, tag)[0] ?? null;
}

async function loadPptxDeck(
  file: File,
  onProgress?: SlideProgress,
): Promise<SlideDeck> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presXml) throw new Error("Arquivo .pptx inválido ou corrompido.");
  const parser = new DOMParser();
  const presDoc = parser.parseFromString(presXml, "application/xml");
  const sldSz = presDoc.getElementsByTagName("p:sldSz")[0];
  const slideW = Number(attr(sldSz, "cx") ?? 12192000) / EMU_PER_PX;
  const slideH = Number(attr(sldSz, "cy") ?? 6858000) / EMU_PER_PX;

  const slideNames = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)\.xml/)![1]) -
        Number(b.match(/slide(\d+)\.xml/)![1]),
    );
  if (slideNames.length === 0)
    throw new Error("Nenhum slide encontrado no arquivo .pptx.");

  const scale = Math.min(1920 / slideW, 1080 / slideH, 2);
  const canvasW = Math.round(slideW * scale);
  const canvasH = Math.round(slideH * scale);
  const slides: HTMLCanvasElement[] = [];

  for (let i = 0; i < slideNames.length; i++) {
    const path = slideNames[i];
    const xml = await zip.file(path)!.async("string");
    const doc = parser.parseFromString(xml, "application/xml");

    // Relacionamentos (imagens + layout)
    const relPath = path.replace(/slides\/(slide\d+)\.xml/, "slides/_rels/$1.xml.rels");
    const rels = new Map<string, string>();
    let layoutPath: string | null = null;
    const relXml = await zip.file(relPath)?.async("string");
    if (relXml) {
      const relDoc = parser.parseFromString(relXml, "application/xml");
      Array.from(relDoc.getElementsByTagName("Relationship")).forEach((r) => {
        const id = r.getAttribute("Id");
        const target = r.getAttribute("Target");
        if (!id || !target) return;
        const resolved = target.replace(/^\.\.\//, "ppt/").replace(/^\//, "");
        rels.set(id, resolved);
        if ((r.getAttribute("Type") ?? "").endsWith("/slideLayout"))
          layoutPath = resolved;
      });
    }

    // Placeholders herdam posição do layout (e do master).
    const phBoxes = new Map<string, Box>();
    const inheritFrom = async (p: string | null): Promise<string | null> => {
      if (!p) return null;
      const x = await zip.file(p)?.async("string");
      if (!x) return null;
      const d = parser.parseFromString(x, "application/xml");
      const tree = firstLocal(d.documentElement, "spTree");
      if (tree) {
        for (const node of Array.from(tree.children)) {
          if (node.localName !== "sp") continue;
          const key = placeholderKey(node);
          const box = readXfrm(node, scale);
          if (key && box.w > 0 && !phBoxes.has(key)) phBoxes.set(key, box);
        }
      }
      const rp = p.replace(/([^/]+)\.xml$/, "_rels/$1.xml.rels");
      const rx = await zip.file(rp)?.async("string");
      if (!rx) return null;
      const rd = parser.parseFromString(rx, "application/xml");
      const master = Array.from(rd.getElementsByTagName("Relationship")).find(
        (r) => (r.getAttribute("Type") ?? "").endsWith("/slideMaster"),
      );
      const t = master?.getAttribute("Target");
      return t ? t.replace(/^\.\.\//, "ppt/").replace(/^\//, "") : null;
    };
    const masterPath = await inheritFrom(layoutPath);
    await inheritFrom(masterPath);

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    const root = doc.documentElement;
    const spTree = firstLocal(root, "spTree");
    if (spTree) {
      for (const node of Array.from(spTree.children)) {
        const kind = node.localName;
        if (kind === "pic") {
          await drawPicture(node, ctx, scale, zip, rels);
        } else if (kind === "sp") {
          drawShape(node, ctx, scale, phBoxes);
        }
      }
    }

    slides.push(canvas);
    onProgress?.(i + 1, slideNames.length);
  }

  return { width: canvasW, height: canvasH, slides, name: file.name };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function placeholderKey(node: Element): string | null {
  const ph = firstLocal(node, "ph");
  if (!ph) return null;
  return `${attr(ph, "type") ?? "body"}:${attr(ph, "idx") ?? "0"}`;
}

function readXfrm(node: Element, scale: number): Box {
  const xfrm = firstLocal(node, "xfrm");
  const off = xfrm ? firstLocal(xfrm, "off") : null;
  const ext = xfrm ? firstLocal(xfrm, "ext") : null;
  return {
    x: (Number(attr(off, "x") ?? 0) / EMU_PER_PX) * scale,
    y: (Number(attr(off, "y") ?? 0) / EMU_PER_PX) * scale,
    w: (Number(attr(ext, "cx") ?? 0) / EMU_PER_PX) * scale,
    h: (Number(attr(ext, "cy") ?? 0) / EMU_PER_PX) * scale,
  };
}


async function drawPicture(
  node: Element,
  ctx: CanvasRenderingContext2D,
  scale: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip: any,
  rels: Map<string, string>,
) {
  const blip = firstLocal(node, "blip");
  const embed =
    blip?.getAttribute("r:embed") ?? blip?.getAttribute("embed") ?? null;
  if (!embed) return;
  const target = rels.get(embed);
  if (!target) return;
  const entry = zip.file(target);
  if (!entry) return;
  const blob: Blob = await entry.async("blob");
  const box = readXfrm(node, scale);
  if (box.w <= 0 || box.h <= 0) return;
  try {
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h);
    bitmap.close?.();
  } catch {
    /* formato de imagem não suportado (ex.: emf/wmf) */
  }
}

function drawShape(
  node: Element,
  ctx: CanvasRenderingContext2D,
  scale: number,
  phBoxes: Map<string, Box>,
) {
  const txBody = firstLocal(node, "txBody");
  if (!txBody) return;
  const key = placeholderKey(node);
  const isTitle = !!key && /title/i.test(key);
  let box = readXfrm(node, scale);
  if (box.w <= 0 && key && phBoxes.has(key)) box = phBoxes.get(key)!;
  if (box.w <= 0) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    box = isTitle
      ? { x: W * 0.08, y: H * 0.08, w: W * 0.84, h: H * 0.2 }
      : { x: W * 0.08, y: H * 0.35, w: W * 0.84, h: H * 0.55 };
  }
  const maxWidth = box.w;
  const defaultSz = isTitle ? 4000 : 1800;

  let cursorY = box.y;
  for (const p of local(txBody, "p")) {
    const runs: TextRun[] = local(p, "r").map((r) => {
      const rPr = firstLocal(r, "rPr");
      const solid = rPr ? firstLocal(rPr, "srgbClr") : null;
      return {
        text: local(r, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
        size: (Number(attr(rPr, "sz") ?? defaultSz) / 100) * scale * 1.33,
        bold: attr(rPr, "b") === "1" || isTitle,
        color: solid ? `#${attr(solid, "val")}` : "#111111",
      };
    });

    const text = runs.map((r) => r.text).join("").trim();
    if (!text) {
      cursorY += 12 * scale;
      continue;
    }
    const style = runs[0];
    const fontSize = Math.max(10, style.size);
    ctx.font = `${style.bold ? "700" : "400"} ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = style.color;
    ctx.textBaseline = "top";

    for (const line of wrapText(ctx, text, maxWidth)) {
      ctx.fillText(line, box.x, cursorY);
      cursorY += fontSize * 1.25;
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
