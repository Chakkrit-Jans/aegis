import mongoose from "mongoose";
import { config } from "../config.js";
import { log } from "../lib/log.js";

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUrl);
  log.info(`MongoDB connected: ${config.mongoUrl}`);
}

const { Schema, model } = mongoose;

/** An engagement = one authorized assessment with scope + authorization. */
const EngagementSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    client: { type: String, default: "" },
    worker: { type: String, default: "" }, // worker id ("" = default worker)
    authorization: {
      granted: { type: Boolean, default: false },
      by: { type: String, default: "" },
      ref: { type: String, default: "" },
      at: { type: Date, default: null },
    },
    scope: {
      include: { type: [String], default: [] },
      exclude: { type: [String], default: [] },
    },
    findings: {
      type: [
        {
          title: String,
          severity: { type: String, default: "info" },
          confidence: { type: String, default: "certain" }, // certain | firm | tentative (Burp-style)
          cve: String, // e.g. "CVE-2025-69871" (optional; when the issue maps to a known CVE)
          cvss: Number, // CVSS base score 0.0–10.0 (optional)
          asset: String,
          description: String, // what the issue is (problem summary)
          impact: String, // the risk / business impact if exploited
          remediation: String, // concrete fix / prevention guidance
          detail: String, // legacy / extra evidence & notes (fallback for old findings)
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/** A session = one agent run against an engagement, with a transcript. */
const SessionSchema = new Schema(
  {
    engagement: { type: Schema.Types.ObjectId, ref: "Engagement", index: true },
    objective: { type: String, default: "" },
    autoApprove: { type: Boolean, default: false }, // run active tools without waiting for approval
    // Raw provider-facing conversation (system/user/assistant/tool), persisted
    // after each step so a backend restart can resume the loop where it left off.
    messages: { type: [Schema.Types.Mixed], default: [] },
    status: {
      type: String,
      enum: ["idle", "running", "waiting_approval", "stopped", "done", "error"],
      default: "idle",
    },
    // Full ordered transcript of the agent loop.
    transcript: {
      type: [
        {
          role: { type: String }, // user | assistant | tool | system | event
          content: { type: String, default: "" },
          tool: { type: String, default: "" },
          meta: { type: Schema.Types.Mixed, default: {} },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/** A pending approval for an active tool call — the human-in-the-loop gate. */
const ApprovalSchema = new Schema(
  {
    session: { type: Schema.Types.ObjectId, ref: "Session", index: true },
    tool: { type: String, required: true },
    args: { type: Schema.Types.Mixed, default: {} },
    rationale: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    decidedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

/** A console operator account. */
const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "operator"], default: "operator" },
  },
  { timestamps: true }
);

/** Immutable audit trail: who did what, when. Never edited, only appended. */
const AuditSchema = new Schema(
  {
    actor: { type: String, default: "system" }, // email or "agent" or "system"
    actorRole: { type: String, default: "" },
    action: { type: String, required: true, index: true }, // e.g. login, shell.exec, approval.approve
    target: { type: String, default: "" }, // engagement slug / session id / host
    detail: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: true }
);

/** A live shell command executed on the worker within an engagement. */
const ShellCommandSchema = new Schema(
  {
    engagement: { type: Schema.Types.ObjectId, ref: "Engagement", index: true },
    session: { type: Schema.Types.ObjectId, ref: "Session", default: null },
    actor: { type: String, default: "" }, // who ran it (operator email or "agent")
    command: { type: String, required: true },
    cwd: { type: String, default: "" },
    exitCode: { type: Number, default: null },
    output: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "running", "done", "error"],
      default: "pending",
    },
  },
  { timestamps: true }
);

/** Generic key/value settings store (used for the update scheduler config). */
const SettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Engagement = model("Engagement", EngagementSchema);
export const Session = model("Session", SessionSchema);
export const Approval = model("Approval", ApprovalSchema);
export const Setting = model("Setting", SettingSchema);
export const User = model("User", UserSchema);
export const Audit = model("Audit", AuditSchema);
export const ShellCommand = model("ShellCommand", ShellCommandSchema);
