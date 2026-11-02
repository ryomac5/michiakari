-- 地図用の路線の形。路線ごとに区間をまとめ、対象エリアで切り出して単純化する
-- 単純化の許容誤差は約3m（0.00003度）

SELECT
  s.operator_key,
  s.line_name,
  ST_AsGeoJSON(
    ST_SimplifyPreserveTopology(
      ST_LineMerge(ST_Intersection(ST_Union_Agg(s.geom), any_value(a.geom))),
      0.00003
    )
  ) AS geometry
FROM section s
JOIN target_line t USING (operator_key, line_name)
CROSS JOIN area a
GROUP BY s.operator_key, s.line_name
ORDER BY s.operator_key, s.line_name;
