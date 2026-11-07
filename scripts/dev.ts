// One dev command: local SQLite API on :8787, Vite SPA on :5173.
const root = import.meta.dir + "/..";
const procs = [
  Bun.spawn(["bun", "run", "dev:api"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  }),
  Bun.spawn(["bun", "run", "dev:web"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  }),
];

const stop = () => {
  for (const p of procs) killTree(p);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await Promise.race(procs.map((p) => p.exited));
for (const p of procs) killTree(p);
process.exit(code);

function killTree(proc: Bun.Subprocess) {
  if (process.platform === "win32") {
    // `bun run` spawns Vite/Bun children; kill the whole tree so ports are released.
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return;
  }
  proc.kill();
}
