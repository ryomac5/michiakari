-- 元データの読み込み。{{...}} は build.ts が差し込む
-- 測地系 JGD2011 は WGS84 とほぼ同じなので、座標参照系の型は外して扱う

CREATE TABLE area AS
SELECT ST_Union_Agg(geom::GEOMETRY) AS geom
FROM ST_Read('{{AREA_PATH}}');

CREATE TABLE raw_station AS
SELECT
  N02_001 AS railway_class,
  N02_002 AS operator_class,
  N02_003 AS raw_line,
  N02_004 AS raw_operator,
  N02_005 AS name,
  N02_005c AS code,
  N02_005g AS group_code,
  geom::GEOMETRY AS geom
FROM ST_Read('{{STATION_PATH}}');

CREATE TABLE raw_section AS
SELECT
  N02_001 AS railway_class,
  N02_002 AS operator_class,
  N02_003 AS raw_line,
  N02_004 AS raw_operator,
  geom::GEOMETRY AS geom
FROM ST_Read('{{SECTION_PATH}}');

-- 乗降客数は最新年度を使い、値がなければ前の年度にさかのぼる
-- 年度ごとに「重複・有無・備考・乗降客数」の4列が並ぶ。有無が 1 のとき値がある
-- 重複が 2 の行は同じ事業者の別路線の行に合算されていて、値は 0 になっている
CREATE TABLE raw_passengers AS
SELECT
  S12_001c AS code,
  S12_001g AS group_code,
  S12_002 AS raw_operator,
  S12_058 AS duplicate,
  CASE
    WHEN S12_059 = 1 THEN S12_061
    WHEN S12_055 = 1 THEN S12_057
    WHEN S12_051 = 1 THEN S12_053
  END AS passengers
FROM ST_Read('{{PASSENGER_PATH}}');
