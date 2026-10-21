// db/database.js
// Sets up the SQLite database, creates tables, and seeds demo data on first run.
//
// SCHEMA v2: stock is no longer a single number typed by hand. It's derived from
// batches (each with its own expiry date) and consumption logs (real usage history).

const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "mediflow.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Schema ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Catalog of medicines a clinic tracks. No stock/usage column here anymore —
  -- those are computed from medicine_batches and consumption_log.
  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'units',
    manual_daily_usage REAL DEFAULT 0, -- fallback estimate, used only until real history builds up
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(clinic_id, name)
  );

  -- Every restock is its own batch with its own expiry date, like real pharmacy stock.
  CREATE TABLE IF NOT EXISTS medicine_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,       -- remaining quantity in this batch (decreases as it's used)
    expiry_date TEXT,             -- ISO date, nullable if unknown/not applicable
    received_at TEXT DEFAULT (datetime('now'))
  );

  -- Every dispense/use gets logged here. This is what makes "predicted shortage"
  -- real instead of a guess — daily usage becomes an actual rolling average.
  CREATE TABLE IF NOT EXISTS consumption_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    logged_at TEXT DEFAULT (datetime('now')),
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS transfer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    provider_clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | completed
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---------- Seed (only if empty) ----------

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  return daysFromNow(-n);
}

function seed() {
  const clinicCount = db.prepare("SELECT COUNT(*) AS c FROM clinics").get().c;
  if (clinicCount > 0) return;

  const insertClinic = db.prepare(`
    INSERT INTO clinics (clinic_code, name, password_hash, latitude, longitude)
    VALUES (?, ?, ?, ?, ?)
  `);
  const demoPasswordHash = bcrypt.hashSync("demo1234", 10);

  const clinics = [
    { code: "clinic-a", name: "Clinic A - Main Street", lat: 28.6692, lon: 77.4538 },
    { code: "city-care", name: "City Care Clinic", lat: 28.6448, lon: 77.4162 },
    { code: "lifeline", name: "LifeLine Medical Center", lat: 28.7041, lon: 77.4025 },
    { code: "green-valley", name: "Green Valley Clinic", lat: 28.6139, lon: 77.2090 },
    { code: "sunrise", name: "Sunrise Health Center", lat: 28.5921, lon: 77.0460 },
    { code: "apollo", name: "Apollo Community Clinic", lat: 28.4595, lon: 77.0266 },
    { code: "careplus", name: "CarePlus Clinic", lat: 28.5355, lon: 77.3910 },
  ];

  const clinicIds = {};
  for (const c of clinics) {
    const info = insertClinic.run(c.code, c.name, demoPasswordHash, c.lat, c.lon);
    clinicIds[c.code] = info.lastInsertRowid;
  }

  const insertMedicine = db.prepare(`
    INSERT INTO medicines (clinic_id, name, unit, manual_daily_usage)
    VALUES (?, ?, ?, ?)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO medicine_batches (medicine_id, quantity, expiry_date, received_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertLog = db.prepare(`
    INSERT INTO consumption_log (medicine_id, quantity, logged_at)
    VALUES (?, ?, ?)
  `);

  // Clinic A: the main demo account. Gets batches (some near-expiry, for the
  // expiry-alert demo) AND 10 days of consumption history (for the
  // real-usage-average demo), so every feature has something to show immediately.
  const clinicAMeds = [
    // name, initial stock, manualDailyUsage fallback, expiryInDays
    ["Amoxicillin", 30, 5, 20],   // expiring soon AND critical stock -> strong demo case
    ["Paracetamol", 120, 15, 240],
    ["ORS", 80, 8, 365],
    ["Azithromycin", 10, 5, 25],  // also expiring soon
    ["Ibuprofen", 100, 10, 300],
    ["Cetirizine", 6, 2, 12],     // critical stock AND expiring very soon
  ];

  for (const [name, stock, usage, expiryDays] of clinicAMeds) {
    const medInfo = insertMedicine.run(clinicIds["clinic-a"], name, "units", usage);
    const medicineId = medInfo.lastInsertRowid;

    insertBatch.run(medicineId, stock, daysFromNow(expiryDays), daysAgo(20));

    // Seed ~10 days of consumption history so the rolling average has real data,
    // with slight variation so it doesn't look robotic.
    for (let i = 10; i >= 1; i--) {
      const variedQty = Math.max(0, Math.round(usage * (0.8 + Math.random() * 0.4)));
      if (variedQty > 0) insertLog.run(medicineId, variedQty, daysAgo(i));
    }
  }

  // Other clinics: surplus stock for the surplus-finder + transfer demo.
  // City Care's Amoxicillin batch expires soon on purpose — good demo of
  // "near-expiry surplus should be redistributed, not wasted."
  const surplusData = [
    ["city-care", "Amoxicillin", 35, 3, 10],
    ["lifeline", "Amoxicillin", 20, 2, 200],
    ["green-valley", "ORS", 60, 4, 365],
    ["sunrise", "Paracetamol", 80, 6, 180],
    ["apollo", "Azithromycin", 15, 2, 300],
    ["careplus", "Ibuprofen", 40, 3, 250],
    ["city-care", "Cetirizine", 50, 2, 200],
  ];
  for (const [code, name, stock, usage, expiryDays] of surplusData) {
    const medInfo = insertMedicine.run(clinicIds[code], name, "units", usage);
    insertBatch.run(medInfo.lastInsertRowid, stock, daysFromNow(expiryDays), daysAgo(5));
  }

  console.log("Seeded database with demo clinics, batches, and consumption history.");
  console.log("Demo login -> clinic_code: clinic-a | password: demo1234");
}

seed();

module.exports = db;
