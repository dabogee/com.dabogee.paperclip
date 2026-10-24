import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { managedInstallChecks } from "../checks/managed-install-check.js";
import {
  MANAGED_STORE_MARKER,
  MANAGED_SHIM_MARKER,
  buildNextManifest,
  flipCurrentAtomic,
  resolveInstallStorePaths,
  writeInstallManifestAtomic,
  writeManagedShim,
} from "../install-store.js";

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
});

describe("managed install doctor checks", () => {
  it("allows a portable fork symlink with a separate project home", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-fork-doctor-"));
    try {
      const paths = resolveInstallStorePaths({
        paperclipHome: path.join(root, "project", ".paperclip"),
        homeDir: root,
      });
      const entrypoint = path.join(root, ".local/lib/paperclip-headroom/app/dist/index.js");
      fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
      // The bundled CLI contains the marker string in its own implementation.
      fs.writeFileSync(entrypoint, `#!/usr/bin/env node\nconst marker = ${JSON.stringify(MANAGED_SHIM_MARKER)};\n`);
      fs.mkdirSync(path.dirname(paths.shimPath), { recursive: true });
      fs.symlinkSync(entrypoint, paths.shimPath);
      fs.mkdirSync(paths.cliRoot, { recursive: true });
      fs.writeFileSync(path.join(paths.cliRoot, "update-check.json"), "{}\n");

      expect(managedInstallChecks(paths)).toEqual([
        expect.objectContaining({ name: "Managed install", status: "pass" }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("still rejects a managed shim whose manifest is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-shim-doctor-"));
    try {
      const paths = resolveInstallStorePaths({ paperclipHome: path.join(root, ".paperclip"), homeDir: root });
      writeManagedShim(paths);

      expect(managedInstallChecks(paths)).toEqual([
        expect.objectContaining({ name: "Managed install manifest", status: "fail" }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes for a consistent store, manifest, current link, shim, and PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-install-doctor-"));
    const paths = resolveInstallStorePaths({
      paperclipHome: path.join(root, ".paperclip"),
      homeDir: root,
    });
    const payloadPath = path.join(paths.installsRoot, "npm", "1.2.3");
    fs.mkdirSync(path.join(payloadPath, "dist"), { recursive: true });
    const manifest = buildNextManifest(
      {
        source: "npm",
        version: "1.2.3",
        channel: "latest",
        payloadPath,
        installedAt: "2026-07-22T00:00:00.000Z",
      },
      null,
    );
    flipCurrentAtomic(payloadPath, paths);
    writeInstallManifestAtomic(manifest, paths);
    writeManagedShim(paths);
    process.env.PATH = `${path.dirname(paths.shimPath)}${path.delimiter}${originalPath ?? ""}`;

    expect(managedInstallChecks(paths).every((result) => result.status === "pass")).toBe(true);
  });

  it("fails when managed artifacts exist without a manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-install-doctor-"));
    const paths = resolveInstallStorePaths({
      paperclipHome: path.join(root, ".paperclip"),
      homeDir: root,
    });
    fs.mkdirSync(paths.cliRoot, { recursive: true });
    fs.writeFileSync(paths.markerPath, MANAGED_STORE_MARKER);

    expect(managedInstallChecks(paths)).toEqual([
      expect.objectContaining({ name: "Managed install manifest", status: "fail" }),
    ]);
  });

  it("ignores the shared CLI directory when it only contains update notice state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-install-doctor-"));
    const paths = resolveInstallStorePaths({
      paperclipHome: path.join(root, ".paperclip"),
      homeDir: root,
    });
    fs.mkdirSync(paths.cliRoot, { recursive: true });
    fs.writeFileSync(path.join(paths.cliRoot, "update-check.json"), "{}\n");

    expect(managedInstallChecks(paths)).toEqual([
      expect.objectContaining({ name: "Managed install", status: "pass" }),
    ]);
  });

  it("ignores an empty installs directory left by a harmless lock lifecycle", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-install-doctor-"));
    const paths = resolveInstallStorePaths({
      paperclipHome: path.join(root, ".paperclip"),
      homeDir: root,
    });
    fs.mkdirSync(paths.installsRoot, { recursive: true });

    expect(managedInstallChecks(paths)).toEqual([
      expect.objectContaining({ name: "Managed install", status: "pass" }),
    ]);
  });
});
