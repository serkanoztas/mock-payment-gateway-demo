// MAĞAZA SUNUCUSU (http://localhost:3000)
// Senin e-ticaret siten. Ödeme sağlayıcısına bağlanan taraf burası.
// EticSoft'un OpenCart/WHMCS modüllerinin yaptığı iş bu dosyanın yaptığı işe denk.

const http = require('http');
const crypto = require('crypto');
const cfg = require('./config');
const { imzala, imzaDogrula } = require('./lib/imza');
const { govdeOku, kacis, sayfa, html, json, yonlendir, otomatikForm } = require('./lib/yardimci');

// İstek ve sonuç imzasına giren alanlar (sağlayıcıyla aynı sırada olmalı)
const ISTEK_ALANLARI = ['magazaId', 'siparisNo', 'tutar', 'paraBirimi', 'basariUrl', 'hataUrl', 'zaman'];
const SONUC_ALANLARI = ['magazaId', 'siparisNo', 'islemNo', 'tutar', 'durum', 'mesaj', 'zaman'];

// Basit ürün kataloğu. Fiyatlar KURUŞ cinsinden tamsayı: para ile float kullanılmaz
// (0.1 + 0.2 = 0.30000000000000004 sorununu yaşamamak için).
const URUNLER = {
  kalem: { ad: 'Kalem', fiyat: 2500 },
  defter: { ad: 'Defter', fiyat: 7450 },
  canta: { ad: 'Sırt Çantası', fiyat: 89900 },
};

// "Veritabanı" — demo olduğu için bellekte. Sunucu kapanınca silinir.
const siparisler = new Map();

const tl = (kurus) => (kurus / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
const durumEtiketi = (d) =>
  ({ odendi: '<span class="ok">ÖDENDİ</span>', basarisiz: '<span class="hata">BAŞARISIZ</span>', bekliyor: '<span class="bekle">BEKLİYOR</span>' })[d] || kacis(d);

// Sonucu (tarayıcıdan veya webhook'tan gelsin) işleyen ortak fonksiyon.
// İki kanal da aynı sonucu getirebilir; bu yüzden işlem "idempotent" olmalı:
// aynı sonucu iki kez işlemek hiçbir şeyi bozmamalı.
function sonucuIsle(veri, kanal) {
  if (!imzaDogrula(veri, SONUC_ALANLARI, cfg.GIZLI_ANAHTAR, veri.imza)) {
    return { hata: 'İmza geçersiz — bu sonuç sağlayıcıdan gelmemiş veya değiştirilmiş.' };
  }
  const siparis = siparisler.get(veri.siparisNo);
  if (!siparis) return { hata: 'Sipariş bulunamadı.' };

  // İmza doğru olsa bile tutarı KENDİ kaydımızla karşılaştırıyoruz.
  if (Number(veri.tutar) !== siparis.tutar) return { hata: 'Tutar uyuşmuyor!' };

  if (siparis.durum !== 'bekliyor') return { siparis, zatenIslendi: true }; // sonuç zaten işlenmiş

  siparis.durum = veri.durum === 'basarili' ? 'odendi' : 'basarisiz';
  siparis.islemNo = veri.islemNo;
  siparis.mesaj = veri.mesaj;
  siparis.gecmis.push(`${new Date().toLocaleTimeString('tr-TR')} — ${kanal}: ${veri.durum}`);
  console.log(`[MAĞAZA] ${siparis.no} → ${siparis.durum} (${kanal})`);
  return { siparis };
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.MAGAZA_URL);
  try {
    // 1) Ürün sayfası
    if (req.method === 'GET' && url.pathname === '/') {
      const satirlar = Object.entries(URUNLER)
        .map(([id, u]) => `<tr><td>${u.ad}</td><td>${tl(u.fiyat)}</td>
          <td><input type="number" name="${id}" value="0" min="0" max="10" style="width:70px;margin:0"></td></tr>`)
        .join('');
      return html(res, sayfa('Demo Mağaza', `<h1>🛒 Demo Mağaza</h1>
        <form class="kart" method="POST" action="/odeme">
          <table><tr><th>Ürün</th><th>Fiyat</th><th>Adet</th></tr>${satirlar}</table><br>
          <button>Ödemeye geç</button></form>
        <p><a href="/siparisler">Siparişleri gör →</a></p>`));
    }

    // 2) Sipariş oluştur → imzala → tarayıcıyı sağlayıcıya gönder
    if (req.method === 'POST' && url.pathname === '/odeme') {
      const form = await govdeOku(req);

      // Tutarı SUNUCU hesaplar. Tarayıcıdan gelen fiyata asla güvenme.
      let tutar = 0;
      const kalemler = [];
      for (const [id, u] of Object.entries(URUNLER)) {
        const adet = Math.max(0, Math.min(10, parseInt(form[id], 10) || 0));
        if (adet) { tutar += adet * u.fiyat; kalemler.push(`${adet} × ${u.ad}`); }
      }
      if (!tutar) return yonlendir(res, '/');

      const no = 'SIP-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex');
      siparisler.set(no, { no, tutar, kalemler, durum: 'bekliyor', gecmis: ['Sipariş oluşturuldu'] });

      const istek = {
        magazaId: cfg.MAGAZA_ID,
        siparisNo: no,
        tutar: String(tutar),
        paraBirimi: 'TRY',
        basariUrl: `${cfg.MAGAZA_URL}/sonuc`,
        hataUrl: `${cfg.MAGAZA_URL}/sonuc`,
        zaman: String(Math.floor(Date.now() / 1000)),
      };
      istek.imza = imzala(istek, ISTEK_ALANLARI, cfg.GIZLI_ANAHTAR);
      console.log(`[MAĞAZA] ${no} oluşturuldu, ${tl(tutar)} — sağlayıcıya yönlendiriliyor`);
      return html(res, otomatikForm(`${cfg.SAGLAYICI_URL}/odeme`, istek, 'Güvenli ödeme sayfasına yönlendiriliyorsunuz...'));
    }

    // 3a) Tarayıcının sağlayıcıdan geri döndüğü adres
    if (req.method === 'POST' && url.pathname === '/sonuc') {
      const veri = await govdeOku(req);
      const s = sonucuIsle(veri, 'tarayıcı dönüşü');
      if (s.hata) return html(res, sayfa('Hata', `<h1>⚠️ Güvenlik hatası</h1><div class="kart hata">${kacis(s.hata)}</div><a href="/">Ana sayfa</a>`), 400);
      return yonlendir(res, `/siparis/${encodeURIComponent(s.siparis.no)}`);
    }

    // 3b) Webhook: sağlayıcı sunucusundan doğrudan gelen bildirim.
    // Kullanıcı ödemeden sonra sekmeyi kapatsa bile sipariş bu sayede güncellenir.
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const veri = await govdeOku(req);
      const s = sonucuIsle(veri, 'webhook');
      return json(res, s.hata ? { ok: false, hata: s.hata } : { ok: true }, s.hata ? 400 : 200);
    }

    // 4) Sipariş detayı
    const m = url.pathname.match(/^\/siparis\/(.+)$/);
    if (req.method === 'GET' && m) {
      const s = siparisler.get(decodeURIComponent(m[1]));
      if (!s) return html(res, sayfa('Yok', '<h1>Sipariş bulunamadı</h1>'), 404);
      return html(res, sayfa(s.no, `<h1>Sipariş ${kacis(s.no)}</h1><div class="kart">
        <p>Durum: ${durumEtiketi(s.durum)}</p><p>Tutar: <b>${tl(s.tutar)}</b></p>
        <p>Ürünler: ${kacis(s.kalemler.join(', '))}</p>
        ${s.islemNo ? `<p>Sağlayıcı işlem no: <code>${kacis(s.islemNo)}</code></p>` : ''}
        ${s.mesaj ? `<p>Mesaj: ${kacis(s.mesaj)}</p>` : ''}
        <p class="not">Geçmiş:<br>${s.gecmis.map(kacis).join('<br>')}</p></div>
        <a href="/">← Yeni alışveriş</a> · <a href="/siparisler">Tüm siparişler</a>`));
    }

    // 5) Sipariş listesi
    if (req.method === 'GET' && url.pathname === '/siparisler') {
      const satirlar = [...siparisler.values()].reverse()
        .map((s) => `<tr><td><a href="/siparis/${encodeURIComponent(s.no)}">${kacis(s.no)}</a></td><td>${tl(s.tutar)}</td><td>${durumEtiketi(s.durum)}</td></tr>`)
        .join('') || '<tr><td colspan="3">Henüz sipariş yok</td></tr>';
      return html(res, sayfa('Siparişler', `<h1>Siparişler</h1><div class="kart"><table>
        <tr><th>No</th><th>Tutar</th><th>Durum</th></tr>${satirlar}</table></div><a href="/">← Mağaza</a>`));
    }

    html(res, sayfa('404', '<h1>Sayfa bulunamadı</h1>'), 404);
  } catch (e) {
    console.error('[MAĞAZA] hata:', e);
    html(res, sayfa('Hata', '<h1>Sunucu hatası</h1>'), 500);
  }
});

if (require.main === module) {
  sunucu.listen(cfg.MAGAZA_PORT, () => console.log(`[MAĞAZA] ${cfg.MAGAZA_URL} adresinde çalışıyor`));
}
module.exports = { sunucu, siparisler };
