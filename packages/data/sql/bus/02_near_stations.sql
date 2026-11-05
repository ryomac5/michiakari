-- 駅の代表点を囲む四角の内側にある停留所を残す。正確な距離は bus-build.ts が core で確かめる
-- 名前の空、座標の範囲外、同じ版の同じレコードの重複を除く
-- {{RADIUS_LAT}} と {{RADIUS_LON}} は駅からの距離の上限を度に直した値

CREATE TABLE station_point AS
SELECT DISTINCT ST_X(geom::GEOMETRY) AS lon, ST_Y(geom::GEOMETRY) AS lat
FROM ST_Read('{{STATIONS_PATH}}');

SELECT DISTINCT
  b.dataset,
  b.record,
  trim(b.name) AS name,
  b.raw_operator,
  b.lon,
  b.lat
FROM raw_bus_stop b
JOIN station_point s
  ON s.lat BETWEEN b.lat - {{RADIUS_LAT}} AND b.lat + {{RADIUS_LAT}}
  AND s.lon BETWEEN b.lon - {{RADIUS_LON}} AND b.lon + {{RADIUS_LON}}
WHERE coalesce(trim(b.name), '') <> ''
  AND coalesce(trim(b.raw_operator), '') <> ''
  AND b.lon BETWEEN 134 AND 137
  AND b.lat BETWEEN 33 AND 36
ORDER BY b.dataset, b.record;
