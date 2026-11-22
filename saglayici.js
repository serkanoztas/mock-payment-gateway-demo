// SAHTE ÖDEME SAĞLAYICISI (http://localhost:4000)
// iPara / iyzico / PayTR'nin yerine geçen taraf. Kart bilgisini SADECE bu sunucu görür;
// mağaza kart numarasını hiç bilmez. (Gerçek hayatta bu, PCI-DSS yükünü mağazadan alır.)
// Banka ve 3D Secure adımı da burada taklit ediliyor.

const http = require('http');
const crypto = require('crypto');
const cfg = require('./config');
const { imzala, imzaDogrula } = require('./lib/imza');
const { govdeOku, kacis, sayfa, html, otomatikForm } = require('./lib/yardimci');

const ISTEK_ALANLARI = ['magazaId', 'siparisNo', 'tutar', 'paraBirimi', 'basariUrl', 'hataUrl', 'zaman'];
const SONUC_ALANLARI = ['magazaId', 'siparisNo', 'islemNo', 'tutar', 'durum', 'mesaj', 'zaman'];

// Kayıtlı mağazalar: magazaId → gizli anahtar
const MAGAZALAR = { [cfg.MAGAZA_ID]: cfg.GIZLI_ANAHTAR };

// Test kartları ve bankanın vereceği cevap
const TEST_KARTLARI = {
  '4111111111111111': { sonuc: 'basarili' },
  '5555555555554444': { sonuc: 'basarili' },
  '4000000000000002': { sonuc: 'red', mesaj: 'Yetersiz bakiye' },
  '4000000000000069': { sonuc: 'red', mesaj: 'Kartın süresi dolmuş (banka reddi)' },
};

// Ödeme oturumları. Kart numarasının TAMAMI asla saklanmaz, sadece son 4 hane.
const islemler = new Map();

const tl = (kurus) => (Number(kurus) / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });

// Luhn algoritması: kart numarasının yazım hatası içerip içermediğini kontrol eder.
function luhnGecerli(no) {
  let toplam = 0;
  for (let i = 0; i < no.length; i++) {
    let d = Number(no[no.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    toplam += d;
  }
  return no.length >= 12 && toplam % 10 === 0;
}

function kartKontrol({ kartNo, skt, cvv, adSoyad }) {
  const no = String(kartNo || '').replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(no) || !luhnGecerli(no)) return 'Kart numarası geçersiz.';
  const m = String(skt || '').match(/^(\d{2})\/(\d{2})$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return 'Son kullanma tarihi AA/YY biçiminde olmalı.';
  const sonGun = new Date(2000 + +m[2], +m[1], 0, 23, 59, 59);
  if (sonGun < new Date()) return 'Kartın son kullanma tarihi geçmiş.';
  if (!/^\d{3,4}$/.test(String(cvv || ''))) return 'CVV 3 veya 4 haneli olmalı.';
  if (String(adSoyad || '').trim().length < 3) return 'Kart üzerindeki ismi girin.';
  return null;
}

// Sonucu mağazaya iki yoldan iletir: (1) webhook — sunucudan sunucuya,
// (2) tarayıcıyı imzalı bir formla mağazaya geri göndermek.
async function sonucuGonder(res, islem, durum, mesaj) {
  islem.durum = durum;
  const sonuc = {
    magazaId: islem.magazaId,
    siparisNo: islem.siparisNo,
    islemNo: islem.id,
    tutar: islem.tutar,
    durum,
    mesaj,
    zaman: String(Math.floor(Date.now() / 1000)),
  };
  sonuc.imza = imzala(sonuc, SONUC_ALANLARI, MAGAZALAR[islem.magazaId]);
  console.log(`[SAĞLAYICI] ${islem.id} → ${durum}${mesaj ? ' (' + mesaj + ')' : ''}`);

  try {
    const r = await fetch(`${cfg.MAGAZA_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sonuc),
    });
    console.log(`[SAĞLAYICI] webhook gönderildi → HTTP ${r.status}`);
  } catch (e) {
    // Gerçek sağlayıcılar burada belirli aralıklarla tekrar dener (retry).
    console.log('[SAĞLAYICI] webhook ulaşmadı:', e.message);
  }

  const hedef = durum === 'basarili' ? islem.basariUrl : islem.hataUrl;
  return html(res, otomatikForm(hedef, sonuc, 'Mağazaya geri dönülüyor...'));
}

function kartSayfasi(islem, hata = '') {
  return sayfa('Güvenli Ödeme', `<h1>🔒 SahtePay Güvenli Ödeme</h1>
  <div class="kart"><p>Mağaza: <b>${kacis(islem.magazaId)}</b><br>Sipariş: <code>${kacis(islem.siparisNo)}</code><br>
  Ödenecek: <b style="font-size:20px">${tl(islem.tutar)}</b></p></div>
  ${hata ? `<div class="kart hata">${kacis(hata)}</div>` : ''}
  <form class="kart" method="POST" action="/odeme/kart">
    <input type="hidden" name="islemNo" value="${kacis(islem.id)}">
    <label>Kart üzerindeki isim<input name="adSoyad" autocomplete="off" placeholder="Ad Soyad"></label>
    <label>Kart numarası<input name="kartNo" autocomplete="off" inputmode="numeric" placeholder="4111 1111 1111 1111"></label>
    <div style="display:flex;gap:12px"><label style="flex:1">SKT<input name="skt" placeholder="12/30"></label>
    <label style="flex:1">CVV<input name="cvv" placeholder="123"></label></div>
    <button>${tl(islem.tutar)} öde</button>
  </form>
  <div class="kart not"><b>Test kartları</b> (sadece bunları kullan, gerçek kart girme):<br>
  <code>4111 1111 1111 1111</code> başarılı · <code>5555 5555 5555 4444</code> başarılı<br>
  <code>4000 0000 0000 0002</code> yetersiz bakiye · <code>4000 0000 0000 0069</code> banka reddi<br>
  SKT: gelecekte herhangi bir tarih · CVV: herhangi 3 hane · 3D kodu: <code>${cfg.TEST_3D_KODU}</code></div>
  <form method="POST" action="/odeme/iptal"><input type="hidden" name="islemNo" value="${kacis(islem.id)}">
  <button style="background:#6b7280">İptal et ve mağazaya dön</button></form>`, '#7c3aed');
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.SAGLAYICI_URL);
  try {
    // 1) Mağazadan gelen ödeme isteği: imzayı ve zamanı doğrula, oturum aç
    if (req.method === 'POST' && url.pathname === '/odeme') {
      const istek = await govdeOku(req);
      const anahtar = MAGAZALAR[istek.magazaId];
      if (!anahtar) return html(res, sayfa('Hata', '<h1>Tanımsız mağaza</h1>'), 400);
      if (!imzaDogrula(istek, ISTEK_ALANLARI, anahtar, istek.imza)) {
        console.log('[SAĞLAYICI] REDDEDİLDİ: imza geçersiz (veri değiştirilmiş olabilir)');
        return html(res, sayfa('Hata', '<h1>⚠️ İmza geçersiz</h1><p>İstek değiştirilmiş. Ödeme başlatılmadı.</p>'), 400);
      }
      const yas = Math.floor(Date.now() / 1000) - Number(istek.zaman);
      if (!(yas >= -60 && yas <= cfg.ISTEK_GECERLILIK_SN)) {
        return html(res, sayfa('Hata', '<h1>İsteğin süresi dolmuş</h1>'), 400);
      }
      // Aynı sipariş için ikinci kez ödeme açılmasın
      for (const i of islemler.values()) {
        if (i.siparisNo === istek.siparisNo && i.magazaId === istek.magazaId) {
          return html(res, sayfa('Hata', '<h1>Bu sipariş için zaten ödeme başlatılmış</h1>'), 409);
        }
      }
      const islem = {
        id: 'TRX-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
        ...istek,
        durum: 'kart_bekleniyor',
        denemeler: 0,
      };
      islemler.set(islem.id, islem);
      console.log(`[SAĞLAYICI] ${islem.id} açıldı: ${islem.siparisNo}, ${tl(islem.tutar)}`);
      return html(res, kartSayfasi(islem));
    }

    // 2) Kart bilgisi geldi → doğrula → 3D Secure ekranına geç
    if (req.method === 'POST' && url.pathname === '/odeme/kart') {
      const form = await govdeOku(req);
      const islem = islemler.get(form.islemNo);
      if (!islem || islem.durum !== 'kart_bekleniyor') return html(res, sayfa('Hata', '<h1>Geçersiz veya tamamlanmış işlem</h1>'), 400);

      const hata = kartKontrol(form);
      if (hata) return html(res, kartSayfasi(islem, hata), 400);

      const no = String(form.kartNo).replace(/\s+/g, '');
      islem.kartSon4 = no.slice(-4);
      islem.bankaCevabi = TEST_KARTLARI[no] || { sonuc: 'red', mesaj: 'Bu demo sadece test kartlarını kabul eder' };
      islem.durum = '3d_bekleniyor';

      return html(res, sayfa('3D Secure', `<h1>🏦 Banka 3D Secure Doğrulama</h1>
        <div class="kart"><p>**** **** **** ${kacis(islem.kartSon4)} numaralı kartınızla<br>
        <b>${kacis(islem.magazaId)}</b> için <b>${tl(islem.tutar)}</b> tutarında işlem.</p>
        <p class="not">Telefonunuza gönderilen kodu girin. (Demo kodu: <code>${cfg.TEST_3D_KODU}</code>)</p>
        <form method="POST" action="/odeme/3d"><input type="hidden" name="islemNo" value="${kacis(islem.id)}">
        <input name="kod" maxlength="6" autocomplete="one-time-code" placeholder="______"><button>Onayla</button></form></div>`, '#059669'));
    }

    // 3) 3D Secure kodu → bankanın kararı → sonucu mağazaya bildir
    if (req.method === 'POST' && url.pathname === '/odeme/3d') {
      const form = await govdeOku(req);
      const islem = islemler.get(form.islemNo);
      if (!islem || islem.durum !== '3d_bekleniyor') return html(res, sayfa('Hata', '<h1>Geçersiz veya tamamlanmış işlem</h1>'), 400);

      if (form.kod !== cfg.TEST_3D_KODU) {
        islem.denemeler++;
        if (islem.denemeler >= 3) return sonucuGonder(res, islem, 'basarisiz', '3D Secure doğrulaması başarısız (3 hatalı deneme)');
        return html(res, sayfa('3D Secure', `<h1>🏦 Hatalı kod</h1><div class="kart">
          <p class="hata">Kod yanlış. Kalan deneme: ${3 - islem.denemeler}</p>
          <form method="POST" action="/odeme/3d"><input type="hidden" name="islemNo" value="${kacis(islem.id)}">
          <input name="kod" maxlength="6"><button>Onayla</button></form></div>`, '#059669'), 400);
      }

      const { sonuc, mesaj } = islem.bankaCevabi;
      return sonucuGonder(res, islem, sonuc === 'basarili' ? 'basarili' : 'basarisiz', mesaj || 'Ödeme onaylandı');
    }

    // Kullanıcı vazgeçti
    if (req.method === 'POST' && url.pathname === '/odeme/iptal') {
      const form = await govdeOku(req);
      const islem = islemler.get(form.islemNo);
      if (!islem || !['kart_bekleniyor', '3d_bekleniyor'].includes(islem.durum)) return html(res, sayfa('Hata', '<h1>Geçersiz işlem</h1>'), 400);
      return sonucuGonder(res, islem, 'basarisiz', 'Kullanıcı ödemeyi iptal etti');
    }

    // Sağlayıcı paneli: tüm işlemler (gerçek sağlayıcılardaki "üye işyeri paneli" gibi)
    if (req.method === 'GET' && url.pathname === '/') {
      const satirlar = [...islemler.values()].reverse()
        .map((i) => `<tr><td><code>${kacis(i.id)}</code></td><td>${kacis(i.siparisNo)}</td><td>${tl(i.tutar)}</td>
          <td>${i.kartSon4 ? '•••• ' + kacis(i.kartSon4) : '-'}</td><td>${kacis(i.durum)}</td></tr>`)
        .join('') || '<tr><td colspan="5">Henüz işlem yok</td></tr>';
      return html(res, sayfa('SahtePay Panel', `<h1>SahtePay — Üye İşyeri Paneli</h1><div class="kart"><table>
        <tr><th>İşlem</th><th>Sipariş</th><th>Tutar</th><th>Kart</th><th>Durum</th></tr>${satirlar}</table></div>`, '#7c3aed'));
    }

    html(res, sayfa('404', '<h1>Sayfa bulunamadı</h1>'), 404);
  } catch (e) {
    console.error('[SAĞLAYICI] hata:', e);
    html(res, sayfa('Hata', '<h1>Sunucu hatası</h1>'), 500);
  }
});

if (require.main === module) {
  sunucu.listen(cfg.SAGLAYICI_PORT, () => console.log(`[SAĞLAYICI] ${cfg.SAGLAYICI_URL} adresinde çalışıyor`));
}
module.exports = { sunucu, islemler, luhnGecerli };
