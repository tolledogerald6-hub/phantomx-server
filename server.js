const express = require('express');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

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
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "RAGNARX_ADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "PhantomX_SecurePass_2026!";

let activeSessions = new Set();
let activeLoaderClients = new Map();
let chatMessages = [];
let trainingMessages = [];
let trainingSeenUsers = new Set();
let videoCallSignal = { offer: null, answer: null, candidates: [] };

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadFolder = path.join(__dirname, 'uploads');
const sliderFolder = path.join(__dirname, 'uploads', 'slider');
const chatUploadsFolder = path.join(__dirname, 'uploads', 'chat');
const trainingUploadsFolder = path.join(__dirname, 'uploads', 'training');
const dbFile = path.join(__dirname, 'database.json');

if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);
if (!fs.existsSync(sliderFolder)) fs.mkdirSync(sliderFolder);
if (!fs.existsSync(chatUploadsFolder)) fs.mkdirSync(chatUploadsFolder, { recursive: true });
if (!fs.existsSync(trainingUploadsFolder)) fs.mkdirSync(trainingUploadsFolder, { recursive: true });

function loadDB() {
  if (!fs.existsSync(dbFile)) {
    const initialData = { 
      keys: [], 
      resetRequests: [],
      logs: [],
      coupons: [],
      pastes: [],
      downloadCount: 0,
      maintenance: false, 
      loaderVersion: "1.0.0", 
      discordWebhook: process.env.DISCORD_WEBHOOK || "",
      broadcastMsg: "PHANTOM X SYSTEM - ALL SYSTEMS OPERATIONAL.",
      gcashName: "RAGNAR X",
      gcashNumber: "09XX-XXX-XXXX"
    };
    fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  const data = JSON.parse(fs.readFileSync(dbFile));
  if (!data.resetRequests) data.resetRequests = [];
  if (!data.coupons) data.coupons = [];
  if (!data.pastes) data.pastes = [];
  if (data.downloadCount === undefined) data.downloadCount = 0;
  return data;
}

function saveDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function sendDiscordAlert(msg) {
  const db = loadDB();
  const webhookUrl = db.discordWebhook || process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  try {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify({ content: msg });
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
    });
    req.write(payload);
    req.end();
  } catch(e) {}
}

function addSystemLog(msg, req = null) {
  const db = loadDB();
  if (!db.logs) db.logs = [];
  const ip = req ? (req.ip || req.connection.remoteAddress || 'IP:Internal') : 'IP:System';
  const logEntry = `[${new Date().toLocaleTimeString()}] [${ip}] ${msg}`;
  db.logs.unshift(logEntry);
  if (db.logs.length > 60) db.logs.pop();
  saveDB(db);

  sendDiscordAlert(`🤖 **[PHANTOM X LOG]** ${msg}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'sliderImage') cb(null, sliderFolder);
    else if (file.fieldname === 'chatAttachment') cb(null, chatUploadsFolder);
    else if (file.fieldname === 'trainingAttachment') cb(null, trainingUploadsFolder);
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

app.use(express.static('public'));
app.use('/slider-images', express.static(sliderFolder));
app.use('/chat-files', express.static(chatUploadsFolder));
app.use('/training-files', express.static(trainingUploadsFolder));

// 🚀 PHANTOM PASTEBIN RAW DIRECT LINK ENDPOINT
app.get('/raw/:slug', (req, res) => {
  const db = loadDB();
  const targetSlug = req.params.slug.trim().toLowerCase();
  const foundPaste = (db.pastes || []).find(p => p.slug.toLowerCase() === targetSlug);

  if (foundPaste) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(foundPaste.content);
  } else {
    res.status(404).send("PASTE NOT FOUND");
  }
});

// PASTEBIN MANAGEMENT APIs
app.get('/api/pastes', (req, res) => res.json(loadDB().pastes || []));

app.post('/api/pastes', (req, res) => {
  const { slug, content } = req.body;
  const db = loadDB();
  if (!db.pastes) db.pastes = [];

  const pasteSlug = (slug || Date.now().toString()).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const existingIdx = db.pastes.findIndex(p => p.slug === pasteSlug);

  const pasteObj = {
    slug: pasteSlug,
    content: content || '',
    contentLength: (content || '').length,
    updatedAt: new Date().toLocaleString()
  };

  if (existingIdx !== -1) {
    db.pastes[existingIdx] = pasteObj;
  } else {
    db.pastes.push(pasteObj);
  }

  saveDB(db);
  addSystemLog(`Phantom Pastebin Created/Updated: [/raw/${pasteSlug}]`, req);
  res.json({ success: true, slug: pasteSlug });
});

app.delete('/api/pastes/:slug', (req, res) => {
  const db = loadDB();
  db.pastes = (db.pastes || []).filter(p => p.slug !== req.params.slug);
  saveDB(db);
  addSystemLog(`Phantom Paste Deleted: [/raw/${req.params.slug}]`, req);
  res.json({ success: true });
});

app.get('/files/:filename', (req, res) => {
  const filePath = path.join(uploadFolder, req.params.filename);
  if (fs.existsSync(filePath)) {
    const db = loadDB();
    db.downloadCount = (db.downloadCount || 0) + 1;
    saveDB(db);
    addSystemLog(`Loader Executable Downloaded: ${req.params.filename}`, req);
    res.download(filePath);
  } else {
    res.status(404).send("File Not Found");
  }
});

app.get('/api/export-keys-txt', (req, res) => {
  const db = loadDB();
  const activeKeys = db.keys.filter(k => k.status === 'ACTIVE');
  
  let txtContent = "==========================================\n";
  txtContent += "      PHANTOM X - ACTIVE LICENSE KEYS     \n";
  txtContent += "==========================================\n\n";

  activeKeys.forEach((k, idx) => {
    txtContent += `${idx + 1}. KEY: ${k.key} | CLIENT: ${k.clientName} | DURATION: ${k.duration} | EXPIRES: ${new Date(k.expiresAt).toLocaleString()}\n`;
  });

  res.setHeader('Content-disposition', 'attachment; filename=phantomx_active_keys.txt');
  res.setHeader('Content-type', 'text/plain');
  res.send(txtContent);
});

app.post('/api/claim-key', (req, res) => {
  const { gcashRef, duration } = req.body;
  if (!gcashRef || gcashRef.trim().length < 6) {
    return res.json({ success: false, message: "Please enter a valid GCash Reference Number!" });
  }

  const clientIp = req.ip || req.connection.remoteAddress || 'Unknown IP';
  const alertMessage = 
    `📩 **[NEW PAYMENT TRANSACTION SUBMITTED]**\n` +
    `> 👤 **Client IP:** \`${clientIp}\`\n` +
    `> 🧾 **GCash Ref No:** \`${gcashRef.trim()}\`\n` +
    `> ⏳ **Plan Selected:** \`${duration || '1-Day'}\`\n` +
    `> 🕒 **Time:** \`${new Date().toLocaleTimeString()}\`\n` +
    `⚠️ *Please check your GCash App to verify payment before generating the key in Admin Panel.*`;

  sendDiscordAlert(alertMessage);
  addSystemLog(`GCash Payment Submitted for Verification: Ref [${gcashRef.trim()}]`, req);

  res.json({ 
    success: true, 
    message: "Transaction details sent to Admin! Please message us on Discord with your GCash Reference Number to receive your VIP key." 
  });
});

app.post('/api/login', (req, res) => {
  const user = (req.body.username || '').trim();
  const pass = (req.body.password || '').trim();

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);
    addSystemLog(`Admin Login Successful`, req);
    res.json({ success: true, token });
  } else {
    addSystemLog(`Failed Admin Login Attempt`, req);
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token) activeSessions.delete(token);
  res.json({ success: true });
});

app.get('/api/verify-session', (req, res) => {
  const token = req.headers['authorization'];
  if (token && activeSessions.has(token)) res.json({ valid: true });
  else res.json({ valid: false });
});

setInterval(() => {
  const db = loadDB();
  const now = new Date().getTime();
  db.keys.forEach(k => {
    if (k.status === 'ACTIVE' && !k.reminderSent) {
      const expTime = new Date(k.expiresAt).getTime();
      const hoursLeft = (expTime - now) / (1000 * 60 * 60);
      if (hoursLeft > 0 && hoursLeft <= 24) {
        k.reminderSent = true;
        saveDB(db);
        sendDiscordAlert(`⚠️ **[24H RENEWAL ALERT]** Key \`${k.key}\` for Client **[${k.clientName}]** will expire in 24 hours!`);
      }
    }
  });
}, 300000);

app.post('/api/heartbeat', (req, res) => {
  const { key, hwid } = req.body;
  if (key) activeLoaderClients.set(key, { hwid, lastPing: Date.now() });
  res.json({ success: true });
});

setInterval(() => {
  const now = Date.now();
  for (let [key, data] of activeLoaderClients.entries()) {
    if (now - data.lastPing > 60000) activeLoaderClients.delete(key);
  }
}, 10000);

app.post('/api/report-crack-attempt', (req, res) => {
  const { key, hwid, reason } = req.body;
  const db = loadDB();
  const cleanKey = (key || '').toString().trim().toUpperCase();
  const foundKey = db.keys.find(k => k.key.trim().toUpperCase() === cleanKey);

  if (foundKey) {
    foundKey.status = "BANNED";
    saveDB(db);
  }

  addSystemLog(`🚨 [SECURITY BREACH] Key: ${key || 'UNKNOWN'} | HWID: ${hwid || 'UNKNOWN'} | REASON: ${reason || 'Debugger Attached'}`, req);
  res.json({ success: true });
});

app.get('/api/coupons', (req, res) => res.json(loadDB().coupons || []));
app.post('/api/coupons', (req, res) => {
  const { code, discountPercent } = req.body;
  const db = loadDB();
  db.coupons.push({
    id: Date.now(),
    code: (code || '').toUpperCase().trim(),
    discountPercent: parseInt(discountPercent) || 10,
    createdAt: new Date().toLocaleDateString()
  });
  saveDB(db);
  addSystemLog(`Created Coupon Code: ${code} (${discountPercent}% OFF)`, req);
  res.json({ success: true });
});

app.delete('/api/coupons/:id', (req, res) => {
  const db = loadDB();
  db.coupons = db.coupons.filter(c => c.id !== parseInt(req.params.id));
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/verify-coupon', (req, res) => {
  const { code } = req.body;
  const db = loadDB();
  const found = db.coupons.find(c => c.code === (code || '').toUpperCase().trim());

  if (found) res.json({ success: true, discountPercent: found.discountPercent });
  else res.json({ success: false, message: "Invalid or expired coupon code." });
});

app.get('/api/chat/messages', (req, res) => res.json(chatMessages));
app.post('/api/chat/send', upload.single('chatAttachment'), (req, res) => {
  const { sender, text } = req.body;
  let fileUrl = null; let fileType = null;

  if (req.file) {
    fileUrl = `/chat-files/${req.file.filename}`;
    if (req.file.mimetype.startsWith('image/')) fileType = 'image';
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
    else fileType = 'file';
  }

  const msgObj = { id: Date.now(), sender: sender || 'VIP Guest', text: text || '', fileUrl, fileType, time: new Date().toLocaleTimeString() };
  chatMessages.push(msgObj);
  if (chatMessages.length > 100) chatMessages.shift();
  res.json({ success: true, message: msgObj });
});

app.get('/api/training/messages', (req, res) => {
  const username = req.query.user || 'Guest';
  trainingSeenUsers.add(username);
  res.json({ messages: trainingMessages, seenList: Array.from(trainingSeenUsers) });
});

app.post('/api/training/send', upload.single('trainingAttachment'), (req, res) => {
  const { sender, text } = req.body;
  let fileUrl = null; let fileType = null;

  if (req.file) {
    fileUrl = `/training-files/${req.file.filename}`;
    if (req.file.mimetype.startsWith('image/')) fileType = 'image';
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
    else fileType = 'file';
  }

  const msgObj = { id: Date.now(), sender: sender || 'Trainee VIP', text: text || '', fileUrl, fileType, time: new Date().toLocaleTimeString() };
  trainingMessages.push(msgObj);
  if (trainingMessages.length > 200) trainingMessages.shift();
  res.json({ success: true, message: msgObj });
});

app.delete('/api/training/messages/:id', (req, res) => {
  trainingMessages = trainingMessages.filter(m => m.id !== parseInt(req.params.id));
  res.json({ success: true });
});

app.post('/api/training/clear-all', (req, res) => {
  trainingMessages = [];
  trainingSeenUsers.clear();
  addSystemLog("Training Group Chat Cleared.", req);
  res.json({ success: true });
});

app.post('/api/call/signal', (req, res) => {
  const { type, data } = req.body;
  if (type === 'offer') videoCallSignal.offer = data;
  else if (type === 'answer') videoCallSignal.answer = data;
  else if (type === 'candidate') videoCallSignal.candidates.push(data);
  else if (type === 'reset') videoCallSignal = { offer: null, answer: null, candidates: [] };
  res.json({ success: true });
});

app.get('/api/call/signal', (req, res) => res.json(videoCallSignal));

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
    pendingResets: db.resetRequests.filter(r => r.status === 'PENDING').length,
    activeLoadersOnline: activeLoaderClients.size,
    totalDownloads: db.downloadCount || 0
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
  addSystemLog("Settings Updated.", req);
  res.json({ success: true });
});

app.post('/upload-gcash', upload.single('gcashQr'), (req, res) => {
  addSystemLog("GCash QR Code Image Updated.", req);
  res.redirect('/admin.html');
});

app.post('/upload-music', upload.single('bgMusic'), (req, res) => {
  addSystemLog("Background Music MP3 Updated.", req);
  res.redirect('/admin.html');
});

app.post('/api/maintenance', (req, res) => {
  const db = loadDB();
  db.maintenance = req.body.maintenance;
  saveDB(db);
  addSystemLog(db.maintenance ? "⚠️ MAINTENANCE ACTIVE" : "✅ MAINTENANCE DISABLED", req);
  res.json({ success: true, maintenance: db.maintenance });
});

app.get('/api/backup-db', (req, res) => res.download(dbFile, 'phantomx_database_backup.json'));
app.post('/api/restore-db', upload.single('dbBackup'), (req, res) => {
  addSystemLog("Database Restored.", req);
  res.redirect('/admin.html');
});

app.post('/api/request-hwid-reset', (req, res) => {
  const { key, reason } = req.body;
  const db = loadDB();
  const cleanKey = (key || '').toString().trim().toUpperCase();
  const foundKey = db.keys.find(k => k.key.trim().toUpperCase() === cleanKey);

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
  addSystemLog(`HWID Reset Requested by [${foundKey.clientName}]`, req);
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
    addSystemLog(`Approved HWID Reset for [${reqObj.clientName}]`, req);
  } else {
    reqObj.status = 'REJECTED';
    addSystemLog(`Rejected HWID Reset for [${reqObj.clientName}]`, req);
  }

  saveDB(db);
  res.json({ success: true });
});

app.get('/api/sliders', (req, res) => fs.readdir(sliderFolder, (err, files) => res.json(files || [])));
app.post('/upload-slider', upload.single('sliderImage'), (req, res) => {
  addSystemLog(`Slider Image Uploaded: ${req.file.filename}`, req);
  res.redirect('/admin.html');
});
app.delete('/api/sliders/:name', (req, res) => {
  const p = path.join(sliderFolder, req.params.name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  addSystemLog(`Slider Deleted: ${req.params.name}`, req);
  res.json({ success: true });
});

app.get('/api/files', (req, res) => {
  fs.readdir(uploadFolder, (err, files) => {
    const loaderFiles = (files || []).filter(f => 
      f !== 'homepage-banner.png' && 
      f !== 'slider' && 
      f !== 'gcash-qr.png' && 
      f !== 'background-music.mp3' &&
      f !== 'chat' &&
      f !== 'training'
    );
    res.json(loaderFiles);
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  addSystemLog(`Loader File Uploaded: ${req.file.originalname}`, req);
  res.redirect('/admin.html');
});

app.delete('/api/files/:name', (req, res) => {
  const p = path.join(uploadFolder, req.params.name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  addSystemLog(`File Deleted: ${req.params.name}`, req);
  res.json({ success: true });
});

app.post('/api/check-key-status', (req, res) => {
  const { key } = req.body;
  const db = loadDB();
  const cleanKey = (key || '').toString().trim().toUpperCase();
  const foundKey = db.keys.find(k => k.key.trim().toUpperCase() === cleanKey);

  if (!foundKey) return res.json({ success: false, message: "License key does not exist." });

  const isExpired = new Date(foundKey.expiresAt) < new Date();
  res.json({
    success: true,
    clientName: foundKey.clientName,
    key: foundKey.key,
    status: isExpired ? "EXPIRED" : foundKey.status,
    hwidStatus: foundKey.hwid === "UNBOUND" ? "UNBOUND" : "LOCKED TO PC",
    expiresAtISO: foundKey.expiresAt,
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
  addSystemLog(`Generated ${count} key(s) for [${clientName}]`, req);
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
  if (k) { k.hwid = "UNBOUND"; saveDB(db); addSystemLog(`HWID Reset: ${k.key}`, req); res.json({ success: true }); }
  else res.status(404).json({ success: false });
});

app.post('/api/keys/toggle-ban', (req, res) => {
  const db = loadDB();
  const k = db.keys.find(item => item.id === req.body.id);
  if (k) { 
    k.status = (k.status === "BANNED") ? "ACTIVE" : "BANNED"; 
    saveDB(db); 
    addSystemLog(`Key status: [${k.status}] -> ${k.key}`, req);
    res.json({ success: true, status: k.status }); 
  } else res.status(404).json({ success: false });
});

app.delete('/api/keys/:id', (req, res) => {
  const db = loadDB();
  const targetKey = db.keys.find(k => k.id === parseInt(req.params.id));
  db.keys = db.keys.filter(k => k.id !== parseInt(req.params.id));
  saveDB(db);
  if (targetKey) addSystemLog(`Key Deleted: ${targetKey.key}`, req);
  res.json({ success: true });
});

app.post('/api/validate-key', (req, res) => {
  const { key, userHwid, clientVersion } = req.body;
  const db = loadDB();

  if (db.maintenance) {
    return res.json({ success: false, message: "System Under Maintenance!" });
  }

  if (clientVersion && clientVersion !== db.loaderVersion) {
    return res.json({ success: false, message: `UPDATE REQUIRED: Loader v${db.loaderVersion} available!` });
  }

  if (!key) {
    return res.json({ success: false, message: "Key parameter missing!" });
  }

  const cleanInputKey = key.toString().trim().toUpperCase();
  const foundKey = db.keys.find(k => k.key.trim().toUpperCase() === cleanInputKey);

  if (!foundKey) {
    return res.json({ success: false, message: "Invalid Key!" });
  }

  if (foundKey.status === "BANNED") {
    return res.json({ success: false, message: "BANNED" });
  }

  if (new Date(foundKey.expiresAt) < new Date()) {
    foundKey.status = "EXPIRED";
    saveDB(db);
    return res.json({ success: false, message: "EXPIRED" });
  }

  const cleanUserHwid = (userHwid || "UNKNOWN").toString().trim();

  if (foundKey.hwid === "UNBOUND") {
    foundKey.hwid = cleanUserHwid;
    saveDB(db);
    addSystemLog(`HWID bound [${foundKey.clientName}]: ${cleanUserHwid}`, req);
    return res.json({ success: true, clientName: foundKey.clientName, expiresAt: foundKey.expiresAt, message: `Welcome ${foundKey.clientName}!` });
  } else if (foundKey.hwid === cleanUserHwid) {
    return res.json({ success: true, clientName: foundKey.clientName, expiresAt: foundKey.expiresAt, message: `Welcome ${foundKey.clientName}!` });
  } else {
    return res.json({ success: false, message: "HWID MISMATCH" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
