// İmzalama (hash) mantığı — ödeme sistemlerinin kalbi burası.
//
// Amaç: Tarayıcı üzerinden taşınan verinin (tutar, sipariş no...) yolda
// DEĞİŞTİRİLMEDİĞİNİ kanıtlamak. Tarayıcı kullanıcının elindedir; kullanıcı
// 500 TL'lik siparişi 1 TL yapmaya çalışabilir. İmza bunu engeller.
//
// Yöntem: HMAC-SHA256. Alanları sabit bir sırayla birleştirip gizli anahtarla
// özetliyoruz. Gizli anahtarı bilmeyen kimse geçerli bir imza üretemez.

const crypto = require('crypto');

function imzaMetni(alanlar, anahtarlar) {
  // Sıra çok önemli: iki taraf da AYNI sırayla birleştirmeli.
  return anahtarlar.map((k) => `${k}=${alanlar[k] ?? ''}`).join('|');
}

function imzala(alanlar, anahtarlar, gizliAnahtar) {
  return crypto
    .createHmac('sha256', gizliAnahtar)
    .update(imzaMetni(alanlar, anahtarlar))
    .digest('hex');
}

function imzaDogrula(alanlar, anahtarlar, gizliAnahtar, gelenImza) {
  const beklenen = imzala(alanlar, anahtarlar, gizliAnahtar);
  if (typeof gelenImza !== 'string' || gelenImza.length !== beklenen.length) return false;
  // timingSafeEqual: karşılaştırma süresinden imza tahmin edilmesini (timing attack) önler.
  return crypto.timingSafeEqual(Buffer.from(beklenen), Buffer.from(gelenImza));
}

module.exports = { imzala, imzaDogrula, imzaMetni };
