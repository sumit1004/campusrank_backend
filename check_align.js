const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');

async function testAlignment() {
  const bgPath = path.join(__dirname, 'assets', 'winner_bg.png');
  const bgBuffer = await fs.readFile(bgPath);
  const bgDataUrl = `data:image/png;base64,${bgBuffer.toString('base64')}`;

  const certId = "CR-210101-ABCDEF";
  const verifyUrl = `http://localhost:5173/verify-certificate/${certId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}&bgcolor=ffffff&margin=0`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
      html, body { margin:0; padding:0; width:1123px; height:794px; overflow:hidden; }
      .certificate { position:relative; width:1123px; height:794px; font-family:'Montserrat',sans-serif; }
      .bg { position:absolute; top:0; left:0; width:1123px; height:794px; object-fit:cover; }
      .txt { position:absolute; transform:translate(-50%, -50%); line-height:1; white-space:nowrap; color:#111; font-weight:700; font-size:13px; }
      
      .name      { top: 378px; left: 516px; font-size: 24px; }
      .course    { top: 420px; left: 456px; }
      .semester  { top: 421px; left: 678px; }
      .branch    { top: 418px; left: 838px; }
      .college   { top: 450px; left: 418px; }
      .position  { top: 450px; left: 701px; font-size: 14px; font-weight: 800; color: #1a3fc4; }
      .event     { top: 477px; left: 341px; }
      .date      { top: 480px; left: 679px; }
      .under     { top: 482px; left: 837px; }
      
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
      <img class="bg" src="${bgDataUrl}">
      <div class="txt name">Sumit Sharma</div>
      <div class="txt course">B.Tech</div>
      <div class="txt semester">6th Sem</div>
      <div class="txt branch">CSE</div>
      <div class="txt college">Rungta College of Engineering & Technology</div>
      <div class="txt position">Winner</div>
      <div class="txt event">CodeSprint 2026</div>
      <div class="txt date">20 Apr 2026</div>
      <div class="txt under">RSDC Club</div>

      <div class="cert-id">ID: ${certId}</div>
      <img class="qr" src="${qrUrl}" />
    </div>
  </body>
  </html>`;

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1123, height: 794 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(__dirname, 'assets', 'final_cert_id_qr_check.png') });
  await browser.close();
}

testAlignment();
