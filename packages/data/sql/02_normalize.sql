-- 事業者名・路線名の正規化と、対象外の路線の除外
-- operator_map, line_rename, excluded_* は build.ts が config/ から作る
-- 路線名の「1号線(御堂筋線)」のような表記は括弧内の愛称にする

CREATE TABLE station AS
SELECT
  coalesce(o.operator_key, 'op-' || s.raw_operator) AS operator_key,
  coalesce(o.operator_name, s.raw_operator) AS operator_name,
  coalesce(r.line_name, regexp_replace(s.raw_line, '^.*\((.+)\)$', '\1')) AS line_name,
  s.name,
  s.code,
  s.group_code,
  s.geom
FROM raw_station s
LEFT JOIN operator_map o ON o.raw_operator = s.raw_operator
LEFT JOIN line_rename r ON r.raw_operator = s.raw_operator AND r.raw_line = s.raw_line
WHERE s.railway_class NOT IN (SELECT value FROM excluded_railway_class)
  AND s.operator_class NOT IN (SELECT value FROM excluded_operator_class)
  AND s.raw_operator NOT IN (SELECT value FROM excluded_operator);

CREATE TABLE section AS
SELECT
  coalesce(o.operator_key, 'op-' || s.raw_operator) AS operator_key,
  coalesce(r.line_name, regexp_replace(s.raw_line, '^.*\((.+)\)$', '\1')) AS line_name,
  s.geom
FROM raw_section s
LEFT JOIN operator_map o ON o.raw_operator = s.raw_operator
LEFT JOIN line_rename r ON r.raw_operator = s.raw_operator AND r.raw_line = s.raw_line
WHERE s.railway_class NOT IN (SELECT value FROM excluded_railway_class)
  AND s.operator_class NOT IN (SELECT value FROM excluded_operator_class)
  AND s.raw_operator NOT IN (SELECT value FROM excluded_operator);

-- 対象エリアに駅が一つでもある路線
CREATE TABLE target_line AS
SELECT DISTINCT s.operator_key, s.operator_name, s.line_name
FROM station s, area a
WHERE ST_Intersects(s.geom, a.geom);

-- 乗降客数を駅コードごとにまとめる
-- 合算先がある重複の行は、同じグループ・同じ事業者の合算先の値を使う
CREATE TABLE passenger_by_code AS
WITH normalized AS (
  SELECT r.*, coalesce(o.operator_key, r.raw_operator) AS operator_key
  FROM raw_passengers r
  LEFT JOIN operator_map o ON o.raw_operator = r.raw_operator
),
filled AS (
  SELECT
    code,
    CASE
      WHEN duplicate = 2 THEN max(CASE WHEN duplicate = 1 THEN passengers END)
        OVER (PARTITION BY group_code, operator_key)
      ELSE passengers
    END AS passengers
  FROM normalized
)
SELECT code, max(passengers) AS passengers
FROM filled
GROUP BY code;
