"use client";

import { useCallback, useState } from "react";

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
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus("idle");
        onLocated({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => setStatus("failed"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [onLocated]);

  return { status, locate };
}
