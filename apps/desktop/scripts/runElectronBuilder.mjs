import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const env = {
  ...process.env,
  PATH: `${desktopRoot}${path.delimiter}${process.env.PATH ?? ""}`
};

const child = spawn("electron-builder", ["--publish", "never"], {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: true,
  env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
