import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 徒歩経路の前処理で使う場所。.cache/ は git 管理外

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// pbf と Valhalla のタイルの置き場所。infra/valhalla/compose.yaml が /custom_files に割り当てる
export const VALHALLA_CACHE_DIR = join(PACKAGE_DIR, ".cache", "valhalla");
export const GEO_DATA_DIR = join(PACKAGE_DIR, "..", "geo", "data");
export const VALHALLA_COMPOSE_FILE = join(
  PACKAGE_DIR,
  "..",
  "..",
  "infra",
  "valhalla",
  "compose.yaml",
);
