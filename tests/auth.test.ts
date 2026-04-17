import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createAccountTable,
  createAccount,
  verifyPassword,
  findAccountByUsername,
} from "../src/server/auth.js";

describe("auth", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createAccountTable(db);
  });

  describe("createAccount", () => {
    it("stores account with hashed password", async () => {
      const account = await createAccount(db, "Maren", "swordfish");
      expect(account.username).toBe("Maren");
      expect(account.password_hash).not.toBe("swordfish");
      expect(account.password_hash.length).toBeGreaterThan(20);
      expect(account.id).toBeGreaterThan(0);
      expect(account.created_at).toBeTruthy();
    });

    it("throws on duplicate username", async () => {
      await createAccount(db, "Maren", "swordfish");
      await expect(createAccount(db, "Maren", "other")).rejects.toThrow();
    });

    it("throws on duplicate username case-insensitively", async () => {
      await createAccount(db, "Maren", "swordfish");
      await expect(createAccount(db, "maren", "other")).rejects.toThrow();
    });
  });

  describe("verifyPassword", () => {
    it("returns true for correct password", async () => {
      const account = await createAccount(db, "Maren", "swordfish");
      const ok = await verifyPassword("swordfish", account.password_hash);
      expect(ok).toBe(true);
    });

    it("returns false for wrong password", async () => {
      const account = await createAccount(db, "Maren", "swordfish");
      const ok = await verifyPassword("wrongpassword", account.password_hash);
      expect(ok).toBe(false);
    });

    it("returns false for empty string", async () => {
      const account = await createAccount(db, "Maren", "swordfish");
      const ok = await verifyPassword("", account.password_hash);
      expect(ok).toBe(false);
    });
  });

  describe("findAccountByUsername", () => {
    it("returns account for known username", async () => {
      await createAccount(db, "Maren", "swordfish");
      const account = findAccountByUsername(db, "Maren");
      expect(account).toBeDefined();
      expect(account!.username).toBe("Maren");
    });

    it("finds account case-insensitively", async () => {
      await createAccount(db, "Maren", "swordfish");
      const account = findAccountByUsername(db, "maren");
      expect(account).toBeDefined();
      expect(account!.username).toBe("Maren");
    });

    it("returns undefined for unknown username", () => {
      const account = findAccountByUsername(db, "nobody");
      expect(account).toBeUndefined();
    });
  });
});
