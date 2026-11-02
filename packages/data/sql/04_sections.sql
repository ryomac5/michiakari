-- 対象路線の線路区間（切り出す前の全体）。駅の並びを線路のつながりから求めるのに使う

SELECT
  s.operator_key,
  s.line_name,
  ST_AsGeoJSON(s.geom) AS geometry
FROM section s
JOIN target_line t USING (operator_key, line_name)
ORDER BY s.operator_key, s.line_name;
