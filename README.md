<p align="center"><img src="docs/banner.png" alt="KediStat" width="640"></p>

<p align="center"><a href="https://buymeacoffee.com/sabanvurgun"><img src="https://img.buymeacoffee.com/button-api/?text=Bana%20bir%20kahve%20%C4%B1smarla&emoji=%E2%98%95&slug=sabanvurgun&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="60"></a></p>

# KediStat

**Türkçe** · [English](#english)

OpenWrt modemler için sade trafik izleyici: modemin toplam indirme/yükleme sayacı + cihaz başına indirme/yükleme.

## Kurulum

Modemde (SSH):

```
wget -qO- https://raw.githubusercontent.com/sabanvurgun03-ui/kedistat/main/kedistat-install.sh | sh
```

LuCI → **Araçlar** (yoksa **Hizmetler**) → **KediStat**.

## Ekran görüntüleri

<p align="center"><img src="docs/onizleme.png" alt="KediStat" width="420"></p>

*Örnek verilerle: canlı hız, dönem toplamları, cihaz kartları ve grafik.*

## Özellikler
- Canlı hız, oturum, bugün/dün/hafta/ay/toplam kartları ve önceki dönemle karşılaştırma
- Cihaz başına indirme/yükleme (IP, ad, MAC), bugün/hafta/ay/toplam
- 7 gün / 30 gün / 12 ay grafiği (üzerine gelince değerler)
- KediRay kuruluysa geçmiş verileri (günlük, aylık, cihaz başına) kurulumda otomatik içe aktarılır; elle: `kedistat import`
- Sayfadan GitHub güncellemesi: denetle / şimdi güncelle / günde bir otomatik denetim ve isteğe bağlı otomatik kurulum (sürüm aynı kalsa da depodaki yeni commit yakalanır)
- Yedekleme: panelden yedek dosyası indir / dosyadan geri yükle (`kedistat backup`, `kedistat restore-file`)
- İstatistikler kartı: GitHub deposundaki yıldız ve indirme sayısı (modem GitHub'dan okur, 6 saat önbellekler; indirme sayısı Release'teki `kedistat-install.sh` dosyasından gelir)
- Kart özelleştirme (⚙ Düzenle: bölümleri gizle/sırala, dönem kartlarını seç), yakınlaştırma (−/%/+, %60-160) ve koyu/açık/otomatik tema düğmesi (◐); ayarlar tarayıcıda saklanır
- Sayaçlar RAM'de tutulur, düzenli aralıkla flaşa yazılır; yeniden başlatmada geri yüklenir

## Komutlar
`kedistat stats | import | reset | backup | restore-file <dosya> | version | repostats [--json] | update [check] | uninstall`

## Notlar
- Gereksinim: OpenWrt 22.03+ (fw4/nft), ucode, LuCI
- Cihaz başına sayım yalnızca IPv4; donanım hızlandırma (NSS/flow offload) bazı trafiği atlayabilir
- Lisans: GPL-3.0

## Destek

KediStat ücretsiz ve açık kaynak. Beğendiysen:

<p align="center"><a href="https://buymeacoffee.com/sabanvurgun"><img src="https://img.buymeacoffee.com/button-api/?text=Bana%20bir%20kahve%20%C4%B1smarla&emoji=%E2%98%95&slug=sabanvurgun&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="60"></a></p>

---

## English

A plain traffic monitor for OpenWrt routers: the router's total download/upload counter plus per-device download/upload.

### Install

On the router (SSH):

```
wget -qO- https://raw.githubusercontent.com/sabanvurgun03-ui/kedistat/main/kedistat-install.sh | sh
```

LuCI → **Tools** (or **Services** if there is no Tools menu) → **KediStat**.

### Screenshots

<p align="center"><img src="docs/onizleme.png" alt="KediStat" width="420"></p>

*With sample data: live speed, period totals, device cards and chart.*

### Features

- Live speed, session, today / yesterday / week / month / total cards and comparison with the previous period
- Per-device download/upload (IP, name, MAC): today, week, month, total
- 7-day / 30-day / 12-month chart (values on hover)
- If KediRay is installed, its history (daily, monthly, per device) is imported automatically at install; by hand: `kedistat import`
- GitHub updates from the page: check / update now / daily automatic check and optional automatic install (a new commit in the repo is detected even when the version stays the same)
- Backup: download a backup file from the page / restore from a file (`kedistat backup`, `kedistat restore-file`)
- Statistics card: GitHub stars and downloads of the repo (the router reads them from GitHub and caches them for 6 hours; downloads come from `kedistat-install.sh` attached to a Release)
- Card customization (⚙ Edit: hide/reorder sections, choose period cards), zoom (−/%/+, 60-160%) and a dark/light/auto theme button (◐); settings are kept in the browser
- Counters are kept in RAM and written to flash at regular intervals; they are restored after a reboot

### Commands

`kedistat stats | import | reset | backup | restore-file <file> | version | repostats [--json] | update [check] | uninstall`

### Notes

- Requirements: OpenWrt 22.03+ (fw4/nft), ucode, LuCI
- Per-device counting is IPv4 only; hardware acceleration (NSS/flow offload) may skip some traffic
- License: GPL-3.0

### Support

KediStat is free and open source. If you like it:

<p align="center"><a href="https://buymeacoffee.com/sabanvurgun"><img src="https://img.buymeacoffee.com/button-api/?text=Bana%20bir%20kahve%20%C4%B1smarla&emoji=%E2%98%95&slug=sabanvurgun&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="60"></a></p>
