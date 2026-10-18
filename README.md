# KediStat

OpenWrt modemler için sade trafik izleyici (netstat mantığı): modemin toplam indirme/yükleme sayacı + cihaz başına indirme/yükleme. VPN/Direkt ayrımı yoktur.

## Kurulum

Modemde (SSH):

```
wget -qO- https://raw.githubusercontent.com/sabanvurgun03-ui/kedistat/main/kedistat-install.sh | sh
```

LuCI → Durum → **KediStat Trafik**.

## Özellikler
- Canlı hız, oturum, bugün/dün/hafta/ay/toplam kartları ve önceki dönemle karşılaştırma
- Cihaz başına indirme/yükleme (IP, ad, MAC), bugün/hafta/ay/toplam
- 7 gün / 30 gün / 12 ay grafiği (üzerine gelince değerler)
- Sayaçlar RAM'de tutulur, düzenli aralıkla flaşa yazılır; yeniden başlatmada geri yüklenir

## Komutlar
`kedistat stats | reset | version | update [check] | uninstall`

## Notlar
- Gereksinim: OpenWrt 22.03+ (fw4/nft), ucode, LuCI
- Cihaz başına sayım yalnızca IPv4; donanım hızlandırma (NSS/flow offload) bazı trafiği atlayabilir
- Lisans: GPL-3.0
