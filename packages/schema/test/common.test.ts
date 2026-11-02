import { describe, expect, it } from "vitest";
import {
  DurationDistSchema,
  IdSchema,
  IsoDateTimeSchema,
  LINE_TYPES,
  LineTypeSchema,
  LocalizedTextSchema,
  ObservableKindSchema,
} from "../src/index.ts";

describe("IdSchema", () => {
  it.each(["a", "person_accident", "obs_1"])("%s を受け入れる", (id) => {
    expect(IdSchema.safeParse(id).success).toBe(true);
  });
  it.each(["", "1abc", "Abc", "a-b", "_a", "a b"])("%s を拒否する", (id) => {
    expect(IdSchema.safeParse(id).success).toBe(false);
  });
});

describe("LocalizedTextSchema", () => {
  it("en を省略できる", () => {
    expect(LocalizedTextSchema.safeParse({ ja: "あ" }).success).toBe(true);
  });
  it("空文字と未知のキーを拒否する", () => {
    expect(LocalizedTextSchema.safeParse({ ja: "" }).success).toBe(false);
    expect(LocalizedTextSchema.safeParse({ ja: "あ", en: "" }).success).toBe(false);
    expect(LocalizedTextSchema.safeParse({ ja: "あ", zh: "啊" }).success).toBe(false);
  });
});

describe("DurationDistSchema", () => {
  it("p80 >= p50 を受け入れる", () => {
    expect(DurationDistSchema.safeParse({ p50: 10, p80: 10 }).success).toBe(true);
    expect(DurationDistSchema.safeParse({ p50: 0, p80: 30 }).success).toBe(true);
  });
  it.each([
    { p50: 20, p80: 10 },
    { p50: null, p80: 10 },
    { p50: -1, p80: 10 },
    { p50: 1.5, p80: 10 },
    { p50: 10 },
  ])("%o を拒否する", (value) => {
    expect(DurationDistSchema.safeParse(value).success).toBe(false);
  });
});

describe("IsoDateTimeSchema", () => {
  it("オフセット付きを受け入れる", () => {
    expect(IsoDateTimeSchema.safeParse("2026-11-05T22:40:00+09:00").success).toBe(true);
    expect(IsoDateTimeSchema.safeParse("2026-11-05T13:40:00Z").success).toBe(true);
  });
  it("オフセットなしと日付だけを拒否する", () => {
    expect(IsoDateTimeSchema.safeParse("2026-11-05T22:40:00").success).toBe(false);
    expect(IsoDateTimeSchema.safeParse("2026-11-05").success).toBe(false);
  });
});

describe("ObservableKindSchema", () => {
  it("train_movement を含み未知の値を拒否する", () => {
    expect(ObservableKindSchema.safeParse("train_movement").success).toBe(true);
    expect(ObservableKindSchema.safeParse("sns").success).toBe(false);
  });
});

describe("LineTypeSchema", () => {
  it("tram を含み未知の値を拒否する", () => {
    expect(LINE_TYPES).toContain("tram");
    expect(LineTypeSchema.safeParse("tram").success).toBe(true);
    expect(LineTypeSchema.safeParse("shinkansen").success).toBe(false);
  });
});
