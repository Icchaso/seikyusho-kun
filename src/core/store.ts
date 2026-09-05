/** 取引先の保存・検索。1社1JSONで ~/.seikyusho-kun/clients/ に置く */
import fs from "node:fs";
import path from "node:path";
import type { Client } from "./types.js";
import { clientsDir, ensureDir, safeFileName } from "./paths.js";

function fileFor(name: string): string {
  return path.join(clientsDir(), `${safeFileName(name)}.json`);
}

export function listClients(): Client[] {
  const dir = clientsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as Client;
      } catch {
        return null;
      }
    })
    .filter((c): c is Client => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function loadClient(name: string): Client | null {
  const p = fileFor(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Client;
}

export function saveClient(client: Client): string {
  ensureDir(clientsDir());
  const now = new Date().toISOString();
  const existing = loadClient(client.name);
  const merged: Client = {
    ...client,
    createdAt: existing?.createdAt ?? client.createdAt ?? now,
    updatedAt: now,
  };
  const p = fileFor(client.name);
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return p;
}

export function deleteClient(name: string): boolean {
  const p = fileFor(name);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

/**
 * 名前で取引先を探す。完全一致 → 前方一致 → 部分一致 の順。
 * 「株式会社ABC」を「ABC」で引けるように、法人格を外した比較もする。
 */
export function findClient(query: string): Client | null {
  const q = query.trim();
  if (!q) return null;
  const all = listClients();

  const exact = all.find((c) => c.name === q);
  if (exact) return exact;

  const strip = (s: string) =>
    s
      .replace(/(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|医療法人)/g, "")
      .replace(/[\s.．・]/g, "")
      .toLowerCase();
  const qs = strip(q);

  const stripped = all.find((c) => strip(c.name) === qs);
  if (stripped) return stripped;

  const prefix = all.filter((c) => strip(c.name).startsWith(qs));
  if (prefix.length === 1 && prefix[0]) return prefix[0];

  const partial = all.filter((c) => strip(c.name).includes(qs));
  if (partial.length === 1 && partial[0]) return partial[0];

  return null;
}

/** 定期発行の設定を持っている取引先だけ */
export function scheduledClients(): Client[] {
  return listClients().filter((c) => c.schedule && c.schedule.enabled !== false);
}
