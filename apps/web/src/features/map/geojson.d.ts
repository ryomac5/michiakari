// next.config.ts の turbopack ルールで .geojson を JSON として読む
declare module "*.geojson" {
  const value: unknown;
  export default value;
}
