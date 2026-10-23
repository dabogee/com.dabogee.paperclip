#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { materializePublishManifest, prepareBundledPackage } from "./prepare-bundled-package.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, cwd = repo) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? accept() : reject(new Error(`${command} failed (${code})`)));
  });
}

/** Materialize workspace exports and reject dependencies on the producer checkout. */
export async function preparePortableTree(root) {
  const canonicalRoot = await realpath(root);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = relative(canonicalRoot, await realpath(file));
        assert.ok(!isAbsolute(target) && target !== ".." && !target.startsWith("../"), `External release symlink: ${file}`);
      } else if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.name === "package.json") {
        const pkg = JSON.parse(await readFile(file, "utf8"));
        if (!pkg.name?.startsWith("@paperclipai/") && pkg.name !== "paperclipai") continue;
        // Break deploy/store hardlinks before rewriting a manifest.
        const temporary = `${file}.fork-release.tmp`;
        await writeFile(temporary, JSON.stringify(materializePublishManifest(pkg), null, 2) + "\n");
        await rename(temporary, file);
      }
    }
  }
  await walk(canonicalRoot);
}

async function main() {
  const [tag, outputDirectory] = process.argv.slice(2);
  assert.match(tag ?? "", /^headroom-v[0-9][0-9A-Za-z.-]*$/, "Use a headroom-vVERSION release tag");
  assert.ok(outputDirectory, "Usage: build-fork-release.mjs headroom-vVERSION OUTPUT_DIRECTORY");
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "paperclip-fork-release-"));
  try {
    const name = `paperclip-${tag}-${process.platform}-${process.arch}`;
    const release = join(temporary, name);
    const app = join(release, "app");
    await mkdir(release);
    await run("pnpm", ["--filter", "paperclipai", "deploy", "--prod", "--ignore-scripts", "--shamefully-hoist", app]);
    // pnpm 9 hoists the deployed package's self-reference back to its source.
    const selfLink = join(app, "node_modules/paperclipai");
    const self = await lstat(selfLink).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (self) {
      assert.ok(self.isSymbolicLink(), "Expected a deploy self-reference symlink");
      await rm(selfLink);
      await symlink("..", selfLink);
    }
    // Deploy alone omits transitive dependencies of upstream's bundled packages.
    const packages = JSON.parse(await readFile(join(repo, "scripts/release-package-manifest.json"), "utf8"));
    for (const entry of packages) {
      const source = join(repo, entry.dir);
      const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      if (!(pkg.bundleDependencies ?? pkg.bundledDependencies)?.length) continue;
      const destination = await realpath(join(app, "node_modules", pkg.name));
      prepareBundledPackage(source, destination, { sourceRoot: repo });
    }
    await preparePortableTree(app);
    const server = join(app, "node_modules/@paperclipai/server");
    assert.match(await readFile(join(server, "dist/services/codex-subscription-proxy.js"), "utf8"), /PAPERCLIP_CODEX_SUBSCRIPTION_PROXY_URL/);
    await readFile(join(server, "ui-dist/index.html"));
    await cp(join(repo, "LICENSE"), join(release, "LICENSE"));
    await cp(join(repo, "doc/HEADROOM-FORK.md"), join(release, "README.md"));
    await cp(join(repo, "scripts/install-fork-release.sh"), join(release, "install.sh"));
    await writeFile(join(release, "paperclipai"), '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$root/app/dist/index.js" "$@"\n', { mode: 0o755 });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    await writeFile(join(release, "release.json"), JSON.stringify({ tag, platform: process.platform, arch: process.arch, commit }, null, 2) + "\n");
    // Running the deployed CLI verifies published exports outside the checkout.
    await run(process.execPath, [join(app, "dist/index.js"), "--version"], temporary);
    await run(process.execPath, [join(server, "scripts/install-copilot-assets.mjs")], temporary);
    await run(process.execPath, ["--input-type=module", "-e", `const { startServer } = await import(${JSON.stringify(pathToFileURL(join(server, "dist/index.js")).href)}); if (typeof startServer !== "function") throw new Error("Packaged server entry point is missing");`], temporary);
    await run("tar", ["-czf", join(output, `${name}.tar.gz`), "-C", temporary, name]);
    const checksum = createHash("sha256");
    for await (const chunk of createReadStream(join(output, `${name}.tar.gz`))) checksum.update(chunk);
    await writeFile(join(output, `${name}.tar.gz.sha256`), `${checksum.digest("hex")}  ${name}.tar.gz\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
