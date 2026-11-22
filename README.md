# Sahte Ödeme Sistemi Demosu (Node.js)

> ⚠️ **Eğitim amaçlıdır.** Bu proje gerçek bir ödeme sistemi değildir; gerçek para,
> banka veya kart ağı bağlantısı yoktur. **Gerçek kart bilgisi girmeyin**, sadece
> aşağıdaki test kartlarını kullanın.

Ödeme sistemlerinin (iPara, iyzico, PayTR, Stripe…) nasıl çalıştığını öğrenmek için
yazılmış, **tamamen sahte** ve **bağımlılıksız** bir proje: bir demo mağaza ile ona
bağlanan sahte bir ödeme sağlayıcısı (3D Secure dahil).

### English summary

An educational, dependency-free Node.js demo of how online card payments work.
It contains a demo shop and a mock payment provider that talk to each other the
way real gateways do: server-side amount calculation, HMAC-SHA256 signed requests
and responses, a hosted card form (card data never reaches the shop), a simulated
3D Secure step, server-to-server webhooks and idempotent result handling.
End-to-end tests cover tampering, forged results and replay attempts.
**Not a real payment system: never enter real card details.**

## Çalıştırma

```bash
node --version          # 20.12 veya üstü olmalı
cp .env.example .env    # sonra .env içindeki GIZLI_ANAHTAR değerini değiştir
npm start               # iki sunucuyu birlikte başlatır
npm test                # 7 uçtan uca test
```

`.env` oluşturmazsan proje yine çalışır; her başlatmada geçici rastgele bir anahtar
üretilir. Ama mağaza ve sağlayıcıyı ayrı terminallerde (`node magaza.js`,
`node saglayici.js`) çalıştıracaksan ikisinin aynı anahtarı bilmesi için `.env` şart.

- Mağaza: http://localhost:3000 ← buradan başla
- Sahte sağlayıcı paneli: http://localhost:4000

## Akış

```
 Tarayıcı           Mağaza (3000)                Sahte Sağlayıcı (4000)
    |  sepet  ------>  |                                   |
    |                  | tutarı HESAPLA, sipariş oluştur   |
    |                  | HMAC ile İMZALA                   |
    | <-- otomatik form (imzalı)                           |
    | ---------------------------------------------------> | imzayı + zamanı doğrula
    | <---------------------------------- kart formu ----- |
    | -- kart bilgisi -----------------------------------> | Luhn, SKT, CVV kontrolü
    | <---------------------------------- 3D Secure ------ |
    | -- SMS kodu (123456) ------------------------------> | bankanın kararı
    |                  | <======= WEBHOOK (imzalı) ======= | sunucudan sunucuya
    | <-------------------- imzalı sonuç formu ----------- |
    | -- sonuç ------> | imzayı + TUTARI doğrula           |
    |                  | siparişi ÖDENDİ / BAŞARISIZ yap   |
```

## Test kartları

| Kart | Sonuç |
|---|---|
| 4111 1111 1111 1111 | Başarılı |
| 5555 5555 5555 4444 | Başarılı |
| 4000 0000 0000 0002 | Yetersiz bakiye |
| 4000 0000 0000 0069 | Banka reddi |

SKT: gelecekteki herhangi bir tarih (ör. 12/30) · CVV: herhangi 3 hane · 3D kodu: `123456`

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `config.js` | Portlar, mağaza kimliği; gizli anahtarı `.env`'den okur |
| `.env.example` | `.env` için şablon (gerçek `.env` repoya girmez) |
| `lib/imza.js` | HMAC-SHA256 imzalama ve doğrulama, işin kalbi |
| `magaza.js` | E-ticaret sitesi (EticSoft modüllerinin yaptığı iş) |
| `saglayici.js` | Sahte ödeme sağlayıcısı + sahte banka/3D Secure |
| `test.js` | Tüm akışı ve saldırı senaryolarını test eder |

## Öğrenilecek güvenlik kuralları (koddaki yerleriyle)

1. **Tutarı sunucu hesaplar.** Tarayıcıdan gelen fiyata güvenilmez (`magaza.js` → `/odeme`).
2. **Her şey imzalanır.** Tarayıcıdan geçen veri değiştirilebilir; imza bunu yakalar (`lib/imza.js`).
3. **İmza doğru olsa bile tutar kendi kaydınla karşılaştırılır** (`sonucuIsle`).
4. **İdempotentlik.** Aynı sonuç iki kez gelirse (webhook + tarayıcı, ya da replay) bir şey bozulmaz.
5. **Webhook.** Kullanıcı sekmeyi kapatsa bile sipariş güncellenir.
6. **Zaman damgası.** Eski bir isteğin tekrar kullanılması engellenir.
7. **Kart verisi mağazaya hiç uğramaz.** Sağlayıcı da sadece son 4 haneyi saklar.
8. **`timingSafeEqual`.** İmza karşılaştırması zamanlama saldırısına karşı korunur.

## Kendin geliştirebileceğin şeyler

- İade (refund) ve kısmi iade
- Taksit seçenekleri ve komisyon hesabı
- Webhook başarısız olursa tekrar deneme (retry kuyruğu)
- Bellekteki verileri SQLite'a taşımak
- Sonra aynı mağazayı gerçek bir sandbox'a (iyzico/PayTR test ortamı) bağlamak
