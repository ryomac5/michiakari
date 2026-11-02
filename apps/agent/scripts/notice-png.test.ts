import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderNoticePng } from "./notice-png.ts";

// smoke:claude で Haiku に渡す架空の掲示の PNG が正しく作れるかを確かめる。API は呼ばない

type Chunk = { type: string; data: Buffer; crcOk: boolean };

function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const body = png.subarray(offset + 4, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({
      type: body.subarray(0, 4).toString("ascii"),
      data: body.subarray(4),
      crcOk: crc32(body) === crc,
    });
    offset += 12 + length;
  }
  return chunks;
}

describe("renderNoticePng", () => {
  const png = renderNoticePng(
    [
      { text: "JR KYOTO LINE", color: [255, 214, 0] },
      { text: "RESUME ABOUT 22:50", color: [255, 255, 255] },
    ],
    { scale: 2, background: [0, 0, 0] },
  );
  const chunks = readChunks(png);

  it("PNG の署名と IHDR・IDAT・IEND を持ち、CRC が合う", () => {
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
  });

  it("画素の列が幅と高さに合い、文字の色の画素を含む", () => {
    const header = chunks[0]?.data ?? Buffer.alloc(0);
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    expect([header[8], header[9]]).toEqual([8, 2]);
    const raw = inflateSync(chunks[1]?.data ?? Buffer.alloc(0));
    expect(raw.length).toBe((width * 3 + 1) * height);
    const pixels = new Set<string>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * (width * 3 + 1) + 1 + x * 3;
        pixels.add(`${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
      }
    }
    expect([...pixels].sort()).toEqual(["0,0,0", "255,214,0", "255,255,255"]);
  });

  it("描けない文字は失敗にする", () => {
    expect(() => renderNoticePng([{ text: "運転見合わせ", color: [255, 255, 255] }])).toThrow(
      "描けない文字です",
    );
  });
});
