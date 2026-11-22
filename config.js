// Ortak ayarlar.
// GIZLI_ANAHTAR koda yazılmaz; .env dosyasından okunur ve sadece mağaza sunucusu
// ile ödeme sağlayıcısı bilir. Tarayıcı bunu ASLA görmez.

const crypto = require('crypto');

// .env dosyası varsa yükle (Node 20.12+ yerleşik özelliği, paket gerekmez)
try {
  process.loadEnvFile();
} catch {
  /* .env yok — aşağıdaki geçici anahtar kullanılacak */
}

let gizliAnahtar = process.env.GIZLI_ANAHTAR;
if (!gizliAnahtar) {
  // Anahtar yoksa her çalıştırmada rastgele bir tane üret. npm start ve npm test
  // iki sunucuyu tek süreçte çalıştırdığı için bu yeterli; sunucuları ayrı ayrı
  // başlatacaksan .env dosyası oluşturman gerekir (bkz. .env.example).
  gizliAnahtar = crypto.randomBytes(32).toString('hex');
  console.warn('[CONFIG] GIZLI_ANAHTAR tanımlı değil, geçici rastgele anahtar kullanılıyor. (.env.example dosyasına bak)');
}

module.exports = {
  MAGAZA_PORT: 3000,
  SAGLAYICI_PORT: 4000,

  MAGAZA_URL: 'http://localhost:3000',
  SAGLAYICI_URL: 'http://localhost:4000',

  // Sağlayıcının mağazaya verdiği kimlik bilgileri (iPara/iyzico'daki "public key / private key" gibi)
  MAGAZA_ID: 'demo-magaza-001',
  GIZLI_ANAHTAR: gizliAnahtar,

  // İmzalı bir istek kaç saniye geçerli? (Eski isteğin tekrar gönderilmesine karşı)
  ISTEK_GECERLILIK_SN: 600,

  // Sahte 3D Secure SMS kodu
  TEST_3D_KODU: '123456',
};
