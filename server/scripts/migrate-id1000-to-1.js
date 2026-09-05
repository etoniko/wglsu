/**
 * One-shot: move user id 1000 → id 1 (first registrant got 1000 from early counter).
 * Run on server: node scripts/migrate-id1000-to-1.js
 * Or remotely via deploy SSH.
 */
import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  UPLOADS_DIR,
  loadUser,
  saveUser,
  userPath,
  readJson,
  writeJson,
  updateNickIndex,
  updateRatingIndex,
  removeFromRatingIndex,
  sessionsDir,
} from "../lib/store.js";

const FROM = 1000;
const TO = 1;

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function rewriteJsonl(file, mapFn) {
  if (!fs.existsSync(file)) return 0;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let changed = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const obj = JSON.parse(line);
      const mapped = mapFn(obj);
      if (mapped !== obj) changed++;
      return JSON.stringify(mapped);
    } catch {
      return line;
    }
  });
  if (changed) fs.writeFileSync(file, next.join("\n"), "utf8");
  return changed;
}

async function main() {
  const user = loadUser(FROM);
  if (!user) {
    console.log(`User ${FROM} not found — nothing to do`);
    process.exit(0);
  }
  if (loadUser(TO)) {
    console.error(`id${TO} already exists — abort`);
    process.exit(1);
  }

  console.log(`Migrating ${user.nick} id${FROM} → id${TO}`);

  const oldPath = userPath(FROM);
  user.id = TO;
  await saveUser(user);
  fs.unlinkSync(oldPath);

  await updateNickIndex(user.nick, TO);
  await updateRatingIndex(user);
  await removeFromRatingIndex(FROM);

  // sessions by-user index
  const byUserDir = path.join(sessionsDir(), "by-user");
  const oldSessIdx = path.join(byUserDir, `${FROM}.json`);
  const newSessIdx = path.join(byUserDir, `${TO}.json`);
  if (fs.existsSync(oldSessIdx)) {
    const tokens = readJson(oldSessIdx, []);
    for (const token of tokens) {
      const shard = token.slice(0, 2);
      const sp = path.join(sessionsDir(), shard, `${token}.json`);
      const s = readJson(sp, null);
      if (s) {
        s.userId = TO;
        await writeJson(sp, s);
      }
    }
    fs.renameSync(oldSessIdx, newSessIdx);
  }

  // DM folders / indexes
  const dmDir = path.join(DATA_DIR, "dm");
  const dmIndexDir = path.join(dmDir, "index");
  for (const file of walkFiles(dmDir)) {
    if (file.endsWith(".jsonl")) {
      rewriteJsonl(file, (m) => {
        let ch = false;
        if (m.fromId === FROM) {
          m.fromId = TO;
          ch = true;
        }
        if (m.toId === FROM) {
          m.toId = TO;
          ch = true;
        }
        if (m.userId === FROM) {
          m.userId = TO;
          ch = true;
        }
        return ch ? { ...m } : m;
      });
    } else if (file.endsWith(".json")) {
      let data = readJson(file, null);
      if (!data) continue;
      let ch = false;
      if (Array.isArray(data)) {
        data = data.map((row) => {
          if (row.peerId === FROM) {
            ch = true;
            return { ...row, peerId: TO };
          }
          if (row.userId === FROM) {
            ch = true;
            return { ...row, userId: TO };
          }
          return row;
        });
      }
      if (ch) await writeJson(file, data);
    }
  }
  // rename dm files that include 1000 in name (dm between users)
  for (const file of walkFiles(dmDir)) {
    const base = path.basename(file);
    if (base.includes(String(FROM))) {
      const neu = base
        .replace(new RegExp(`\\b${FROM}\\b`, "g"), String(TO))
        .replace(`${FROM}-`, `${TO}-`)
        .replace(`-${FROM}`, `-${TO}`);
      if (neu !== base) {
        fs.renameSync(file, path.join(path.dirname(file), neu));
      }
    }
  }
  if (fs.existsSync(path.join(dmIndexDir, `${FROM}.json`))) {
    fs.renameSync(path.join(dmIndexDir, `${FROM}.json`), path.join(dmIndexDir, `${TO}.json`));
  }

  // chat global + games
  const chatFiles = [
    path.join(DATA_DIR, "chat", "global.jsonl"),
    ...walkFiles(path.join(DATA_DIR, "chat", "games")).filter((f) => f.endsWith(".jsonl")),
  ];
  for (const file of chatFiles) {
    const n = rewriteJsonl(file, (m) => {
      if (m.userId === FROM) return { ...m, userId: TO };
      return m;
    });
    if (n) console.log(`chat rewritten ${n} in ${path.basename(file)}`);
  }

  // avatar file
  const avatars = path.join(UPLOADS_DIR, "avatars");
  for (const name of fs.existsSync(avatars) ? fs.readdirSync(avatars) : []) {
    if (name.startsWith(`${FROM}.`) || name.startsWith(`${FROM}-`)) {
      const neu = name.replace(String(FROM), String(TO));
      fs.renameSync(path.join(avatars, name), path.join(avatars, neu));
      if (user.avatar && user.avatar.includes(String(FROM))) {
        user.avatar = user.avatar.replace(String(FROM), String(TO));
        await saveUser(user);
        await updateRatingIndex(user);
      }
    }
  }

  // awards activity maps keyed by userId string
  const activity = path.join(DATA_DIR, "meta", "activity.json");
  if (fs.existsSync(activity)) {
    const data = readJson(activity, {});
    let ch = false;
    for (const bucket of Object.keys(data)) {
      for (const key of Object.keys(data[bucket] || {})) {
        const map = data[bucket][key];
        if (map && map[FROM] != null) {
          map[TO] = map[FROM];
          delete map[FROM];
          ch = true;
        }
        if (map && map[String(FROM)] != null) {
          map[String(TO)] = map[String(FROM)];
          delete map[String(FROM)];
          ch = true;
        }
      }
    }
    if (ch) await writeJson(activity, data);
  }

  // counter: next free id after max existing, at least 2
  const countersFile = path.join(DATA_DIR, "meta", "counters.json");
  const counters = readJson(countersFile, { nextUserId: 1 });
  counters.nextUserId = Math.max(2, Number(counters.nextUserId) === 1001 ? 2 : Number(counters.nextUserId));
  // if only user is id1, next should be 2
  counters.nextUserId = 2;
  await writeJson(countersFile, counters);

  console.log("Done. Нико is now id1. Next registrations: 2, 3, 4…");
  console.log("Verify:", loadUser(TO)?.nick, loadUser(FROM));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
