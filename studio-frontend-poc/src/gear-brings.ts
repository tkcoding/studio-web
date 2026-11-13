// What a candidate gear would bring into the product with it, asked before
// it is added (studio-product `POST /gearbox/brings`): the gears that come
// along and why, and every contract the product would then get twice — the
// second audit store a certified platform cannot keep.

import type { ProductChange } from "./api";

export interface BroughtGear {
  gear: string;
  reason: string;
  database: boolean;
}

export interface ContractOverlap {
  contract: string;
  already: string[];
  brought: string[];
}

export interface GearBrings {
  described: boolean;
  brought: BroughtGear[];
  overlaps: ContractOverlap[];
  changes: ProductChange[];
}

/** One line on top of the list: how much comes along, and what clashes. */
export function bringsSummary(candidate: string, b: GearBrings): string {
  if (!b.described) return `No gear.gdl describes ${candidate}, so what it needs is unknown.`;
  const others = b.brought.filter((g) => g.gear !== candidate);
  const dbs = b.brought.filter((g) => g.database).length;
  const parts: string[] = [];
  parts.push(
    others.length === 0
      ? "Nothing else comes with it."
      : `${others.length} more gear${others.length === 1 ? "" : "s"} come${others.length === 1 ? "s" : ""} with it.`,
  );
  if (dbs > 0) parts.push(`${dbs} keep${dbs === 1 ? "s" : ""} its own database.`);
  if (b.overlaps.length > 0) {
    parts.push(
      `${b.overlaps.length} contract${b.overlaps.length === 1 ? " is" : "s are"} already provided in the product.`,
    );
  }
  return parts.join(" ");
}

/** A contract id as a person reads it: `audit/AuditLog@v1` → `AuditLog (audit, v1)`. */
export function contractLabel(contract: string): string {
  const m = /^([^/]+)\/([^@]+)@(.+)$/.exec(contract);
  return m ? `${m[2]} (${m[1]}, ${m[3]})` : contract;
}
