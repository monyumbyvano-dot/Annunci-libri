const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');

const DB_FILE = path.join(__dirname, 'data.db');
const PORT = process.env.PORT || 3000;

// Initialize DB if not exists
const initSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  socials TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indirizzo TEXT NOT NULL,
  anno INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  edition TEXT,
  isbn TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  book_id INTEGER,
  type TEXT NOT NULL,
  price REAL,
  condition TEXT,
  class_id INTEGER,
  description TEXT,
  contact_visible INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE SET NULL
);
`;

// If DB file missing, create and seed classes
const needSeed = !fs.existsSync(DB_FILE);

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Could not open DB', err);
    process.exit(1);
  }
  db.exec(initSql, (err) => {
    if (err) { console.error('DB init error', err); process.exit(1); }
    if (needSeed) {
      const seed = db.prepare("INSERT INTO classes (indirizzo, anno) VALUES (?,?)");
      const indirizzi = ['Linguistico','Scienze Umane','Scientifico'];
      for (const ind of indirizzi) {
        for (let a=1;a<=5;a++) seed.run(ind, a);
      }
      seed.finalize();
      console.log('Database initialized and classes seeded.');
    }
  });
});

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: list classes
app.get('/api/classes', (req, res) => {
  db.all("SELECT * FROM classes ORDER BY indirizzo, anno", [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// API: list announcements with filters
app.get('/api/announcements', (req, res) => {
  const { indirizzo, anno, type, q } = req.query;
  let sql = `SELECT a.*, b.title, b.author, c.indirizzo as class_indirizzo, c.anno as class_anno, u.first_name, u.last_name, u.email, u.phone, u.socials
             FROM announcements a
             LEFT JOIN books b ON b.id = a.book_id
             LEFT JOIN classes c ON c.id = a.class_id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.is_active = 1`;
  const params = [];
  if (type) { sql += " AND a.type = ?"; params.push(type); }
  if (indirizzo) { sql += " AND c.indirizzo = ?"; params.push(indirizzo); }
  if (anno) { sql += " AND c.anno = ?"; params.push(parseInt(anno)); }
  if (q) { sql += " AND (b.title LIKE ? OR b.author LIKE ? OR a.description LIKE ?)"; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
  sql += " ORDER BY a.created_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// API: create announcement (simple flow: create user if not exists by email)
app.post('/api/announcements', (req, res) => {
  const { first_name, last_name, email, phone, socials, type, title, author, edition, isbn, notes, price, condition, class_id, description, contact_visible } = req.body;
  if (!first_name || !last_name || !email || !type || !title || !class_id) {
    return res.status(400).json({error: "Campi obbligatori mancanti"});
  }
  db.serialize(() => {
    db.get("SELECT id FROM users WHERE email = ?", [email], (err, userRow) => {
      if (err) return res.status(500).json({error: err.message});
      const proceedWithUserId = (userId) => {
        db.run("INSERT INTO books (title, author, edition, isbn, notes) VALUES (?,?,?,?,?)", [title, author, edition, isbn, notes], function(err) {
          if (err) return res.status(500).json({error: err.message});
          const bookId = this.lastID;
          db.run(`INSERT INTO announcements (user_id, book_id, type, price, condition, class_id, description, contact_visible) VALUES (?,?,?,?,?,?,?,?)`,
            [userId, bookId, type, price || null, condition || null, class_id, description || null, contact_visible ? 1 : 0],
            function(err) {
              if (err) return res.status(500).json({error: err.message});
              db.get("SELECT a.*, b.title FROM announcements a LEFT JOIN books b ON b.id=a.book_id WHERE a.id = ?", [this.lastID], (err, ann) => {
                if (err) return res.status(500).json({error: err.message});
                res.json(ann);
              });
            });
        });
      };
      if (userRow) {
        // update basic contact info
        db.run("UPDATE users SET first_name=?, last_name=?, phone=?, socials=? WHERE id=?", [first_name, last_name, phone||null, socials?JSON.stringify(socials):null, userRow.id], (err)=>{});
        proceedWithUserId(userRow.id);
      } else {
        db.run("INSERT INTO users (first_name, last_name, email, phone, socials) VALUES (?,?,?,?,?)", [first_name, last_name, email, phone||null, socials?JSON.stringify(socials):null], function(err) {
          if (err) return res.status(500).json({error: err.message});
          proceedWithUserId(this.lastID);
        });
      }
    });
  });
});

// Serve index for any other route (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
