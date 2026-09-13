import type { Assets } from './render';
type Manifest = Record<string, { file: string; imports?: string[]; css?: string[] }>;
export function productionAssets(manifest: Manifest): Assets {
  const entry = manifest['src/app/entry-client.tsx'];
  const imports = new Set<string>();
  const visit = (key: string) => {
    for (const dependency of manifest[key]?.imports ?? []) {
      if (imports.has(dependency)) continue;
      imports.add(dependency);
      visit(dependency);
    }
  };
  visit('src/app/entry-client.tsx');
  return {
    scripts: ['/' + entry.file],
    css: [...new Set(Object.values(manifest).flatMap((m) => m.css ?? []))].map(
      (file) => '/' + file,
    ),
    preloads: [...imports].map((key) => '/' + manifest[key].file),
  };
}
