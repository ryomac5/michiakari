"use client";

import { useCallback, useState } from "react";
import type { GpsPoint } from "./gps-candidates";
import { locateWithRetry } from "./locate-with-retry";

// 押したときだけ端末の位置を 1 度取る。位置は保存も送信もしない

export type GpsFailure = "denied" | "unavailable" | "unsupported";

export type GpsStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "located"; point: GpsPoint }
  | { kind: "failed"; reason: GpsFailure };

export function useGpsPosition() {
  const [status, setStatus] = useState<GpsStatus>({ kind: "idle" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "failed", reason: "unsupported" });
      return;
    }
    setStatus({ kind: "locating" });
    void locateWithRetry((ok, fail, options) =>
      navigator.geolocation.getCurrentPosition(ok, fail, options),
    ).then((outcome) =>
      setStatus(
        outcome.kind === "located"
          ? {
              kind: "located",
              point: {
                lat: outcome.coords.latitude,
                lon: outcome.coords.longitude,
                accuracy: outcome.coords.accuracy,
              },
            }
          : { kind: "failed", reason: outcome.kind },
      ),
    );
  }, []);

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, locate, reset };
}
