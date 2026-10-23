// Generates simple, self-contained sample images for the seed (no network, no hotlinking).
import { crc32, deflateSync } from "node:zlib";

function escapeXml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("")}`;
}

/** A side-view car illustration with a label, 800x500 SVG. `body` decides the silhouette. */
export function carSvg(opts: {
  title: string;
  subtitle: string;
  color: string;
  body: "sedan" | "suv" | "hatch" | "van" | "coupe";
  variant?: 0 | 1;
}): Uint8Array {
  const { color, body } = opts;
  const dark = shade(color, -0.25);
  const light = shade(color, 0.25);
  const bg = opts.variant === 1 ? ["#0f172a", "#334155"] : ["#e0f2fe", "#f8fafc"];
  const text = opts.variant === 1 ? "#f8fafc" : "#0f172a";
  const shapes: Record<typeof body, string> = {
    sedan: "M110 330 L150 270 Q170 250 210 248 L300 246 L360 190 Q380 176 410 176 L520 176 Q550 176 570 192 L630 246 L690 254 Q720 260 722 290 L724 330 Z",
    coupe: "M110 330 L140 282 Q160 262 200 258 L330 252 L400 196 Q420 184 450 184 L520 186 Q545 188 565 205 L640 256 L700 266 Q722 272 722 300 L722 330 Z",
    hatch: "M120 330 L150 272 Q168 252 205 250 L300 248 L350 186 Q366 170 396 170 L560 170 Q590 170 604 196 L630 250 L680 258 Q706 264 708 292 L708 330 Z",
    suv: "M100 330 L100 262 Q104 236 140 232 L250 226 L310 160 Q324 146 352 146 L590 146 Q624 146 640 170 L676 228 L710 236 Q730 244 730 276 L730 330 Z",
    van: "M100 330 L100 180 Q100 140 140 140 L600 140 Q640 140 660 170 L720 240 Q732 254 732 280 L732 330 Z",
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500" role="img" aria-label="${escapeXml(opts.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>
    <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
  </defs>
  <rect width="800" height="500" fill="url(#bg)"/>
  <ellipse cx="415" cy="372" rx="330" ry="18" fill="#000" opacity="0.15"/>
  <path d="${shapes[body]}" fill="url(#paint)" stroke="${dark}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M330 240 L380 192 Q392 184 410 184 L470 184 L470 240 Z M486 184 L540 184 Q556 184 566 196 L604 240 L486 240 Z" fill="#cbd5e1" opacity="${body === "van" ? 0 : 0.85}"/>
  ${body === "van" ? '<rect x="140" y="170" width="430" height="60" rx="10" fill="#cbd5e1" opacity="0.85"/>' : ""}
  <rect x="660" y="262" width="40" height="14" rx="6" fill="#fde68a"/>
  <rect x="112" y="282" width="26" height="12" rx="5" fill="#f87171"/>
  <g fill="#111827"><circle cx="240" cy="330" r="52"/><circle cx="600" cy="330" r="52"/></g>
  <g fill="#9ca3af"><circle cx="240" cy="330" r="24"/><circle cx="600" cy="330" r="24"/></g>
  <text x="40" y="440" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="${text}">${escapeXml(opts.title)}</text>
  <text x="40" y="474" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" fill="${text}" opacity="0.75">${escapeXml(opts.subtitle)}</text>
</svg>`;
  return new TextEncoder().encode(svg);
}

/** A small valid PNG (solid colour with a darker band), used as the sample licence scan. */
export function samplePng(width = 64, height = 40, rgb: [number, number, number] = [37, 99, 235]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const band = y > height * 0.6 ? 0.6 : 1;
      raw[row + 1 + x * 3] = Math.round(rgb[0] * band);
      raw[row + 2 + x * 3] = Math.round(rgb[1] * band);
      raw[row + 3 + x * 3] = Math.round(rgb[2] * band);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
