-- 府県別の P11 を 1 つずつ読み込む。{{...}} は bus-build.ts が差し込む
-- 測地系 JGD2011 は WGS84 とほぼ同じなので、座標参照系の型は外して扱う
-- レコードの番号は元ファイルの並び順。threads を 1 にして並びを保つ

CREATE TABLE IF NOT EXISTS raw_bus_stop (
  dataset VARCHAR,
  record BIGINT,
  name VARCHAR,
  raw_operator VARCHAR,
  lon DOUBLE,
  lat DOUBLE
);

INSERT INTO raw_bus_stop
SELECT
  '{{DATASET}}' AS dataset,
  row_number() OVER () AS record,
  P11_001 AS name,
  P11_002 AS raw_operator,
  ST_X(geom::GEOMETRY) AS lon,
  ST_Y(geom::GEOMETRY) AS lat
FROM ST_Read('{{PATH}}');
