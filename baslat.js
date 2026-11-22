// İki sunucuyu birlikte başlatır: npm start
const cfg = require('./config');
const { sunucu: magaza } = require('./magaza');
const { sunucu: saglayici } = require('./saglayici');

saglayici.listen(cfg.SAGLAYICI_PORT, () => console.log(`[SAĞLAYICI] ${cfg.SAGLAYICI_URL} (panel)`));
magaza.listen(cfg.MAGAZA_PORT, () => console.log(`[MAĞAZA]    ${cfg.MAGAZA_URL}  ← buradan başla`));
