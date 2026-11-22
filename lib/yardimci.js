// Küçük yardımcılar: istek gövdesini okuma, HTML üretme, yönlendirme.
// Express kullanmadık ki altta ne olduğunu gör.

const querystring = require('querystring');

function govdeOku(req) {
  return new Promise((resolve, reject) => {
    let veri = '';
    req.on('data', (parca) => {
      veri += parca;
      if (veri.length > 1e6) req.destroy(); // çok büyük istekleri kes
    });
    req.on('end', () => {
      const tur = req.headers['content-type'] || '';
      try {
        resolve(tur.includes('application/json') ? JSON.parse(veri || '{}') : querystring.parse(veri));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function kacis(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sayfa(baslik, icerik, renk = '#2563eb') {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${kacis(baslik)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1f2937;background:#f9fafb}
  .kart{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px}
  h1{font-size:22px;border-left:5px solid ${renk};padding-left:10px}
  button{background:${renk};color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}
  input{padding:9px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;width:100%;box-sizing:border-box;margin:4px 0 12px}
  table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
  code{background:#f3f4f6;padding:2px 5px;border-radius:4px;font-size:13px}
  .ok{color:#16a34a;font-weight:600}.hata{color:#dc2626;font-weight:600}.bekle{color:#d97706;font-weight:600}
  .not{font-size:13px;color:#6b7280}
</style></head><body>${icerik}</body></html>`;
}

function html(res, govde, kod = 200) {
  res.writeHead(kod, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(govde);
}

function json(res, nesne, kod = 200) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(nesne));
}

function yonlendir(res, adres) {
  res.writeHead(302, { Location: adres });
  res.end();
}

// Tarayıcıyı başka bir sunucuya POST ile gönderen otomatik form.
// Gerçek ödeme sistemleri (ve 3D Secure) tam olarak böyle çalışır.
function otomatikForm(hedef, alanlar, mesaj = 'Yönlendiriliyorsunuz...') {
  const gizliler = Object.entries(alanlar)
    .map(([k, v]) => `<input type="hidden" name="${kacis(k)}" value="${kacis(v)}">`)
    .join('');
  return sayfa(mesaj, `<div class="kart"><p>${kacis(mesaj)}</p>
<form id="f" method="POST" action="${kacis(hedef)}">${gizliler}<noscript><button>Devam</button></noscript></form>
<script>document.getElementById('f').submit()</script></div>`);
}

module.exports = { govdeOku, kacis, sayfa, html, json, yonlendir, otomatikForm };
