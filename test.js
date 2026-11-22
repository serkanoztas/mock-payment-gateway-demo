// Uçtan uca test: tarayıcının yaptığı her adımı kodla taklit eder.
// Çalıştır: npm test
const assert = require('assert');
const cfg = require('./config');
const { sunucu: magaza, siparisler } = require('./magaza');
const { sunucu: saglayici } = require('./saglayici');

const M = cfg.MAGAZA_URL, S = cfg.SAGLAYICI_URL;

// Otomatik formdaki gizli alanları çıkar (tarayıcının JS ile yaptığı submit'i taklit)
function formAlanlari(html) {
  const action = (html.match(/<form[^>]*action="([^"]+)"/) || [])[1];
  const alanlar = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    alanlar[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return { action: action && action.replace(/&amp;/g, '&'), alanlar };
}

async function post(adres, veri) {
  const r = await fetch(adres, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(veri).toString(),
  });
  return { durum: r.status, metin: await r.text(), konum: r.headers.get('location') };
}

async function odemeYap({ sepet, kart, kod = cfg.TEST_3D_KODU, oynama }) {
  let r = await post(`${M}/odeme`, sepet);
  let { action, alanlar } = formAlanlari(r.metin);
  if (oynama) oynama(alanlar);                       // saldırgan tarayıcıda veriyi değiştiriyor
  r = await post(action, alanlar);                   // → sağlayıcı
  if (r.durum !== 200) return { saglayiciRed: r };
  const islemNo = r.metin.match(/name="islemNo" value="([^"]+)"/)[1];
  r = await post(`${S}/odeme/kart`, { islemNo, adSoyad: 'Test Kullanici', skt: '12/30', cvv: '123', ...kart });
  if (r.durum !== 200) return { kartHatasi: r };
  r = await post(`${S}/odeme/3d`, { islemNo, kod });
  ({ action, alanlar } = formAlanlari(r.metin));
  const sonuc = await post(action, alanlar);         // → mağazaya dönüş
  return { siparis: siparisler.get(alanlar.siparisNo), sonuc, alanlar };
}

(async () => {
  await new Promise((ok) => saglayici.listen(cfg.SAGLAYICI_PORT, ok));
  await new Promise((ok) => magaza.listen(cfg.MAGAZA_PORT, ok));
  let gecen = 0;
  const test = async (ad, fn) => { await fn(); console.log('  ✓', ad); gecen++; };

  console.log('\nTestler:');
  await test('Başarılı ödeme siparişi ÖDENDİ yapar', async () => {
    const { siparis, sonuc } = await odemeYap({ sepet: { kalem: 2, defter: 1 }, kart: { kartNo: '4111 1111 1111 1111' } });
    assert.strictEqual(siparis.tutar, 2 * 2500 + 7450);
    assert.strictEqual(siparis.durum, 'odendi');
    assert.strictEqual(sonuc.durum, 302);
  });

  await test('Yetersiz bakiye kartı siparişi BAŞARISIZ yapar', async () => {
    const { siparis } = await odemeYap({ sepet: { canta: 1 }, kart: { kartNo: '4000000000000002' } });
    assert.strictEqual(siparis.durum, 'basarisiz');
    assert.match(siparis.mesaj, /bakiye/);
  });

  await test('Tarayıcıda tutarı değiştirmek imza kontrolüne takılır', async () => {
    const r = await odemeYap({ sepet: { canta: 1 }, kart: { kartNo: '4111111111111111' }, oynama: (a) => { a.tutar = '100'; } });
    assert.strictEqual(r.saglayiciRed.durum, 400);
    assert.match(r.saglayiciRed.metin, /İmza geçersiz/);
  });

  await test('Luhn hatalı kart numarası reddedilir', async () => {
    const r = await odemeYap({ sepet: { kalem: 1 }, kart: { kartNo: '4111111111111112' } });
    assert.match(r.kartHatasi.metin, /Kart numarası geçersiz/);
  });

  await test('3 kez yanlış 3D kodu ödemeyi başarısız yapar', async () => {
    let r = await post(`${M}/odeme`, { kalem: 1 });
    let f = formAlanlari(r.metin);
    r = await post(f.action, f.alanlar);
    const islemNo = r.metin.match(/name="islemNo" value="([^"]+)"/)[1];
    await post(`${S}/odeme/kart`, { islemNo, adSoyad: 'Test', kartNo: '4111111111111111', skt: '12/30', cvv: '123' });
    await post(`${S}/odeme/3d`, { islemNo, kod: '000000' });
    await post(`${S}/odeme/3d`, { islemNo, kod: '000000' });
    r = await post(`${S}/odeme/3d`, { islemNo, kod: '000000' });
    f = formAlanlari(r.metin);
    assert.strictEqual(siparisler.get(f.alanlar.siparisNo).durum, 'basarisiz');
  });

  await test('Sahte "ödendi" sonucu (imzasız) mağaza tarafından reddedilir', async () => {
    await post(`${M}/odeme`, { defter: 1 });
    const no = [...siparisler.keys()].pop();
    const r = await post(`${M}/sonuc`, { magazaId: cfg.MAGAZA_ID, siparisNo: no, islemNo: 'X', tutar: '7450', durum: 'basarili', mesaj: '', zaman: '1', imza: 'a'.repeat(64) });
    assert.strictEqual(r.durum, 400);
    assert.strictEqual(siparisler.get(no).durum, 'bekliyor');
  });

  await test('Aynı sonucu tekrar göndermek (replay) siparişi bozmaz', async () => {
    const { siparis, alanlar } = await odemeYap({ sepet: { kalem: 1 }, kart: { kartNo: '5555555555554444' } });
    const onceki = siparis.gecmis.length;
    await post(`${M}/sonuc`, alanlar);
    assert.strictEqual(siparis.durum, 'odendi');
    assert.strictEqual(siparis.gecmis.length, onceki);
  });

  console.log(`\n${gecen} test geçti.\n`);
  magaza.close(); saglayici.close();
})().catch((e) => { console.error('\n✗ TEST BAŞARISIZ:', e); process.exit(1); });
