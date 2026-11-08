"use client";

import { useCallback, useState } from "react";
import { locateWithRetry } from "../entry/locate-with-retry";

// 端末の現在地を一度だけ取得する。位置は保存しない

export type LocateStatus = "idle" | "locating" | "failed" | "unsupported";

export function useCurrentLocation(onLocated: (point: { lat: number; lon: number }) => void) {
  const [status, setStatus] = useState<LocateStatus>("idle");

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    void locateWithRetry((ok, fail, options) =>
      navigator.geolocation.getCurrentPosition(ok, fail, options),
    ).then((outcome) => {
      if (outcome.kind !== "located") {
        setStatus("failed");
        return;
      }
      setStatus("idle");
      onLocated({ lat: outcome.coords.latitude, lon: outcome.coords.longitude });
    });
  }, [onLocated]);

  return { status, locate };
}
