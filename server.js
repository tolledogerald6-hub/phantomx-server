const express = require('express');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

// Kumuha ng environment variables kung may .env file
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envConfig = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envConfig.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const app = express();
const PORT = 3000;

const ADMIN_USER = process.env.ADMIN_USER || "RAGNARX_ADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "PhantomX_SecurePass_2026!";

// Active Admin Session Tokens Store
let activeSessions = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadFolder = path.join(__dirname, 'uploads');
const sliderFolder = path.join(__dirname, 'uploads', 'slider');
const dbFile = path.join(__dirname, 'database.json');

if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);
if (!fs.existsSync(sliderFolder)) fs.mkdirSync(sliderFolder);

// MIDDLEWARE: Restrict Admin Access to Localhost & Disable Browser Caching (Anti-Back Button)
function restrictToLocalhost(req, res, next) {
  // Prevent browser caching so clicking BACK won't display sensitive admin view from memory
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  
  if (isLocal) {
    next();
  } else {
    res.status(403).send('<h1 style="color:red; font-family:monospace; text-align:center; margin-top:50px;">403 FORBIDDEN: Admin panel is restricted to Localhost PC only.</h1>');
  }
}

function loadDB() {
  if (!fs.existsSync(dbFile)) {
    const initialData = { 
      keys: [], 
      resetRequests: [],
      logs: [],
      maintenance: false, 
      loaderVersion: "1.0.0", 
      discordWebhook: "",
      broadcastMsg: "PHANTOM X SYSTEM - ALL SYSTEMS OPERATIONAL.",
      gcashName: "RAGNAR X",
      gcashNumber: "09XX-XXX-XXXX"
    };
    fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  const data = JSON.parse(fs.readFileSync(dbFile));
  if (!data.resetRequests) data.resetRequests = [];
  return data;
}

function saveDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function addSystemLog(msg) {
  const db = loadDB();
  if (!db.logs) db.logs = [];
  const logEntry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  db.logs.unshift(logEntry);
  if (db.logs.length > 50) db.logs.pop();
  saveDB(db);

  if (db.discordWebhook) {
    try {
      const url = new URL(db.discordWebhook);
      const payload = JSON.stringify({ content: `🤖 **[PHANTOM X LOG]** ${msg}` });
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
      });
      req.write(payload);
      req.end();
    } catch(e) {}
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'sliderImage') cb(null, sliderFolder);
    else cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === 'dbBackup') cb(null, 'database.json');
    else if (file.fieldname === 'gcashQr') cb(null, 'gcash-qr.png');
    else if (file.fieldname === 'bgMusic') cb(null, 'background-music.mp3');
    else cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Anti-cache header setup for static files in admin
app.use('/admin.html', restrictToLocalhost);

app.use(express.static('public'));
app.use('/files', express.static(uploadFolder));
app.use('/slider-images', express.static(sliderFolder));

// Auth Login API
app.post('/api/login', restrictToLocalhost, (req, res) => {
  const user = (req.body.username || '').trim();
  const pass = (req.body.password || '').trim();

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);
    addSystemLog(`Admin Login Successful from ${req.ip}`);
    res.json({ success: true, token });
  } else {
    addSystemLog(`Failed Admin Login Attempt from ${req.ip}`);
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

// Logout API
app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token) activeSessions.delete(token);
  res.json({ success: true });
});

// Verify Session API (Used on Page Load)
app.get('/api/verify-session', (req, res) => {
  const token = req.headers['authorization'];
  if (token && activeSessions.has(token)) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

app.get('/api/server-stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMemPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const db = loadDB();
  
  res.json({
    memoryPercent: usedMemPercent,
    freeMemMB: Math.round(freeMem / 1024 / 1024),
    uptimeSeconds: Math.floor(process.uptime()),
    cpuCores: os.cpus().length,
    totalKeys: db.keys.length,
    activeKeys: db.keys.filter(k => k.status === 'ACTIVE').length,
    bannedKeys: db.keys.filter(k => k.status === 'BANNED').length,
    pendingResets: db.resetRequests.filter(r => r.status === 'PENDING').length
  });
});

app.get('/api/logs', (req, res) => res.json(loadDB().logs || []));

app.get('/api/settings', (req, res) => {
  const db = loadDB();
  res.json({ 
    maintenance: db.maintenance, 
    version: db.loaderVersion, 
    webhook: db.discordWebhook,
    broadcast: db.broadcastMsg || "",
    gcashName: db.gcashName || "RagnarX",
    gcashNumber: db.gcashNumber || "09XX-XXX-XXXX"
  });
});

app.post('/api/settings', (req, res) => {
  const db = loadDB();
  if (req.body.version !== undefined) db.loaderVersion = req.body.version;
  if (req.body.webhook !== undefined) db.discordWebhook = req.body.webhook;
  if (req.body.broadcast !== undefined) db.broadcastMsg = req.body.broadcast;
  if (req.body.gcashName !== undefined) db.gcashName = req.body.gcashName;
  if (req.body.gcashNumber !== undefined) db.gcashNumber = req.body.gcashNumber;
  saveDB(db);
  addSystemLog("Settings Updated.");
  res.json({ success: true });
});

app.post('/upload-gcash', upload.single('gcashQr'), (req, res) => {
  addSystemLog("GCash QR Code Image Updated.");
  res.redirect('/admin.html');
});

app.post('/upload-music', upload.single('bgMusic'), (req, res) => {
  addSystemLog("Background Music MP3 Updated.");
  res.redirect('/admin.html');
});

app.post('/api/maintenance', (req, res) => {
  const db = loadDB();
  db.maintenance = req.body.maintenance;
  saveDB(db);
  addSystemLog(db.maintenance ? "⚠️ MAINTENANCE ACTIVE" : "✅ MAINTENANCE DISABLED");
  res.json({ success: true, maintenance: db.maintenance });
});

app.get('/api/backup-db', (req, res) => res.download(dbFile, 'phantomx_database_backup.json'));
app.post('/api/restore-db', upload.single('dbBackup'), (req, res) => {
  addSystemLog("Database Restored.");
  res.redirect('/admin.html');
});

// HWID Reset Requests
app.post('/api/request-hwid-reset', (req, res) => {
  const { key, reason } = req.body;
  const db = loadDB();
  const foundKey = db.keys.find(k => k.key === (key || '').trim());

  if (!foundKey) return res.status(404).json({ success: false, message: "Key not found!" });

  const existing = db.resetRequests.find(r => r.key === foundKey.key && r.status === 'PENDING');
  if (existing) return res.json({ success: false, message: "Pending request exists!" });

  db.resetRequests.push({
    id: Date.now(),
    key: foundKey.key,
    clientName: foundKey.clientName,
    reason: reason || "PC Change / Format",
    status: "PENDING",
    requestedAt: new Date().toLocaleString()
  });

  saveDB(db);
  addSystemLog(`HWID Reset Requested by [${foundKey.clientName}]`);
  res.json({ success: true, message: "Reset request submitted to Admin." });
});

app.get('/api/reset-requests', (req, res) => res.json(loadDB().resetRequests || []));

app.post('/api/process-hwid-reset', (req, res) => {
  const { id, action } = req.body;
  const db = loadDB();
  const reqObj = db.resetRequests.find(r => r.id === id);

  if (!reqObj) return res.status(404).json({ success: false });

  if (action === 'APPROVE') {
    reqObj.status = 'APPROVED';
    const targetKey = db.keys.find(k => k.key === reqObj.key);
    if (targetKey) targetKey.hwid = "UNBOUND";
    addSystemLog(`Approved HWID Reset for [${reqObj.clientName}]`);
  } else {
    reqObj.status = 'REJECTED';
    addSystemLog(`Rejected HWID Reset for [${reqObj.clientName}]`);
  }

  saveDB(db);
  res.json({ success: true });
});

// Slider API
app.get('/api/sliders', (req, res) => fs.readdir(sliderFolder, (err, files) => res.json(files || [])));
app.post('/upload-slider', upload.single('sliderImage'), (req, res) => {
  addSystemLog(`Slider Image Uploaded: ${req.file.filename}`);
  res.redirect('/admin.html');
});
app.delete('/api/sliders/:name', (req, res) => {
  const p = path.join(sliderFolder, req.params.name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  addSystemLog(`Slider Deleted: ${req.params.name}`);
  res.json({ success: true });
});

// Files API
app.get('/api/files', (req, res) => {
  fs.readdir(uploadFolder, (err, files) => {
    const loaderFiles = (files || []).filter(f => 
      f !== 'homepage-banner.png' && 
      f !== 'slider' && 
      f !== 'gcash-qr.png' && 
      f !== 'background-music.mp3'
    );
    res.json(loaderFiles);
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  addSystemLog(`Loader File Uploaded: ${req.file.originalname}`);
  res.redirect('/admin.html');
});

app.delete('/api/files/:name', (req, res) => {
  const p = path.join(uploadFolder, req.params.name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  addSystemLog(`File Deleted: ${req.params.name}`);
  res.json({ success: true });
});

app.post('/api/check-key-status', (req, res) => {
  const { key } = req.body;
  const db = loadDB();
  const foundKey = db.keys.find(k => k.key === (key || '').trim());

  if (!foundKey) return res.json({ success: false, message: "License key does not exist." });

  const isExpired = new Date(foundKey.expiresAt) < new Date();
  res.json({
    success: true,
    clientName: foundKey.clientName,
    key: foundKey.key,
    status: isExpired ? "EXPIRED" : foundKey.status,
    hwidStatus: foundKey.hwid === "UNBOUND" ? "UNBOUND" : "LOCKED TO PC",
    expiresAt: new Date(foundKey.expiresAt).toLocaleString()
  });
});

app.post('/api/generate-key', (req, res) => {
  const { clientName, duration, amount } = req.body;
  const db = loadDB();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({length: 4}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  
  let daysToAdd = 1;
  if (duration === "7-Days") daysToAdd = 7;
  if (duration === "30-Days") daysToAdd = 30;

  const count = parseInt(amount) || 1;
  const generatedList = [];

  for (let i = 0; i < count; i++) {
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + daysToAdd);

    const keyStr = `PX-${duration.toUpperCase().replace('-', '')}-${seg()}-${seg()}`;
    const nameStr = count > 1 ? `${clientName}_${i+1}` : (clientName || "VIP User");

    const keyData = {
      id: Date.now() + i,
      clientName: nameStr,
      key: keyStr,
      duration: duration,
      hwid: "UNBOUND",
      status: "ACTIVE",
      expiresAt: expireDate.toISOString(),
      createdAt: new Date().toLocaleDateString()
    };

    db.keys.push(keyData);
    generatedList.push(keyData);
  }

  saveDB(db);
  addSystemLog(`Generated ${count} key(s) for [${clientName}]`);
  res.json(generatedList);
});

app.get('/api/keys', (req, res) => {
  const db = loadDB();
  const now = new Date();
  db.keys.forEach(k => {
    if (k.status !== "BANNED" && new Date(k.expiresAt) < now) k.status = "EXPIRED";
  });
  saveDB(db);
  res.json(db.keys);
});

app.post('/api/keys/reset-hwid', (req, res) => {
  const db = loadDB();
  const k = db.keys.find(item => item.id === req.body.id);
  if (k) { k.hwid = "UNBOUND"; saveDB(db); addSystemLog(`HWID Reset: ${k.key}`); res.json({ success: true }); }
  else res.status(404).json({ success: false });
});

app.post('/api/keys/toggle-ban', (req, res) => {
  const db = loadDB();
  const k = db.keys.find(item => item.id === req.body.id);
  if (k) { 
    k.status = (k.status === "BANNED") ? "ACTIVE" : "BANNED"; 
    saveDB(db); 
    addSystemLog(`Key status: [${k.status}] -> ${k.key}`);
    res.json({ success: true, status: k.status }); 
  } else res.status(404).json({ success: false });
});

app.delete('/api/keys/:id', (req, res) => {
  const db = loadDB();
  const targetKey = db.keys.find(k => k.id === parseInt(req.params.id));
  db.keys = db.keys.filter(k => k.id !== parseInt(req.params.id));
  saveDB(db);
  if (targetKey) addSystemLog(`Key Deleted: ${targetKey.key}`);
  res.json({ success: true });
});

app.post('/api/validate-key', (req, res) => {
  const { key, userHwid, clientVersion } = req.body;
  const db = loadDB();

  if (db.maintenance) return res.json({ success: false, message: "System Under Maintenance!" });

  if (clientVersion && clientVersion !== db.loaderVersion) {
    return res.json({ success: false, message: `UPDATE REQUIRED: Loader v${db.loaderVersion} available!` });
  }

  const foundKey = db.keys.find(k => k.key === key.trim());
  if (!foundKey) return res.json({ success: false, message: "Invalid Key!" });
  if (foundKey.status === "BANNED") return res.json({ success: false, message: "KEY BANNED!" });

  if (new Date(foundKey.expiresAt) < new Date()) {
    foundKey.status = "EXPIRED";
    saveDB(db);
    return res.json({ success: false, message: "KEY EXPIRED!" });
  }

  if (foundKey.hwid === "UNBOUND") {
    foundKey.hwid = userHwid;
    saveDB(db);
    addSystemLog(`HWID bound [${foundKey.clientName}]: ${userHwid}`);
    return res.json({ success: true, message: `Welcome ${foundKey.clientName}!` });
  } else if (foundKey.hwid === userHwid) {
    return res.json({ success: true, message: `Welcome ${foundKey.clientName}!` });
  } else {
    return res.json({ success: false, message: "HWID MISMATCH!" });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));