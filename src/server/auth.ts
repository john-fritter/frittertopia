import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";

const SALT_ROUNDS = 10;

export interface Account {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export function createAccountTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

export function findAccountByUsername(
  db: Database.Database,
  username: string
): Account | undefined {
  return db
    .prepare("SELECT * FROM accounts WHERE username = ?")
    .get(username) as Account | undefined;
}

export async function createAccount(
  db: Database.Database,
  username: string,
  password: string
): Promise<Account> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO accounts (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, hash, now);
  return findAccountByUsername(db, username)!;
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
