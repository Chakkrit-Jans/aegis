import { Redis } from "ioredis";
import { config } from "../config.js";
import { log } from "./log.js";

// Two connections: a subscriber connection cannot issue normal commands, so
// publishing/reads go through `redisPub` and subscriptions through `redisSub`.
function make(label: string): Redis {
  const client = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  client.on("error", (e: Error) => log.error(`redis ${label}: ${e.message}`));
  return client;
}

export const redisPub = make("pub");
export const redisSub = make("sub");
