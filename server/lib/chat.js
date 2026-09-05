import path from "path";
import fs from "fs";
import { DATA_DIR, appendJsonl, readJsonlTail } from "./store.js";

export function globalChatPath() {
  return path.join(DATA_DIR, "chat", "global.jsonl");
}

export function gameChatPath(code) {
  const safe = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const dir = path.join(DATA_DIR, "chat", "games");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe}.jsonl`);
}

export function dmPairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

export function dmPath(a, b) {
  const dir = path.join(DATA_DIR, "dm");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${dmPairKey(a, b)}.jsonl`);
}

export function dmIndexPath(userId) {
  const dir = path.join(DATA_DIR, "dm", "index");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${userId}.json`);
}

export function readChatTail(file, n = 150) {
  return readJsonlTail(file, n);
}

export function writeChat(file, msg) {
  appendJsonl(file, msg);
}
