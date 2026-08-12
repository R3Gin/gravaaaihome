// Anotações de pós-produção (Editor): caneta, seta, retângulo, elipse e
// destaque. Todos os pontos são NORMALIZADOS (0..1) em relação ao quadro,
// o que permite desenhá-las em qualquer resolução — preview e exportação.

export type AnnotationShape = "pen" | "arrow" | "rect" | "ellipse" | "highlight";
export type AnnotationTool = AnnotationShape | "eraser";

export interface Annotation {
  type: AnnotationShape;
  color: string;
  /** espessura normalizada pela altura do quadro (0..1) */
  sizeN: number;
  fill: boolean;
  /** caneta: caminho completo. formas: [início, fim] */
  points: { x: number; y: number }[];
}

export const PEN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lw: number,
) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.max(lw * 3, 10);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - len * Math.cos(ang - Math.PI / 7), y1 - len * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x1 - len * Math.cos(ang + Math.PI / 7), y1 - len * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Desenha uma anotação em um canvas de tamanho W×H. */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  it: Annotation,
  W: number,
  H: number,
) {
  const pts = it.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const lw = Math.max(1, it.sizeN * H);
  ctx.lineWidth = lw;
  ctx.strokeStyle = it.color;
  ctx.fillStyle = it.color;

  if (it.type === "pen") {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * W, pts[0].y * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
    if (pts.length === 1) ctx.lineTo(pts[0].x * W + 0.1, pts[0].y * H);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const a = pts[0];
  const b = pts[pts.length - 1];
  const x0 = a.x * W;
  const y0 = a.y * H;
  const x1 = b.x * W;
  const y1 = b.y * H;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);

  if (it.type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    drawArrowHead(ctx, x0, y0, x1, y1, lw);
  } else if (it.type === "rect") {
    if (it.fill) {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.strokeRect(x, y, w, h);
  } else if (it.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (it.fill) {
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  } else if (it.type === "highlight") {
    ctx.globalAlpha = 0.32;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Caixa envolvente normalizada de uma anotação (para hit-test/seleção). */
export function annotationBounds(it: Annotation) {
  const xs = it.points.map((p) => p.x);
  const ys = it.points.map((p) => p.y);
  const pad = it.sizeN;
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + pad * 2,
    h: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };
}

/** Move todos os pontos por um delta normalizado. */
export function translateAnnotation(it: Annotation, dx: number, dy: number): Annotation {
  return {
    ...it,
    points: it.points.map((p) => ({
      x: Math.max(0, Math.min(1, p.x + dx)),
      y: Math.max(0, Math.min(1, p.y + dy)),
    })),
  };
}
