<p align="center"><img src="docs/banner.png" alt="KediStat" width="640"></p>

<p align="center"><a href="https://buymeacoffee.com/sabanvurgun"><img src="https://img.buymeacoffee.com/button-api/?text=Bana%20bir%20kahve%20%C4%B1smarla&emoji=%E2%98%95&slug=sabanvurgun&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="60"></a></p>

# KediStat

OpenWrt modemler için sade trafik izleyici (netstat mantığı): modemin toplam indirme/yükleme sayacı + cihaz başına indirme/yükleme. VPN/Direkt ayrımı yoktur.

## Kurulum

Modemde (SSH):

```
wget -qO- https://raw.githubusercontent.com/sabanvurgun03-ui/kedistat/main/kedistat-install.sh | sh
```

LuCI → **Araçlar** (yoksa **Hizmetler**) → **KediStat Trafik**.

## Ekran görüntüleri

<p align="center"><img src="docs/onizleme.png" alt="KediStat Trafik sayfası" width="420">&nbsp;&nbsp;<img src="docs/onizleme-mobil.png" alt="KediStat mobil görünüm" width="260"></p>

*Örnek (sentetik) verilerle: canlı hız, dönem toplamları, cihaz kartları ve grafik.*

## Özellikler
- Canlı hız, oturum, bugün/dün/hafta/ay/toplam kartları ve önceki dönemle karşılaştırma
- Cihaz başına indirme/yükleme (IP, ad, MAC), bugün/hafta/ay/toplam
- 7 gün / 30 gün / 12 ay grafiği (üzerine gelince değerler)
- KediRay kuruluysa geçmiş verileri (günlük, aylık, cihaz başına) kurulumda otomatik içe aktarılır; elle: `kedistat import`
- Sayfadan GitHub güncellemesi: denetle / şimdi güncelle / günde bir otomatik denetim ve isteğe bağlı otomatik kurulum (sürüm aynı kalsa da depodaki yeni commit yakalanır)
- Yedekleme: panelden yedek dosyası indir / dosyadan geri yükle (`kedistat backup`, `kedistat restore-file`)
- Sayaçlar RAM'de tutulur, düzenli aralıkla flaşa yazılır; yeniden başlatmada geri yüklenir

## Komutlar
`kedistat stats | import | reset | version | update [check] | uninstall`

## Notlar
- Gereksinim: OpenWrt 22.03+ (fw4/nft), ucode, LuCI
- Cihaz başına sayım yalnızca IPv4; donanım hızlandırma (NSS/flow offload) bazı trafiği atlayabilir
- Lisans: GPL-3.0

## Destek

KediStat ücretsiz ve açık kaynak. Beğendiysen:

<p align="center"><a href="https://buymeacoffee.com/sabanvurgun"><img src="https://img.buymeacoffee.com/button-api/?text=Bana%20bir%20kahve%20%C4%B1smarla&emoji=%E2%98%95&slug=sabanvurgun&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="60"></a></p>
