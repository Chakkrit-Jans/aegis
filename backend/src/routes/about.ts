import { Router } from "express";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { redisPub } from "../lib/redis.js";
import { getLicenseResult } from "../edition/service.js";
import { getEnabledWorkers } from "../workers/registry.js";
import { workerExecStatus, workerHealth } from "../worker/exec.js";

const nodeRequire = createRequire(import.meta.url);
function pkgVer(name: string): string {
  try {
    return (nodeRequire(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "n/a";
  }
}

let APP_VERSION = "0.1.0";
try {
  APP_VERSION = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).version;
} catch {
  /* keep default */
}

export const aboutRouter = Router();

// System/version info for the About dialog.
aboutRouter.get("/", async (_req, res) => {
  const lic = await getLicenseResult();

  let mongodb = "n/a";
  try {
    const info = await mongoose.connection.db?.admin().buildInfo();
    mongodb = info?.version ?? "n/a";
  } catch {
    /* ignore */
  }

  let redis = "n/a";
  try {
    const s = await redisPub.info("server");
    redis = /redis_version:(.+)/.exec(s)?.[1]?.trim() ?? "n/a";
  } catch {
    /* ignore */
  }

  res.json({
    app: {
      name: "Aegis",
      version: APP_VERSION,
      git: process.env.AEGIS_GIT_COMMIT || "dev",
      description: "Autonomous, human-in-the-loop AI penetration-testing orchestration. The AI plans and drives an authorized engagement while every active/intrusive action passes a scope gate and a human approval gate; results become a client-ready report.",
    },
    edition: lic.edition,
    license:
      lic.edition === "enterprise"
        ? { org: lic.org ?? null, expires: lic.expires ?? null }
        : lic.error
          ? { error: lic.error }
          : null,
    runtime: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptimeSec: Math.round(process.uptime()),
    },
    services: { mongodb, redis },
    components: [
      { name: "Express", version: pkgVer("express") },
      { name: "Socket.IO", version: pkgVer("socket.io") },
      { name: "Mongoose", version: pkgVer("mongoose") },
      { name: "ioredis", version: pkgVer("ioredis") },
      { name: "jsonwebtoken", version: pkgVer("jsonwebtoken") },
      { name: "bcryptjs", version: pkgVer("bcryptjs") },
    ],
  });
});

// Version flags for each allow-listed Kali tool.
const VERSION_ARGS: Record<string, string[]> = {
  nmap: ["--version"],
  nuclei: ["-version"],
  ffuf: ["-V"],
  gobuster: ["--version"],
  nikto: ["-Version"],
  whatweb: ["--version"],
  hydra: ["-h"],
  dig: ["-v"],
};

function parseVer(bin: string, out: string): string {
  const clean = out.replace(/\r/g, "");
  if (/not installed|command not found|no help topic|unknown command|unreachable|offline|unauthorized|allow-list/i.test(clean))
    return "n/a";
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  // Prefer a line that names the tool or says "version" (skips ASCII banners and
  // usage examples that contain unrelated numbers like example IPs).
  const rx = new RegExp(`(?:${bin}|version)`, "i");
  const target = lines.find((l) => rx.test(l) && /\d+\.\d+/.test(l)) ?? lines.find((l) => /\d+\.\d+/.test(l)) ?? "";
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(target);
  return m ? m[1] : (lines[0]?.slice(0, 24) ?? "?");
}

// Live tool versions from the (default enabled) Kali worker. Loaded lazily by the
// About dialog since it runs several probes on the worker.
aboutRouter.get("/worker-tools", async (_req, res) => {
  const workers = await getEnabledWorkers();
  if (!workers.length) return res.json({ worker: null, tools: [], error: "no enabled worker configured" });
  const w = workers[0];
  const health = await workerHealth(w.ref);
  if (!health.ok) return res.json({ worker: w.name, tools: [], error: health.error ?? "worker offline" });

  const bins = Object.keys(VERSION_ARGS);
  const tools = await Promise.all(
    bins.map(async (bin) => {
      const r = await workerExecStatus(w.ref, bin, VERSION_ARGS[bin], 12_000);
      return { name: bin, version: r.reachable ? parseVer(bin, r.output) : "unreachable" };
    })
  );
  res.json({ worker: w.name, tools });
});
