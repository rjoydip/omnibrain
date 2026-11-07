import { join } from "node:path";
import { Glob } from "bun";

const projects = [
  "tsconfig.json",
  ...new Glob("{apps,packages}/*/tsconfig.json")
    .scanSync({ cwd: import.meta.dir + "/.." })
    .map((p) => p),
];

let failed = 0;
for (const project of projects) {
  const cwd = join(import.meta.dir, "..");
  const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "-p", project], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) failed++;
  console.log(`${code === 0 ? "ok  " : "FAIL"} ${project}`);
}

if (failed > 0) {
  console.error(`\n${failed} project(s) failed typecheck`);
  process.exit(1);
}
console.log(`\nall ${projects.length} projects typecheck`);
