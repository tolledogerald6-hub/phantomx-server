const express = require('express');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 4000;

const ADMIN_USER = "ADMIN";
const ADMIN_PASS = "LIEZL2026!";

// 📧 EMAIL CONFIGURATION
const RESORT_EMAIL = "tolledogerald6@gmail.com";
const GMAIL_APP_PASS = "hmnechkaznphhbok";

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: RESORT_EMAIL, pass: GMAIL_APP_PASS }
});

// 🔒 MULTI-DEVICE ADMIN SESSIONS
let activeSessions = new Set();

// ☁️ CLOUDINARY CONFIGURATION
cloudinary.config({
  cloud_name: 'q7iyxzr4',
  api_key: '454148557875984',
  api_secret: '454148557875984' 
});

// MULTER CLOUDINARY STORAGE (Inayos ang params syntax para iwas error)
const sliderStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'resort_sliders',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif']
  }
});

const facilityStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let resourceType = 'image';
    if (file.mimetype.startsWith('video') || req.body.mediaType === 'video') {
      resourceType = 'video';
    }
    return {
      folder: 'resort_facilities',
      resource_type: resourceType,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov']
    };
  }
});

const uploadSlider = multer({ storage: sliderStorage });
const uploadFacility = multer({ storage: facilityStorage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🍃 MONGODB ATLAS CONNECTION
const MONGO_URI = "mongodb+srv://geraldtolledo6_db_user:DSW1UVljW1d3Fk5S@cluster0.vthil0v.mongodb.net/casa_liezl_resort?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas Successfully!"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// MONGODB SCHEMAS & MODELS
const resortSchema = new mongoose.Schema({
  singleton: { type: String, default: "main_config", unique: true },
  bookings: { type: Array, default: [] },
  reviews: { 
    type: Array, 
    default: [{ id: 1, name: "Maria Clara", rating: 5, comment: "Napakaganda ng resort! Malinis ang tubig at mabait ang owner.", date: "10/24/2026" }] 
  },
  facilities: { type: Array, default: [] },
  rates: { 
    type: Object, 
    default: { dayTour: 150, nightTour: 180, overnight: 300 } 
  },
  gcashName: { type: String, default: "LIEZL RESORT" },
  gcashNumber: { type: String, default: "09XX-XXX-XXXX" }
});

const ResortModel = mongoose.model('ResortConfig', resortSchema);

// HELPER: GET OR CREATE DB DATA
async function getDB() {
  let doc = await ResortModel.findOne({ singleton: "main_config" });
  if (!doc) {
    doc = new ResortModel({ singleton: "main_config" });
    await doc.save();
  }
  return doc;
}

async function saveDB(data) {
  let doc = await ResortModel.findOne({ singleton: "main_config" });
  if (!doc) {
    doc = new ResortModel({ singleton: "main_config", ...data });
  } else {
    doc.bookings = data.bookings;
    doc.reviews = data.reviews;
    doc.facilities = data.facilities;
    doc.rates = data.rates;
    doc.gcashName = data.gcashName;
    doc.gcashNumber = data.gcashNumber;
  }
  await doc.save();
}

function authAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ success: false, message: "Unauthorized Admin Access!" });
  }
  next();
}

function sendEmailNotification(subject, text) {
  const mailOptions = {
    from: `"Casa Liezl Private Resort" <${RESORT_EMAIL}>`,
    to: RESORT_EMAIL,
    subject: subject,
    text: text
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("❌ Email Sending Failed Error:", err);
    else console.log("✅ Email Sent Successfully Response:", info.response);
  });
}

// SETTINGS API
app.get('/api/settings', async (req, res) => {
  const db = await getDB();
  res.json({ gcashName: db.gcashName, gcashNumber: db.gcashNumber, rates: db.rates });
});

app.post('/api/admin/settings', authAdmin, async (req, res) => {
  const { gcashName, gcashNumber, dayTour, nightTour, overnight } = req.body;
  const db = await getDB();
  if (gcashName !== undefined) db.gcashName = String(gcashName).trim();
  if (gcashNumber !== undefined) db.gcashNumber = String(gcashNumber).trim();
  db.rates = {
    dayTour: parseInt(dayTour) || db.rates.dayTour,
    nightTour: parseInt(nightTour) || db.rates.nightTour,
    overnight: parseInt(overnight) || db.rates.overnight
  };
  await saveDB(db);
  res.json({ success: true, message: "Settings updated successfully!" });
});

// PDF VOUCHER
app.get('/api/download-voucher/:id', async (req, res) => {
  const db = await getDB();
  const booking = db.bookings.find(b => b.id === parseInt(req.params.id));
  if (!booking) return res.status(404).send("Booking voucher not found.");

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-disposition', `attachment; filename="Voucher-${booking.id}.pdf"`);
  res.setHeader('Content-type', 'application/pdf');

  doc.pipe(res);
  doc.fillColor('#008080').fontSize(22).text('CASA LIEZL PRIVATE RESORT', { align: 'center' });
  doc.fontSize(12).fillColor('#666').text('Official Booking Receipt & Confirmation Voucher', { align: 'center' });
  doc.moveDown(1.5);
  doc.fillColor('#333').fontSize(12);
  doc.text(`Booking ID: #${booking.id}`);
  doc.text(`Date Issued: ${booking.createdAt}`);
  doc.moveDown(0.5);
  doc.strokeColor('#008080').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(1);
  doc.fontSize(14).fillColor('#004d4d').text('GUEST DETAILS', { underline: true });
  doc.fontSize(12).fillColor('#333');
  doc.text(`Guest Name: ${booking.name}`);
  doc.text(`Contact Phone: ${booking.phone}`);
  doc.moveDown(1);
  doc.fontSize(14).fillColor('#004d4d').text('RESERVATION DETAILS', { underline: true });
  doc.fontSize(12).fillColor('#333');
  doc.text(`Check-in Date: ${booking.checkInDate}`);
  doc.text(`Shift: ${booking.stayType}`);
  doc.text(`Accommodation: ${booking.packageType}`);
  doc.text(`Guests: ${booking.guests} Pax`);
  doc.text(`Special Notes: ${booking.notes || 'N/A'}`);
  doc.moveDown(1);
  doc.fontSize(14).fillColor('#004d4d').text('PAYMENT INFO', { underline: true });
  doc.fontSize(12).fillColor('#333');
  doc.text(`GCash Ref No: ${booking.gcashRef}`);
  doc.text(`Status: ${booking.status}`);
  doc.moveDown(2);
  doc.fontSize(10).fillColor('#888').text('Pakipakita ang PDF Voucher na ito sa entrance ng Casa Liezl Private Resort.', { align: 'center' });
  doc.end();
});

// REVIEWS APIS
app.get('/api/reviews', async (req, res) => {
  const db = await getDB();
  res.json(db.reviews || []);
});

app.post('/api/reviews', async (req, res) => {
  const { name, rating, comment } = req.body;
  if (!name || !comment) return res.json({ success: false, message: "Please enter your name and review!" });

  const db = await getDB();
  db.reviews.unshift({ id: Date.now(), name: name.trim(), rating: parseInt(rating) || 5, comment: comment.trim(), date: new Date().toLocaleDateString() });
  await saveDB(db);
  res.json({ success: true, message: "Thank you for your feedback!" });
});

app.delete('/api/reviews/:id', authAdmin, async (req, res) => {
  const db = await getDB();
  db.reviews = db.reviews.filter(r => r.id !== parseInt(req.params.id));
  await saveDB(db);
  res.json({ success: true });
});

// FACILITIES GALLERY APIS (CLOUD STORAGE)
app.get('/api/facilities', async (req, res) => {
  const db = await getDB();
  res.json(db.facilities || []);
});

app.post('/upload-facility', uploadFacility.single('facilityMedia'), async (req, res) => {
  try {
    if (!req.file) return res.redirect('/admin.html?error=nofile');

    const { facilityTitle, mediaType } = req.body;
    const db = await getDB();
    const isVideo = mediaType === 'video' || (req.file.mimetype && req.file.mimetype.startsWith('video'));

    const newFacility = {
      id: 'fac_' + Date.now(),
      title: facilityTitle ? facilityTitle.trim() : 'Resort Facility',
      type: isVideo ? 'video' : 'image',
      filename: req.file.path // Cloudinary Secure URL
    };

    db.facilities.unshift(newFacility);
    await saveDB(db);
    res.redirect('/admin.html');
  } catch (err) {
    console.error("Facility Upload Error:", err);
    res.redirect('/admin.html?error=upload_failed');
  }
});

app.delete('/api/facilities/:id', authAdmin, async (req, res) => {
  const db = await getDB();
  db.facilities = db.facilities.filter(f => f.id !== req.params.id);
  await saveDB(db);
  res.json({ success: true });
});

// BOOKED DATES
app.get('/api/booked-dates', async (req, res) => {
  const db = await getDB();
  res.json(db.bookings.filter(b => b.status === 'APPROVED').map(b => b.checkInDate));
});

// SLIDER APIS (CLOUD STORAGE)
app.get('/api/sliders', async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression('folder:resort_sliders')
      .sort_by('created_at', 'desc')
      .execute();
    const urls = result.resources.map(file => file.secure_url);
    res.json(urls);
  } catch (err) {
    res.json([]);
  }
});

app.post('/upload-slider', uploadSlider.single('sliderImage'), (req, res) => {
  try {
    res.redirect('/admin.html');
  } catch (err) {
    res.redirect('/admin.html?error=slider_failed');
  }
});

app.delete('/api/sliders/:public_id', authAdmin, async (req, res) => {
  try {
    const imageId = req.params.public_id;
    await cloudinary.uploader.destroy(`resort_sliders/${imageId}`);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Delete failed" });
  }
});

// BOOKING SUBMISSION API
app.post('/api/book', async (req, res) => {
  const { name, phone, checkInDate, stayType, packageType, guests, notes, gcashRef } = req.body;
  if (!name || !phone || !checkInDate || !gcashRef) return res.json({ success: false, message: "Please complete all required fields!" });

  const db = await getDB();
  if (db.bookings.some(b => b.checkInDate === checkInDate && b.status === 'APPROVED')) {
    return res.json({ success: false, message: "Sorry, this date is already fully booked." });
  }

  const bookingObj = {
    id: Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    checkInDate,
    stayType,
    packageType,
    guests: parseInt(guests) || 1,
    notes: notes ? notes.trim() : "",
    gcashRef: gcashRef.trim(),
    status: "PENDING",
    createdAt: new Date().toLocaleString()
  };

  db.bookings.unshift(bookingObj);
  await saveDB(db);

  const emailContent = 
    `🌴 BAGONG BOOKING REQUEST - CASA LIEZL PRIVATE RESORT 🌴\n\n` +
    `Name: ${bookingObj.name}\n` +
    `Phone: ${bookingObj.phone}\n` +
    `Check-in Date: ${bookingObj.checkInDate} (${bookingObj.stayType})\n` +
    `Package: ${bookingObj.packageType} (${bookingObj.guests} Pax)\n` +
    `GCash Reference No: ${bookingObj.gcashRef}\n` +
    `Notes: ${bookingObj.notes || 'Wala'}\n\n` +
    `Pakicheck ang Admin Panel para ma-verify ang GCash deposit!`;

  sendEmailNotification(`[CASA LIEZL PRIVATE] New Booking Request from ${bookingObj.name}`, emailContent);

  res.json({ success: true, message: "Reservation request submitted successfully!", bookingId: bookingObj.id });
});

// ADMIN APIS
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if ((username || '').trim().toUpperCase() === ADMIN_USER && (password || '').trim() === ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);

    if (activeSessions.size > 50) {
      const firstToken = activeSessions.values().next().value;
      activeSessions.delete(firstToken);
    }

    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: "Invalid Username or Password!" });
  }
});

app.get('/api/admin/bookings', authAdmin, async (req, res) => {
  const db = await getDB();
  res.json(db.bookings || []);
});

app.post('/api/admin/process-booking', authAdmin, async (req, res) => {
  const { id, action } = req.body;
  const db = await getDB();
  const target = db.bookings.find(b => b.id === parseInt(id));
  if (!target) return res.status(404).json({ success: false, message: "Booking not found" });

  if (action === 'APPROVE') target.status = 'APPROVED';
  else if (action === 'REJECT') target.status = 'REJECTED';

  await saveDB(db);

  sendEmailNotification(
    `[CASA LIEZL PRIVATE] Booking ${target.status}: ${target.name}`,
    `Ang reservation ni ${target.name} para sa petsang ${target.checkInDate} ay na-update ang status sa: ${target.status}`
  );

  res.json({ success: true, status: target.status });
});

app.listen(PORT, () => console.log(`Casa Liezl Private Resort Server running on port ${PORT} with MongoDB & Cloudinary!`));
