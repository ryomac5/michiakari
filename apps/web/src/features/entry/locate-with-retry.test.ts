import { describe, expect, it, vi } from "vitest";
import { locateWithRetry } from "./locate-with-retry";

type Get = Parameters<typeof locateWithRetry>[0];

const coords = { latitude: 34.7, longitude: 135.5, accuracy: 20 };

describe("locateWithRetry", () => {
  it("1 回目で成功すれば取り直さない", async () => {
    const get = vi.fn<Get>((ok) => ok({ coords }));
    expect(await locateWithRetry(get)).toEqual({ kind: "located", coords });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: true, timeout: 8_000 });
  });

  it("1 回目が時間切れでも、低精度の 2 回目で成功する", async () => {
    const get = vi
      .fn<Get>()
      .mockImplementationOnce((_ok, fail) => fail({ code: 3 }))
      .mockImplementationOnce((ok) => ok({ coords }));
    expect(await locateWithRetry(get)).toEqual({ kind: "located", coords });
    expect(get.mock.calls[1]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 300_000,
    });
  });

  it("2 回とも失敗すれば unavailable", async () => {
    const get = vi.fn<Get>((_ok, fail) => fail({ code: 2 }));
    expect(await locateWithRetry(get)).toEqual({ kind: "unavailable" });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("許可が無ければ取り直さず denied", async () => {
    const get = vi.fn<Get>((_ok, fail) => fail({ code: 1 }));
    expect(await locateWithRetry(get)).toEqual({ kind: "denied" });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
