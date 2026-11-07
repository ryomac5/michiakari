// 位置の取得。高精度で取れなければ、低精度で 1 度だけ取り直す。許可が無いときは取り直さない

export type LocatedCoords = { latitude: number; longitude: number; accuracy: number };

export type LocateOutcome =
  | { kind: "located"; coords: LocatedCoords }
  | { kind: "denied" }
  | { kind: "unavailable" };

type GetCurrentPosition = (
  success: (position: { coords: LocatedCoords }) => void,
  failure: (error: { code: number }) => void,
  options: PositionOptions,
) => void;

const PERMISSION_DENIED = 1;

const FIRST_TRY: PositionOptions = { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 };
const RETRY: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 };

function requestPosition(
  getCurrentPosition: GetCurrentPosition,
  options: PositionOptions,
): Promise<LocateOutcome> {
  return new Promise((resolve) => {
    getCurrentPosition(
      ({ coords }) => resolve({ kind: "located", coords }),
      (error) => resolve({ kind: error.code === PERMISSION_DENIED ? "denied" : "unavailable" }),
      options,
    );
  });
}

export async function locateWithRetry(
  getCurrentPosition: GetCurrentPosition,
): Promise<LocateOutcome> {
  const first = await requestPosition(getCurrentPosition, FIRST_TRY);
  if (first.kind !== "unavailable") return first;
  return requestPosition(getCurrentPosition, RETRY);
}
