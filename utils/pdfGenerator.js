const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');

/**
 * Generate a pixel-perfect PDF certificate using the ABSOLUTE FINAL certificate PNG
 * as the static background and overlaying clean, absolute positioned text.
 */
const generateCertificatePDF = async (data) => {
  const { name, event_name, position, event_date, erp, college, course, branch, semester, issuer, certId: providedCertId } = data;

  // 1. Determine certificate type
  const isParticipant = position.toLowerCase() === 'participant';
  const showPosition  = !isParticipant;

  const displayPosition =
    position === 'runnerup1' ? '1st Runner Up' :
    position === 'runnerup2' ? '2nd Runner Up' :
    position.charAt(0).toUpperCase() + position.slice(1);

  // 2. Load background image as base64
  const bgFile = isParticipant ? 'participant_bg.png' : 'winner_bg.png';
  const bgPath = path.join(__dirname, '..', 'assets', bgFile);
  const bgBuffer = await fs.readFile(bgPath);
  const bgBase64 = bgBuffer.toString('base64');
  const bgDataUrl = `data:image/png;base64,${bgBase64}`;

  // 3. Setup IDs and QR
  // Use provided ID or generate a fallback
  const certId    = providedCertId || `CR-${erp}-${Date.now().toString(36).toUpperCase()}`;
  
  // VERIFICATION URL (Replace with your actual production domain)
  const verifyUrl = `http://localhost:5173/verify-certificate/${certId}`;
  
  // Create QR Code (using a stable API)
  const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}&bgcolor=ffffff&margin=0`;

  // 4. Format Date
  const formattedDate = event_date
    ? new Date(event_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  // 5. Build CLEAN HTML Template
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');

    html, body {
      margin: 0;
      padding: 0;
      width: 1123px;
      height: 794px;
      overflow: hidden;
    }

    .certificate {
      position: relative;
      width: 1123px;
      height: 794px;
      font-family: 'Montserrat', sans-serif;
    }

    .bg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .txt {
      position: absolute;
      transform: translate(-50%, -50%);
      line-height: 1;
      white-space: nowrap;
      color: #111111;
      font-weight: 700;
      font-size: 13px;
    }

    /* 
       === USER CALIBRATED POSITIONS (1123x794) ===
    */
    .name      { top: 378px; left: 516px; font-size: 24px; }
    .course    { top: 420px; left: 456px; }
    .semester  { top: 421px; left: 678px; }
    .branch    { top: 418px; left: 838px; }
    .college   { top: 450px; left: 418px; }
    .position  { top: 450px; left: 701px; font-size: 14px; font-weight: 800; color: #1a3fc4; }
    .event     { top: 477px; left: 341px; }
    .date      { top: 480px; left: 679px; }
    .under     { top: 482px; left: 837px; }
    
    /* Meta Identifiers */
    .cert-id {
      position: absolute;
      bottom: 25px;
      left: 20px;
      font-size: 10px;
      color: #666;
      font-weight: 600;
      letter-spacing: 1px;
    }

    .qr {
      position: absolute;
      bottom: 45px;
      right: 35px;
      width: 60px;
      height: 60px;
      padding: 3px;
      background: white;
      border: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <img class="bg" src="${bgDataUrl}" />

    <div class="txt name">${name}</div>
    <div class="txt course">${course}</div>
    <div class="txt semester">${semester}</div>
    <div class="txt branch">${branch}</div>
    <div class="txt college">${college}</div>
    
    ${showPosition ? `<div class="txt position">${displayPosition}</div>` : ''}
    
    <div class="txt event">${event_name}</div>
    <div class="txt date">${formattedDate}</div>
    <div class="txt under">${issuer || 'Campus Rank'}</div>

    <div class="cert-id">ID: ${certId}</div>
    <img class="qr" src="${qrUrl}" />
  </div>
</body>
</html>`;

  // 6. Generate PDF with Puppeteer
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1123, height: 794, deviceScaleFactor: 1 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `cert_${certId}.pdf`;
    const dirPath  = path.join(__dirname, '..', 'uploads', 'e-certificates');
    await fs.ensureDir(dirPath);
    const filePath = path.join(dirPath, fileName);

    await page.pdf({
      path: filePath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      scale: 1,
      margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
    });

    await browser.close();
    return `/uploads/e-certificates/${fileName}`;

  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
};

module.exports = { generateCertificatePDF };
