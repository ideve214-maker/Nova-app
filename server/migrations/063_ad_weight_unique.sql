-- 063：未删除营销帖的权重唯一。
-- 先把重复权重重新分配（每个重复组里保留 created_at、id 最早的那条，其余按原权重、创建时间、id 的顺序，从当前最大权重 +1 起往后排，不填空位），再加部分 UNIQUE 索引。
-- 编号 063：用户端导入是 062_import_feed；本迁移排在后面。
-- 本文件不要写 BEGIN/COMMIT：迁移程序会把整个文件放在一个事务里执行。

CREATE TEMP TABLE IF NOT EXISTS adweight_dup_shift AS
SELECT a.id AS id,
  (SELECT COALESCE(MAX(weight), 0) FROM marketing_ads WHERE deleted_at IS NULL)
  + ROW_NUMBER() OVER (ORDER BY a.weight ASC, a.created_at ASC, a.id ASC) AS new_weight
FROM marketing_ads a
WHERE a.deleted_at IS NULL
  AND a.id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY weight ORDER BY created_at ASC, id ASC) AS rn
      FROM marketing_ads
      WHERE deleted_at IS NULL
    )
    WHERE rn = 1
  );

UPDATE marketing_ads
SET weight = (SELECT new_weight FROM adweight_dup_shift WHERE adweight_dup_shift.id = marketing_ads.id)
WHERE id IN (SELECT id FROM adweight_dup_shift);

DROP TABLE IF EXISTS adweight_dup_shift;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ads_weight_alive
  ON marketing_ads(weight) WHERE deleted_at IS NULL;
