import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparePortableTree } from "./build-fork-release.mjs";

test("portable tree publishes workspace exports and preserves internal links", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-release-test-"));
  try {
    const server = join(root, "node_modules/.pnpm/server");
    await mkdir(server, { recursive: true });
    await mkdir(join(root, "node_modules/@paperclipai"));
    await writeFile(join(server, "package.json"), JSON.stringify({
      name: "@paperclipai/server", version: "0.3.1", exports: "./src/index.ts",
      publishConfig: { exports: { ".": "./dist/index.js" } }, dependencies: { "@paperclipai/shared": "workspace:*" },
    }));
    await symlink("../.pnpm/server", join(root, "node_modules/@paperclipai/server"));
    await preparePortableTree(root);
    const manifest = JSON.parse(await readFile(join(server, "package.json"), "utf8"));
    assert.deepEqual(manifest.exports, { ".": "./dist/index.js" });
    assert.equal(manifest.dependencies["@paperclipai/shared"], "0.3.1");
    assert.equal(manifest.publishConfig, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("portable tree rejects links into the producer checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-release-link-"));
  try {
    await symlink(tmpdir(), join(root, "escape"));
    await assert.rejects(preparePortableTree(root), /External release symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installer keeps existing non-symlink commands intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-release-install-"));
  try {
    const release = join(root, "release");
    const prefix = join(root, "prefix");
    await mkdir(join(release, "app/dist"), { recursive: true });
    await mkdir(join(prefix, "bin"), { recursive: true });
    await writeFile(join(release, "app/dist/index.js"), "");
    await writeFile(join(release, "install.sh"), await readFile(new URL("./install-fork-release.sh", import.meta.url)));
    await writeFile(join(prefix, "bin/paperclipai"), "keep me");
    assert.throws(() => execFileSync("sh", [join(release, "install.sh"), prefix], { stdio: "pipe" }));
    assert.equal(await readFile(join(prefix, "bin/paperclipai"), "utf8"), "keep me");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installer creates a working command without retaining the extracted source", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-release-command-"));
  try {
    const release = join(root, "release");
    const prefix = join(root, "prefix");
    await mkdir(join(release, "app/dist"), { recursive: true });
    await writeFile(join(release, "app/package.json"), '{"type":"module"}');
    await writeFile(join(release, "app/dist/message.js"), 'export default "installed-fork";');
    await writeFile(join(release, "app/dist/index.js"), '#!/usr/bin/env node\nimport message from "./message.js"; console.log(message);');
    await writeFile(join(release, "install.sh"), await readFile(new URL("./install-fork-release.sh", import.meta.url)));
    execFileSync("sh", [join(release, "install.sh"), prefix]);
    await rm(release, { recursive: true, force: true });
    assert.equal(execFileSync(join(prefix, "bin/paperclipai"), { encoding: "utf8" }).trim(), "installed-fork");
  } finally { await rm(root, { recursive: true, force: true }); }
});
