-- 対象路線の駅。駅コードごとに線データの中点を平均して代表点とし、乗降客数を結合する
-- 路線の外側の駅も残す（隣接駅の探索で境界の外の駅を通り抜けないため）

CREATE TABLE station_point AS
WITH merged AS (
  SELECT
    s.operator_key,
    s.line_name,
    s.code,
    any_value(s.operator_name) AS operator_name,
    any_value(s.name) AS name,
    avg(ST_X(ST_LineInterpolatePoint(s.geom, 0.5))) AS lon,
    avg(ST_Y(ST_LineInterpolatePoint(s.geom, 0.5))) AS lat,
    list(ST_AsGeoJSON(s.geom)) AS features
  FROM station s
  JOIN target_line t USING (operator_key, line_name)
  GROUP BY s.operator_key, s.line_name, s.code
)
SELECT
  m.*,
  ST_Within(ST_Point(m.lon, m.lat), a.geom) AS in_area,
  p.passengers
FROM merged m
CROSS JOIN area a
LEFT JOIN passenger_by_code p ON p.code = m.code;

SELECT
  operator_key,
  operator_name,
  line_name,
  code,
  name,
  lon,
  lat,
  in_area,
  passengers,
  features
FROM station_point
ORDER BY operator_key, line_name, code;
