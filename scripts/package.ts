import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export const run = promisify(execFile);
export const root = resolve(import.meta.dirname, "..");
export async function pack() {
  const directory = await mkdtemp(join(tmpdir(), "jotai-devframe-package-"));
  const path = join(directory, "package.tgz");
  await run("pnpm", ["pack", "--json", "--out", path], { cwd: root });
  return { directory, path, data: await readFile(path) };
}
