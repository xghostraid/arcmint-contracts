import { EventEmitter } from "node:events";
import type { Db } from "./db.js";
import { now } from "./db.js";

export type ActivityKind = "vault" | "wallet" | "export" | "buy" | "sell" | "distribute" | "sweep" | "launch" | "airdrop" | "bot" | "token";
export type ActivityStatus = "ok" | "failed" | "info" | "simulated";

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  network: string;
  status: ActivityStatus;
  summary: string;
  walletAddress: string | null;
  token: string | null;
  signature: string | null;
  detail: unknown;
  createdAt: string;
}

interface Row {
  id: number;
  kind: ActivityKind;
  network: string;
  status: ActivityStatus;
  summary: string;
  wallet_address: string | null;
  token: string | null;
  signature: string | null;
  detail: string | null;
  created_at: string;
}

/** Append-only audit trail of every action; also fans out to SSE subscribers. */
export class ActivityLog extends EventEmitter {
  constructor(private readonly db: Db, private readonly network: string) {
    super();
    this.setMaxListeners(100);
  }

  record(e: { kind: ActivityKind; status: ActivityStatus; summary: string; walletAddress?: string; token?: string; signature?: string; detail?: unknown }): ActivityEntry {
    const createdAt = now();
    const r = this.db
      .prepare("INSERT INTO activity (kind, network, status, summary, wallet_address, token, signature, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.kind, this.network, e.status, e.summary, e.walletAddress ?? null, e.token ?? null, e.signature ?? null, e.detail === undefined ? null : JSON.stringify(e.detail), createdAt);
    const entry: ActivityEntry = {
      id: Number(r.lastInsertRowid),
      kind: e.kind,
      network: this.network,
      status: e.status,
      summary: e.summary,
      walletAddress: e.walletAddress ?? null,
      token: e.token ?? null,
      signature: e.signature ?? null,
      detail: e.detail ?? null,
      createdAt,
    };
    this.emit("entry", entry);
    return entry;
  }

  list(limit = 200, beforeId?: number): ActivityEntry[] {
    const rows = (beforeId
      ? this.db.prepare("SELECT * FROM activity WHERE id < ? ORDER BY id DESC LIMIT ?").all(beforeId, limit)
      : this.db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit)) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      network: r.network,
      status: r.status,
      summary: r.summary,
      walletAddress: r.wallet_address,
      token: r.token,
      signature: r.signature,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
    }));
  }
}
