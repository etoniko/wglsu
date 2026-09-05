#!/usr/bin/env node
/** Deploy: DEPLOY_PASS=... node scripts/deploy.js */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const HOST = process.env.DEPLOY_HOST || "sixz.ru";
const USER = process.env.DEPLOY_USER || "root";
const PASS = process.env.DEPLOY_PASS || "";
const REMOTE_DIR = process.env.DEPLOY_DIR || "/var/www/wgl-cabinet";
const PORT = process.env.DEPLOY_PORT || "6020";
const SKIP = new Set(["node_modules", "data", "uploads", ".git"]);

if (!PASS) {
  console.error("Set DEPLOY_PASS");
  process.exit(1);
}

function walk(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (ent.isDirectory()) walk(full, base, out);
    else out.push({ full, rel });
  }
  return out;
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (out += d));
      stream.on("close", (code) => resolve({ code, out }));
    });
  });
}

function sftpMkdir(sftp, remotePath) {
  return new Promise((resolve) => sftp.mkdir(remotePath, () => resolve()));
}

function uploadFile(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const files = walk(ROOT);
  console.log(`Uploading ${files.length} files → ${USER}@${HOST}:${REMOTE_DIR}`);

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on("ready", resolve).on("error", reject).connect({
      host: HOST,
      username: USER,
      password: PASS,
      readyTimeout: 30000,
    });
  });

  await exec(conn, `mkdir -p ${REMOTE_DIR}`);
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  const dirs = new Set([REMOTE_DIR]);
  for (const f of files) {
    const parts = f.rel.split("/");
    let cur = REMOTE_DIR;
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      dirs.add(cur);
    }
  }
  for (const d of [...dirs].sort((a, b) => a.length - b.length)) await sftpMkdir(sftp, d);

  let i = 0;
  for (const f of files) {
    i++;
    if (i % 30 === 0 || i === files.length) console.log(`  ${i}/${files.length}`);
    await uploadFile(sftp, f.full, `${REMOTE_DIR}/${f.rel}`);
  }

  const setup = await exec(
    conn,
    [
      `mkdir -p /var/lib/wgl-cabinet/data /var/lib/wgl-cabinet/uploads/avatars`,
      `if [ -d ${REMOTE_DIR}/data ]; then cp -a ${REMOTE_DIR}/data/. /var/lib/wgl-cabinet/data/ 2>/dev/null; rm -rf ${REMOTE_DIR}/data; fi`,
      `if [ -d ${REMOTE_DIR}/uploads ]; then cp -a ${REMOTE_DIR}/uploads/. /var/lib/wgl-cabinet/uploads/ 2>/dev/null; rm -rf ${REMOTE_DIR}/uploads; fi`,
      `rm -rf ${REMOTE_DIR}/server/data ${REMOTE_DIR}/server/uploads /root/.wgl-cabinet`,
      `cd ${REMOTE_DIR}/server && npm install --omit=dev`,
      `pm2 delete wgl-cabinet 2>/dev/null || true`,
      `cd ${REMOTE_DIR}/server && pm2 start ecosystem.config.cjs && pm2 save`,
      `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/games`,
    ].join(" && ")
  );
  console.log(setup.out);
  console.log(`\nLive: http://${HOST}:${PORT}/cabinet/`);
  conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
