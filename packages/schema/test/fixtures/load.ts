import { readFileSync } from "node:fs";
import { parse } from "yaml";

// test/fixtures の YAML を未検証の値として読む
export function readFixtureYaml(name: string): unknown {
  return parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
}
