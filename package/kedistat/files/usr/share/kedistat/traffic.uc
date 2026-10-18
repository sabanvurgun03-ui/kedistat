'use strict';
// KediStat trafik sayacı: modemin toplam indirme/yükleme baytları (WAN arayüzü sayacı) ve LAN'daki her cihazın
// (IP başına nft sayacı) indirme/yükleme baytları günlük kovalarda tutulur.
//   ucode traffic.uc sample [save]   (KS_WR KS_WT KS_DEVF ortamdan)  -> farkı bugünün kovasına ekler
//   ucode traffic.uc report          (aynı ortam)                    -> şu anki sayaçlar + dönemler + 30 gün + aylar + cihazlar
//   ucode traffic.uc save | restore | reset
// r = indirme (modeme/cihaza gelen), t = yükleme (modemden/cihazdan giden)
const fs = require('fs');
const RUN = getenv('KS_RUN') || '/var/etc/kedistat';
const RAMF = RUN + '/traffic.json';
const FLASHF = getenv('KS_TRAFFIC_FLASH') || '/etc/kedistat.traffic.json';
const CMD = ARGV[0];

function readj(p) { try { let t = fs.readfile(p); return t ? json(t) : null; } catch (e) { return null; } }
function writej(p, v) { fs.writefile(p + '.tmp', sprintf('%J', v)); fs.rename(p + '.tmp', p); }
function n(v) { let x = int(v ?? 0); return x != x ? 0 : x; }
function dkey(ts) { let t = localtime(ts); return sprintf('%04d-%02d-%02d', t.year, t.mon, t.mday); }
function cur() { return { wr: n(getenv('KS_WR')), wt: n(getenv('KS_WT')), t: time() }; }
// Bir sayaç o an okunamadıysa (boş döndü) 0 SAYILMAZ: son bilinen değer taşınır (0 sayılırsa sonraki okuma çift sayılırdı).
function fixc(c, l) {
	for (let k in ['wr', 'wt'])
		if (!length(getenv('KS_' + uc(k)) ?? '')) c[k] = n(l?.[k]);
	return c;
}
function load() {
	let s = readj(RAMF) ?? readj(FLASHF) ?? {};
	s.days ??= {};
	s.dev ??= {};
	return s;
}
// sayaç sıfırlanmışsa (modem yeniden başladı / tablo yeniden kuruldu) fark = şimdiki değer
function d(c, l) { return c >= l ? c - l : c; }
function delta(s, c) {
	let l = s.last;
	if (!l) return null;
	return { r: d(c.wr, l.wr), t: d(c.wt, l.wt) };
}
function add(b, x) { b.r = n(b.r) + n(x.r); b.t = n(b.t) + n(x.t); }
function bk(v) { return { r: n(v?.r), t: n(v?.t) }; }

// ---------- cihaz bazlı sayaçlar ----------
// KS_DEVF satırları: "ip<TAB>rx|tx<TAB>bayt"  (rx = cihaza gelen, tx = cihazdan giden)
function readdev() {
	let r = {}, f = getenv('KS_DEVF');
	if (!f) return {};
	for (let l in split(fs.readfile(f) ?? '', '\n')) {
		let p = split(l, '\t');
		if (length(p) < 3 || !match(p[0], /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) continue;
		if (p[1] != 'rx' && p[1] != 'tx') continue;
		r[p[0]] ??= { rx: null, tx: null };
		r[p[0]][p[1]] = n(p[2]);
	}
	// yalnız iki yönü de okunabilen cihazlar: bir zincir okunamadıysa o cihaz bu turda atlanır (0 sayılmaz)
	let out = {};
	for (let ip, v in r) if (v.rx != null && v.tx != null) out[ip] = v;
	return out;
}
function leases() { // ip -> { mac, name }
	let r = {};
	for (let l in split(fs.readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(l, ' ');
		if (length(f) >= 4) r[f[2]] = { mac: lc(f[1]), name: f[3] != '*' ? f[3] : '' };
	}
	return r;
}
function devlive(e, c) { // son örneklemeden bu yana (henüz kovaya yazılmamış) fark
	if (!c) return { rx: 0, tx: 0 };
	let l = e.last ?? { rx: 0, tx: 0 };
	return { rx: d(n(c.rx), n(l.rx)), tx: d(n(c.tx), n(l.tx)) };
}
function devsample(s, c) {
	let cd = readdev(), ls = leases(), day = dkey(c.t);
	for (let ip, v in cd) {
		s.dev[ip] ??= { days: {} };
		let e = s.dev[ip];
		let x = devlive(e, v);
		e.days ??= {};
		e.days[day] ??= { rx: 0, tx: 0 };
		e.days[day].rx = n(e.days[day].rx) + x.rx;
		e.days[day].tx = n(e.days[day].tx) + x.tx;
		if (x.rx + x.tx > 0) e.active = c.t;   // son trafik zamanı (bağlı mı kararında kullanılır)
		e.last = { rx: n(v.rx), tx: n(v.tx) };
		if (ls[ip]) { e.mac = ls[ip].mac; if (ls[ip].name) e.name = ls[ip].name; }
		e.seen = c.t;
	}
	// 100 günden eski günleri ve boş kalan cihazları at
	let cut = dkey(c.t - 100 * 86400);
	for (let ip in keys(s.dev)) {
		let e = s.dev[ip];
		for (let k in keys(e.days ?? {})) if (k < cut) delete e.days[k];
		if (!length(keys(e.days ?? {})) && !cd[ip]) delete s.dev[ip];
	}
}

if (CMD == 'sample') {
	let s = load(), c = fixc(cur(), s.last), x = delta(s, c);
	if (x) { s.days[dkey(c.t)] ??= {}; add(s.days[dkey(c.t)], x); }
	// oturum toplamı: modem açılışından beri (restore açılışta sıfırlar)
	s.sess ??= { r: 0, t: 0 };
	if (x) add(s.sess, x);
	s.last = c;
	devsample(s, c);
	// 100 günden eski günlük kovaları ay toplamına (s.months) katıp at: aylık görünüm ve genel toplam kaybolmaz
	let ks = sort(keys(s.days));
	while (length(ks) > 100) {
		let k = shift(ks), mk = substr(k, 0, 7);
		s.months ??= {};
		s.months[mk] ??= {};
		add(s.months[mk], bk(s.days[k]));
		delete s.days[k];
	}
	fs.mkdir(RUN);
	writej(RAMF, s);
	if (ARGV[1] == 'save' || time() - n(s.saved) >= 3600) { s.saved = time(); writej(RAMF, s); writej(FLASHF, s); }
	print('ok\n');
	exit(0);
}
if (CMD == 'save') { let s = load(); s.saved = time(); fs.mkdir(RUN); writej(RAMF, s); writej(FLASHF, s); print('ok\n'); exit(0); }
if (CMD == 'restore') {
	if (!readj(RAMF) && readj(FLASHF)) {
		fs.mkdir(RUN);
		let s = readj(FLASHF);
		delete s.last;
		delete s.sess;   // modem açıldı: yeni oturum
		for (let ip, e in (s.dev ?? {})) delete e.last;   // modem açıldı: sayaçlar sıfırdan başlar
		writej(RAMF, s);
	}
	print('ok\n');
	exit(0);
}
if (CMD == 'import') {
	// Mevcut KediRay sayaçlarından (VPN + Direkt toplamı) geçmişi içe aktarır; KediStat'ın kendi saydığı günlere dokunmaz (büyük olanı tutar).
	let src = getenv('KS_IMPORT') || '/etc/kediray.traffic.json';
	let k = readj(getenv('KS_IMPORT') ? src : (readj('/var/etc/kediray/traffic.json') ? '/var/etc/kediray/traffic.json' : src));
	if (!k || (!k.days && !k.dev)) { print('kaynak yok\n'); exit(0); }
	let s = load(), nd = 0, nv = 0;
	let big = (a, b) => (a > b ? a : b);
	for (let day, v in (k.days ?? {})) {
		let r = n(v.vr) + n(v.dr), t = n(v.vt) + n(v.dt);
		let o = s.days[day] ?? { r: 0, t: 0 };
		if (r > n(o.r) || t > n(o.t)) { s.days[day] = { r: big(r, n(o.r)), t: big(t, n(o.t)) }; nd++; }
	}
	for (let mk, v in (k.months ?? {})) {
		s.months ??= {};
		let r = n(v.vr) + n(v.dr), t = n(v.vt) + n(v.dt), o = s.months[mk] ?? { r: 0, t: 0 };
		if (r > n(o.r) || t > n(o.t)) s.months[mk] = { r: big(r, n(o.r)), t: big(t, n(o.t)) };
	}
	for (let ip, v in (k.dev ?? {})) {
		s.dev[ip] ??= { days: {} };
		let e = s.dev[ip];
		e.days ??= {};
		for (let day, x in (v.days ?? {})) {
			let o = e.days[day] ?? { rx: 0, tx: 0 };
			if (n(x.rx) > n(o.rx) || n(x.tx) > n(o.tx)) { e.days[day] = { rx: big(n(x.rx), n(o.rx)), tx: big(n(x.tx), n(o.tx)) }; nv++; }
		}
		if (v.name && !e.name) e.name = v.name;
		if (v.mac && !e.mac) e.mac = v.mac;
		e.seen ??= v.seen; e.active ??= v.active;
	}
	// 100 günden eski günleri aya katla (örnekleme ile aynı kural)
	let ks = sort(keys(s.days));
	while (length(ks) > 100) { let d0 = shift(ks), mk = substr(d0, 0, 7); s.months ??= {}; s.months[mk] ??= {}; add(s.months[mk], bk(s.days[d0])); delete s.days[d0]; }
	s.imported = time();
	fs.mkdir(RUN); writej(RAMF, s); writej(FLASHF, s);
	print('içe aktarıldı: ' + nd + ' gün, ' + nv + ' cihaz günü\n');
	exit(0);
}
if (CMD == 'backup') {
	// Tüm sayaç verisini tek JSON olarak yazdırır (yedek dosyası)
	let s = load();
	delete s.last; delete s.sess;
	for (let ip, e in s.dev) delete e.last;
	print(sprintf('%J\n', { kedistat_backup: 1, created: time(), data: s }));
	exit(0);
}
if (CMD == 'restorefile') {
	// Yedek dosyasından geri yükler (mevcut verinin yerine geçer)
	let b = readj(ARGV[1] ?? '');
	let d = b?.kedistat_backup == 1 ? b.data : null;
	if (!d || type(d.days) != 'object' || (d.dev != null && type(d.dev) != 'object')) { print('geçersiz yedek dosyası\n'); exit(1); }
	d.dev ??= {};
	delete d.last; delete d.sess;
	for (let ip, e in d.dev) delete e.last;
	d.saved = time();
	fs.mkdir(RUN); writej(RAMF, d); writej(FLASHF, d);
	print('ok\n');
	exit(0);
}
if (CMD == 'reset') { fs.unlink(RAMF); fs.unlink(FLASHF); print('ok\n'); exit(0); }

if (CMD == 'report') {
	let s = load(), c = fixc(cur(), s.last), live = delta(s, c) ?? { r: 0, t: 0 };
	let today = dkey(c.t);
	let sum = (from) => {
		let t = { r: 0, t: 0 };
		for (let k, v in s.days) if (k >= from && k <= today) add(t, bk(v));
		if (from == '0000-00-00')   // genel toplam: 100 günden eski, aylara katılmış kısım da dahil
			for (let mk, mv in (s.months ?? {})) add(t, bk(mv));
		add(t, live);   // son örneklemeden bu yana (henüz kovaya yazılmamış) kısım
		return t;
	};
	let lt = localtime(c.t);
	// haftanın başı Pazartesi
	let wd = lt.wday == 0 ? 6 : lt.wday - 1;
	let week = dkey(c.t - wd * 86400);
	let month = sprintf('%04d-%02d-01', lt.year, lt.mon);
	let yest = dkey(c.t - 86400);
	let t_today = bk(s.days[today]); add(t_today, live);
	let hist = [];
	for (let i = 29; i >= 0; i--) {
		let k = dkey(c.t - i * 86400), v = bk(s.days[k]);
		if (k == today) add(v, live);
		push(hist, { day: k, ...v });
	}
	let first = sort(keys(s.days))[0];
	// aylık görünüm: son 12 ay; nd = o ayda geçen gün sayısı (ortalama için)
	let ym = sprintf('%04d-%02d', lt.year, lt.mon);
	let dim = (y, m) => (m == 2 ? ((y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]);
	let mm = {};
	for (let mk, mv in (s.months ?? {})) mm[mk] = bk(mv);
	for (let k, v in s.days) { let mk = substr(k, 0, 7); mm[mk] ??= { r: 0, t: 0 }; add(mm[mk], bk(v)); }
	mm[ym] ??= { r: 0, t: 0 };
	add(mm[ym], live);
	let months = [];
	for (let mk in sort(keys(mm)))
		push(months, { day: mk + '-01', ...mm[mk], nd: mk == ym ? lt.mday : dim(int(substr(mk, 0, 4)), int(substr(mk, 5, 2))) });
	if (length(months) > 12) months = slice(months, length(months) - 12);

	// cihazlar: bugün / hafta / ay / toplam (rx = indirme, tx = yükleme) + canlı hız için ham sayaç
	let cd = readdev(), devs = [];
	// Bağlı mı? Wi-Fi: "iw station dump" listesi. Kablolu/bilinmeyen: son 5 dk içinde trafiği olduysa ya da komşu tablosunda
	// REACHABLE/DELAY/PROBE ise bağlı sayılır.
	let rd = (cmd) => { let p = fs.popen(cmd + ' 2>/dev/null'); if (!p) return ''; let o = p.read('all') ?? ''; p.close(); return o; };
	let assoc = {}, ac = readj(RUN + '/assoc.json');
	if (ac && c.t >= n(ac.t) && c.t - n(ac.t) < 10) assoc = ac.assoc ?? {};
	else {
		for (let l in split(rd('for i in $(iw dev | awk \'$1=="Interface"{print $2}\'); do iw dev "$i" station dump | awk \'/^Station/{print $2}\'; done'), '\n'))
			if (match(l, /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/)) assoc[lc(l)] = true;
		try { fs.mkdir(RUN); writej(RUN + '/assoc.json', { t: c.t, assoc: assoc }); } catch (e) {}
	}
	let reach = {}, arpmac = {};
	for (let l in split(rd('ip -4 neigh show'), '\n')) {
		let f = split(l, ' ');
		if (length(f) >= 4 && match(f[0], /^[0-9.]+$/)) {
			let st = f[length(f) - 1];
			if (st == 'REACHABLE' || st == 'DELAY' || st == 'PROBE') reach[f[0]] = true;
			for (let i = 0; i + 1 < length(f); i++) if (f[i] == 'lladdr') arpmac[f[0]] = lc(f[i + 1]);
		}
	}
	let leaseip = {};
	for (let lip, lv in leases()) leaseip[lv.mac] = lip;
	let online = (ip, e, lv) => {
		let mac = lc(e.mac || arpmac[ip] || '');
		// aynı cihazın eski IP'si (yeni kira aldıysa) bağlı sayılmaz
		if (length(mac) && leaseip[mac] != null && leaseip[mac] != ip) return false;
		if (length(mac) && assoc[mac]) return true;
		if (lv.rx + lv.tx > 0) return true;
		if (c.t - n(e.active) < 300) return true;
		return reach[ip] == true;
	};
	let others = { n: 0, today: { rx: 0, tx: 0 }, month: { rx: 0, tx: 0 }, total: { rx: 0, tx: 0 } };
	let add2 = (t, v) => { t.rx += v.rx; t.tx += v.tx; };
	for (let ip, e in s.dev) {
		let lv = devlive(e, cd[ip]);
		let dsum = (from) => {
			let t = { rx: 0, tx: 0 };
			for (let k, v in (e.days ?? {})) if (k >= from && k <= today) { t.rx += n(v.rx); t.tx += n(v.tx); }
			t.rx += lv.rx; t.tx += lv.tx;
			return t;
		};
		let tot = dsum('0000-00-00');
		if (tot.rx + tot.tx <= 0) continue;
		// Ağdan ayrılan cihaz listeden kalkar; verisi saklanır, geri bağlanınca geri gelir (toplamlar eksilmez)
		if (!online(ip, e, lv)) {
			others.n += 1;
			add2(others.today, dsum(today)); add2(others.month, dsum(month)); add2(others.total, tot);
			continue;
		}
		push(devs, { ip: ip, name: e.name ?? '', mac: e.mac ?? '', counter: cd[ip] ?? null,
			today: dsum(today), week: dsum(week), month: dsum(month), total: tot });
	}
	devs = sort(devs, (a, b) => ((b.today.rx + b.today.tx) - (a.today.rx + a.today.tx)) || ((b.total.rx + b.total.tx) - (a.total.rx + a.total.tx)));
	if (length(devs) > 40) devs = slice(devs, 0, 40);

	// oturum (modem açılışından beri) + modem açık kalma süresi
	let sess = bk(s.sess);
	add(sess, live);
	let upt = int(split(fs.readfile('/proc/uptime') ?? '0', '.')[0]);

	print(sprintf('%J\n', {
		t: c.t, counters: c, today: t_today, yesterday: bk(s.days[yest]), week: sum(week), month: sum(month),
		total: sum('0000-00-00'), since: first, days: hist, months: months, devices: devs, others: others,
		session: sess, uptime: upt
	}));
	exit(0);
}
warn('kullanım: traffic.uc sample [save] | report | save | restore | reset\n');
exit(1);
