import { crc32, deflateSync } from "node:zlib";

// 架空の掲示を描いた PNG を依存なしで作る。canvas を使わないので、5×7 の点字形で英大文字と数字だけを描く
// 日本語の字形は持たないため、掲示の文面は英語にする

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

const GLYPHS: Record<string, readonly string[]> = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  B: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  C: [" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ### ", "#   #", "#    ", "# ###", "#   #", "#   #", " ####"],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  J: ["  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "#   #", "##  #", "# # #", "#  ##", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "# # #", " # # "],
  X: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
  ":": ["     ", "  #  ", "  #  ", "     ", "  #  ", "  #  ", "     "],
  ",": ["     ", "     ", "     ", "     ", " ##  ", "  #  ", " #   "],
  ".": ["     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
  "/": ["    #", "    #", "   # ", "  #  ", " #   ", "#    ", "#    "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};

export type Rgb = readonly [number, number, number];
export type NoticeLine = { text: string; color: Rgb };

export type NoticeOptions = {
  // 1 点を何ピクセルで描くか
  scale?: number;
  background?: Rgb;
};

const CHAR_GAP = 1;
const LINE_GAP = 4;
const MARGIN = 6;

export function listSupportedCharacters(): string {
  return Object.keys(GLYPHS).join("");
}

// 文字の点を 1 と 0 の格子に置き、色の番号を返す。0 は背景
function layoutDots(lines: readonly NoticeLine[]): { grid: number[][]; width: number } {
  const width =
    Math.max(...lines.map((l) => l.text.length)) * (GLYPH_WIDTH + CHAR_GAP) - CHAR_GAP + MARGIN * 2;
  const height = lines.length * (GLYPH_HEIGHT + LINE_GAP) - LINE_GAP + MARGIN * 2;
  const grid = Array.from({ length: height }, () => new Array<number>(width).fill(0));

  lines.forEach((line, li) => {
    const top = MARGIN + li * (GLYPH_HEIGHT + LINE_GAP);
    [...line.text.toUpperCase()].forEach((ch, ci) => {
      const glyph = GLYPHS[ch];
      if (!glyph) throw new Error(`描けない文字です: ${ch}`);
      const left = MARGIN + ci * (GLYPH_WIDTH + CHAR_GAP);
      glyph.forEach((row, y) => {
        [...row].forEach((dot, x) => {
          const target = grid[top + y];
          if (dot === "#" && target) target[left + x] = li + 1;
        });
      });
    });
  });
  return { grid, width };
}

function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// RGB 8bit の PNG を作る
export function encodePng(width: number, height: number, pixelAt: (x: number, y: number) => Rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw.set([r, g, b], rowStart + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    buildChunk("IHDR", header),
    buildChunk("IDAT", deflateSync(raw)),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderNoticePng(lines: readonly NoticeLine[], options: NoticeOptions = {}) {
  const scale = options.scale ?? 6;
  const background = options.background ?? [16, 32, 72];
  const { grid, width } = layoutDots(lines);
  return encodePng(width * scale, grid.length * scale, (x, y) => {
    const index = grid[Math.floor(y / scale)]?.[Math.floor(x / scale)] ?? 0;
    return index === 0 ? background : (lines[index - 1]?.color ?? background);
  });
}
