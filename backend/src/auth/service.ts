import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { User } from "../db/mongo.js";
import { config } from "../config.js";
import { log } from "../lib/log.js";

// If no JWT_SECRET is configured, fall back to a random per-boot secret. Tokens
// then simply don't survive a restart — safer than shipping a hard-coded secret.
let secret = config.auth.jwtSecret;
if (!secret) {
  secret = randomBytes(32).toString("hex");
  log.warn("JWT_SECRET not set — using a random per-boot secret; sessions won't survive restarts.");
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

/** Create the first admin account if the user collection is empty. */
export async function seedAdmin(): Promise<void> {
  if ((await User.countDocuments()) > 0) return;
  const email = config.auth.adminEmail.toLowerCase().trim();
  let password = config.auth.adminPassword;
  let generated = false;
  if (!password) {
    password = randomBytes(9).toString("base64url");
    generated = true;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ email, passwordHash, role: "admin" });
  if (generated)
    log.warn(`Seeded admin '${email}' with GENERATED password: ${password}  — log in and change it.`);
  else log.info(`Seeded admin '${email}'.`);
}

function sign(user: { _id: unknown; email: string; role: string }): string {
  const payload: TokenPayload = { sub: String(user._id), email: user.email, role: user.role };
  return jwt.sign(payload, secret, { expiresIn: `${config.auth.tokenTtlHours}h` });
}

/** Issue an Aegis session token for an already-authenticated user (e.g. via SSO). */
export function signToken(user: { _id: unknown; email: string; role: string }): string {
  return sign(user);
}

/**
 * Resolve an SSO-authenticated email to an Aegis user. Returns the user, or null
 * when the user doesn't exist and auto-provisioning is off. Provisioned users get
 * a random password they never use (they log in only via SSO).
 */
export async function findOrProvisionUser(
  email: string,
  provision: boolean,
  role: string
): Promise<{ _id: unknown; email: string; role: string } | null> {
  const clean = email.toLowerCase().trim();
  const existing = await User.findOne({ email: clean });
  if (existing) return existing;
  if (!provision) return null;
  const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 12);
  return User.create({ email: clean, passwordHash, role: role === "admin" ? "admin" : "operator" });
}

/** Returns a signed JWT on success, or null on bad credentials. */
export async function login(email: string, password: string): Promise<string | null> {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return null;
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;
  return sign(user);
}

export function verify(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, secret) as TokenPayload;
  } catch {
    return null;
  }
}

export interface PublicUser {
  id: string;
  email: string;
  role: string;
  createdAt?: Date;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await User.find().sort({ createdAt: 1 }).lean();
  return users.map((u) => ({
    id: String(u._id),
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
  }));
}

/** Create an operator/admin account. Returns an error string, or "" on success. */
export async function createUser(email: string, password: string, role: string): Promise<string> {
  const clean = email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return "invalid email";
  if (password.length < 8) return "password must be at least 8 characters";
  if (role !== "admin" && role !== "operator") return "role must be admin or operator";
  if (await User.findOne({ email: clean })) return "a user with that email already exists";
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ email: clean, passwordHash, role });
  return "";
}

/** Delete a user by id. Refuses to remove the last remaining admin. */
export async function deleteUser(userId: string): Promise<string> {
  const user = await User.findById(userId);
  if (!user) return "user not found";
  if (user.role === "admin" && (await User.countDocuments({ role: "admin" })) <= 1)
    return "cannot delete the last admin";
  await User.deleteOne({ _id: userId });
  return "";
}

export async function changePassword(userId: string, current: string, next: string): Promise<string> {
  if (next.length < 8) return "new password must be at least 8 characters";
  const user = await User.findById(userId);
  if (!user) return "user not found";
  if (!(await bcrypt.compare(current, user.passwordHash))) return "current password is incorrect";
  user.passwordHash = await bcrypt.hash(next, 12);
  await user.save();
  return "";
}
