"use client";

import { useCallback, useState } from "react";
import type { GpsPoint } from "./gps-candidates";

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
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setStatus({
          kind: "located",
          point: { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy },
        }),
      (error) =>
        setStatus({
          kind: "failed",
          reason: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, locate, reset };
}
