const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'data', 'app.db');

function ensureDataDir(){
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDataDir();

const db = new sqlite3.Database(DB_PATH);

// Initialize tables if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT,
    user_id TEXT,
    role TEXT,
    PRIMARY KEY (team_id, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    priority TEXT,
    completed INTEGER DEFAULT 0,
    due_at INTEGER,
    created_by TEXT,
    assignee TEXT,
    recurring_rule TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT,
    depends_on_id TEXT,
    PRIMARY KEY (task_id, depends_on_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    user_id TEXT,
    content TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    user_id TEXT,
    started_at INTEGER,
    stopped_at INTEGER,
    duration INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    user_id TEXT,
    remind_at INTEGER,
    snoozed_until INTEGER,
    sent INTEGER DEFAULT 0
  )`);
});

module.exports = db;
