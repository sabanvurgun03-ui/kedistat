'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require dom';

/* KediStat - Trafik izleyici (modem toplamı + LAN'daki cihaz başına indirme/yükleme) */

/* Güvenli öğe oluşturucu: h() dizileri düzleştirir, boşları atar ve her metni düz metin düğümü olarak ekler
 * (cihaz adı gibi dışarıdan gelen metin HTML olarak yorumlanmaz). */
function h(tag, attrs, children) {
	if (attrs != null && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs.nodeType)) { children = attrs; attrs = {}; }
	const out = [];
	(function walk(c) {
		if (Array.isArray(c)) c.forEach(walk);
		else if (c != null && c !== false && c !== '') out.push((typeof c === 'object' && c.nodeType) ? c : String(c));
	})(children);
	return E(tag, attrs || {}, out);
}

const CLI = '/usr/bin/kedistat';
function runJson(args) {
	return fs.exec(CLI, args).then(r => { try { return JSON.parse(r.stdout || 'null'); } catch (e) { return null; } }).catch(() => null);
}
function fmtBytes(b) {
	b = +b || 0;
	const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
	while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
	return (i ? b.toFixed(1) : Math.round(b)) + ' ' + u[i];
}
const M = { a: 'İndirme', b: 'Yükleme', ca: 'krc-dl', cb: 'krc-ul', fa: x => x.r, fb: x => x.t };   // a = alttaki, b = üstteki parça
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
function gunAd(day) { const d = new Date(day + 'T12:00:00'); return (isNaN(d) ? '' : GUN[d.getDay()] + ' ') + day.slice(8) + '.' + day.slice(5, 7); }
const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// grafik kovasının adı: gün ("Cmt 17.10") ya da ay ("Ekim 2026")
function kovaAd(x) { return x.mo ? (AY[+x.day.slice(5, 7) - 1] || '') + ' ' + x.day.slice(0, 4) : gunAd(x.day); }
function kovaKisa(x) { return x.mo ? (AY[+x.day.slice(5, 7) - 1] || '').slice(0, 3) : x.day.slice(8) + '.' + x.day.slice(5, 7); }
const LIVE_N = 60;   // canlı hız çizgisinde tutulan örnek sayısı (2 sn aralıkla ≈ 2 dk)
// büyük sayı + küçük birim olarak ayrı verir: 12.81 · GB
function fmtParts(b) {
	b = Math.max(0, +b || 0);
	const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
	while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
	return [i === 0 ? String(Math.round(b)) : b.toFixed(i >= 2 ? 2 : 1), u[i]];
}
function fmtRate(b) { return rateParts(b).join(' '); }
// Hız birimi: bayt (B/s, KB/s, MB/s; 1024) ya da bit (bps, Kbps, Mbps; 1000). Seçim tarayıcıda saklanır.
function rateUnitMode() { try { return localStorage.getItem('kedistat-rate-unit') === 'bit' ? 'bit' : 'byte'; } catch (e) { return 'byte'; } }
function setRateUnit(m) { try { localStorage.setItem('kedistat-rate-unit', m); } catch (e) {} }
function rateParts(v) {   // [sayı, birim]
	v = Math.max(0, +v || 0);
	if (rateUnitMode() === 'bit') {
		let b = v * 8; const u = ['bps', 'Kbps', 'Mbps', 'Gbps']; let i = 0;
		while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
		return [i === 0 ? String(Math.round(b)) : (b < 10 ? b.toFixed(2) : b < 100 ? b.toFixed(1) : String(Math.round(b))), u[i]];
	}
	const q = fmtParts(v);
	return [q[0], q[1] + '/s'];
}
/* Canlı hız geçmişi ve tepe değerler: sekme değişince kaybolmasın diye tarayıcıda saklanır.
   Tepe değerler aynı modem açılışı boyunca korunur; çizgi geçmişi yalnızca kısa aralıkta (90 sn). */
const LIVE_KEY = 'kedistat-live-v1';
function loadLive(s) {
	const boot = s.uptime > 0 ? Math.round(s.t - s.uptime) : 0, d = { boot: boot, pd: 0, pu: 0, hd: [], hu: [] };
	try {
		const c = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null');
		if (c && Math.abs((+c.boot || 0) - boot) < 120) {
			d.pd = +c.pd || 0; d.pu = +c.pu || 0;
			if (Date.now() - (+c.at || 0) < 90000 && Array.isArray(c.hd) && Array.isArray(c.hu)) {
				d.hd = c.hd.slice(-LIVE_N).map(Number); d.hu = c.hu.slice(-LIVE_N).map(Number);
			}
		}
	} catch (e) {}
	return d;
}
function saveLive(lb) {
	try { localStorage.setItem(LIVE_KEY, JSON.stringify({ boot: lb.boot, pd: Math.round(lb.pd), pu: Math.round(lb.pu), hd: lb.hd.map(Math.round), hu: lb.hu.map(Math.round), at: Date.now() })); } catch (e) {}
}
const MAX_RATE = 1.5e9;   // B/s: bunun üstü sayaç sıfırlanma/okuma hatasıdır, örnek yok sayılır
// canlı hız çizgisi (yalnızca sayılardan üretilen SVG): son N örnek, sağa yaslı
function sparkSvg(vals, n) {
	const W = 120, H = 34, step = W / (n - 1);
	if (vals.length < 2) return '';
	const top = Math.max(1024, ...vals), len = vals.length;
	const pts = vals.map((v, i) => [(W - (len - 1 - i) * step), (H - 2 - (v / top) * (H - 6))]);
	const f = v => v.toFixed(1);
	const line = pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ',' + f(p[1])).join(' ');
	const area = line + ' L' + f(pts[len - 1][0]) + ',' + H + ' L' + f(pts[0][0]) + ',' + H + ' Z';
	return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="krl-svg" aria-hidden="true">' +
		'<path d="' + area + '" class="krl-area"/><path d="' + line + '" class="krl-line"/></svg>';
}
// süre: 3 gün 5 sa 22 dk · 5 sa 22 dk 10 sn · 14 dk 49 sn · 49 sn
function fmtDur(s) {
	s = Math.max(0, Math.floor(+s || 0));
	const g = Math.floor(s / 86400), h2 = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sn = s % 60;
	const p = v => String(v).padStart(2, '0');
	if (g) return g + ' gün ' + h2 + ' sa ' + p(m) + ' dk';
	if (h2) return h2 + ' sa ' + p(m) + ' dk ' + p(sn) + ' sn';
	if (m) return m + ' dk ' + p(sn) + ' sn';
	return sn + ' sn';
}
// üst köşeleri r kadar yuvarlak, tabanı düz çubuk yolu (SVG path)
function roundTop(x, y, w, hgt, r) {
	r = Math.max(0, Math.min(r, hgt, w / 2));
	const f = v => v.toFixed(1);
	return 'M' + f(x) + ',' + f(y + hgt) + ' V' + f(y + r) + ' Q' + f(x) + ',' + f(y) + ' ' + f(x + r) + ',' + f(y) +
		' H' + f(x + w - r) + ' Q' + f(x + w) + ',' + f(y) + ' ' + f(x + w) + ',' + f(y + r) + ' V' + f(y + hgt) + ' Z';
}
function collapsed(key) {
	try { return localStorage.getItem('kedistat-fold-' + key) === '1'; } catch (e) { return false; }
}

const CSS = `

.kr-card{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:14px 16px;background:rgba(128,128,128,.04)}
.kr-card h3{margin:0 0 10px;font-size:1.05em;opacity:.85}
.kr-ch{cursor:pointer;user-select:none;display:flex;align-items:center;gap:7px}
.kr-ch:hover{opacity:1}
.kr-caret{font-size:.85em;opacity:.7;width:12px}
.kr-ct{flex:1}
.kr-sub{opacity:.7;font-size:.9em}
.kr-live{font-variant-numeric:tabular-nums}
.kr-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.kr-seg{display:inline-flex;border:1px solid rgba(128,128,128,.4);border-radius:8px;overflow:hidden}
.kr-seg button{border:0;border-radius:0;margin:0;padding:4px 14px;background:transparent;cursor:pointer;color:inherit;white-space:nowrap;word-break:keep-all}
.kr-seg button.kr-act{background:#2a7de1;color:#fff}
.kr-seg-sm button{padding:4px 10px;font-size:.92em}
@media (max-width:700px){.kr-seg-sm{display:grid;grid-template-columns:1fr 1fr}.kr-seg-sm button{padding:6px 8px;border-top:1px solid rgba(128,128,128,.25)}.kr-seg-sm button:nth-child(-n+2){border-top:0}.kr-seg-sm button:nth-child(odd){border-right:1px solid rgba(128,128,128,.25)}}
/* 7 gün | 30 gün | Aylar: telefonda da tek satırda kalsın */
@media (max-width:700px){.kr-seg-sm.krc-rng{display:inline-flex}.kr-seg-sm.krc-rng button:nth-child(n){padding:6px 14px;border-top:0;border-right:0}.kr-seg-sm.krc-rng button+button{border-left:1px solid rgba(128,128,128,.25)}}
/* flex:0 0 40px -> yazı uzayınca anahtarın rayı ezilmez (top raydan taşmaz) */
.kr-traffic{--krc-vpn:#2a78d6;--krc-dir:#eb6834;--krc-surface:#fcfcfb}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .kr-traffic{--krc-vpn:#3987e5;--krc-dir:#d95926;--krc-surface:#1a1a19}}
:root[data-theme="dark"] .kr-traffic{--krc-vpn:#3987e5;--krc-dir:#d95926;--krc-surface:#1a1a19}
.krc-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline}
.krc-vpn{fill:var(--krc-vpn);background:var(--krc-vpn)}
.krc-dir{fill:var(--krc-dir);background:var(--krc-dir)}
.krc-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:.9em;margin:2px 0 6px}
.krc-wrap{position:relative;width:100%}
.krc-tip{display:none;position:absolute;z-index:5;pointer-events:none;padding:7px 10px;border-radius:10px;border:1px solid rgba(128,128,128,.4);background:var(--krc-surface,#1a1a19);box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:.78em;line-height:1.55;white-space:nowrap;font-variant-numeric:tabular-nums}
.krc-tip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.krc-tip b{font-weight:700}.krc-tt{font-weight:700;opacity:.9}.krc-ttot{margin-top:2px;opacity:.7;font-weight:600}.krc-tsep{height:1px;margin:3px 0;background:rgba(128,128,128,.3)}
.krc-svg{display:block;max-width:100%}
.krc-grid{stroke:rgba(128,128,128,.25);stroke-width:1}
.krc-ax{fill:currentColor;opacity:.65;font-size:11px}
.krc-hit{fill:transparent;cursor:crosshair}
.krc-hit:hover{fill:rgba(128,128,128,.12)}
/* Efektler: seçili düğmeler parlar, kartlar yumuşakça açılıp kapanır */
.kr-cbody{display:grid;grid-template-rows:1fr;opacity:1;transition:grid-template-rows .32s ease,opacity .26s ease}
.kr-cbody.kr-fold{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .32s ease,opacity .2s ease,visibility 0s .32s}
.kr-cin{min-height:0;overflow:hidden;padding:8px 14px;margin:-8px -14px}
.kr-caret{display:inline-block;transition:transform .25s ease}
.kr-seg button{transition:background .22s ease,color .22s ease,box-shadow .22s ease}
.kr-seg button:not(.kr-act):hover{background:rgba(128,128,128,.16)}
.kr-card{transition:border-color .25s ease,box-shadow .25s ease}
.kr-card:hover{box-shadow:0 2px 14px rgba(0,0,0,.14)}
.krl-band{--krl-g:#16a34a;--krl-b:#2f6fe0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0 0 8px}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]):not([data-krt="light"]) .krl-band{--krl-g:#4ade80;--krl-b:#60a5fa}}
:root[data-theme="dark"] .krl-band,:root[data-darkmode="true"] .krl-band,:root[data-krt="dark"] .krl-band{--krl-g:#4ade80;--krl-b:#60a5fa}
.krl-tile{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;text-align:center;min-height:70px;padding:5px 8px 5px;border-radius:10px;border:1px solid rgba(128,128,128,.28);background:linear-gradient(160deg,rgba(128,128,128,.10),rgba(128,128,128,.02))}
.krl-down{--c:var(--krl-g)}.krl-up{--c:var(--krl-b)}
.krl-down,.krl-up{border-color:color-mix(in srgb,var(--c) 55%,transparent)}
.krl-spark{position:absolute;left:0;right:0;top:3px;height:20px;opacity:.95;pointer-events:none}
.krl-svg{width:100%;height:100%;display:block}
.krl-line{fill:none;stroke:var(--c);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.krl-area{fill:var(--c);opacity:.14}
.krl-val{margin-top:27px;font-variant-numeric:tabular-nums;color:var(--c);line-height:1.1;white-space:nowrap}
.krl-per .krl-val{margin-top:4px}
.krl-num{font-size:1.2em;font-weight:700}
.krl-unit{font-size:.88em;font-weight:600;margin-left:3px;opacity:.9}
.krl-lbl{margin-top:3px;padding-top:3px;width:100%;border-top:1px solid rgba(128,128,128,.25);font-size:.62em;font-weight:600;letter-spacing:.09em;text-transform:uppercase;opacity:.75}
.krl-peak{margin-top:0;font-size:.68em;opacity:.65;font-variant-numeric:tabular-nums}
.krl-sub{margin-top:1px;font-size:.7em;opacity:.8;font-variant-numeric:tabular-nums;line-height:1.5}
.krl-cmp{margin-top:3px;font-size:.68em}.krl-cup{color:#e8a33a}.krl-cdn{color:var(--krl-g,#4ade80)}
.krl-sub i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.krl-per .krl-val{color:inherit;font-size:1.02em;font-weight:700}
.krl-bar{display:flex;width:100%;height:4px;margin-top:4px;border-radius:5px;overflow:hidden;background:rgba(128,128,128,.22)}
.krl-bar span{display:block;height:100%;transition:width .4s}
.krl-pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.krl-pgrid>.krl-tile:last-child:nth-child(odd){grid-column:1/-1}
.krl-dgrid{grid-template-columns:repeat(auto-fill,minmax(215px,1fr))}
.krl-dev{--c:var(--krl-g);align-items:stretch;justify-content:flex-start;text-align:left;padding:9px 11px 8px}
.krl-dev .krl-spark{position:static;height:26px;margin:5px 0 2px}
.krl-dname{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krl-dip{font-size:.72em;opacity:.6;font-variant-numeric:tabular-nums}
.krl-drates{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.krl-dr{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
.krl-dr small{font-size:.62em;font-weight:600;opacity:.75;margin-left:2px}
.krl-dr.d{color:var(--krl-g,#4ade80)}.krl-dr.u{color:var(--krl-b)}
.krl-dtoday{margin-top:5px;font-size:.74em;opacity:.85;font-variant-numeric:tabular-nums;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap}
.krl-bar .krl-fill{background:var(--c)}
.kr-traffic{--krl-g:#16a34a;--krl-b:#2f6fe0}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]):not([data-krt="light"]) .kr-traffic{--krl-g:#4ade80;--krl-b:#60a5fa}}
:root[data-theme="dark"] .kr-traffic,:root[data-darkmode="true"] .kr-traffic,:root[data-krt="dark"] .kr-traffic{--krl-g:#4ade80;--krl-b:#60a5fa}
.krc-dl{fill:var(--krl-g);background:var(--krl-g)}
.krc-ul{fill:var(--krl-b);background:var(--krl-b)}
.krc-bar{opacity:.85;transition:opacity .2s}
.krc-today{opacity:1}
.krc-avg{stroke:currentColor;stroke-opacity:.55;stroke-width:1;stroke-dasharray:4 4;pointer-events:none}
.krc-avgt{fill:currentColor;opacity:.7;font-size:10.5px;pointer-events:none}
.krc-axb{font-weight:700;opacity:1}
.krc-hit.krc-sel{fill:rgba(128,128,128,.18)}
.krc-ctl{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}
.krc-info{margin-top:8px;padding:8px 12px;border-radius:12px;border:1px solid rgba(128,128,128,.28);background:linear-gradient(160deg,rgba(128,128,128,.10),rgba(128,128,128,.02));display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center;font-variant-numeric:tabular-nums;font-size:.92em}
@keyframes krGrow{from{transform:scaleY(0)}to{transform:none}}
.krc-anim .krc-bar{transform-box:fill-box;transform-origin:50% 100%;animation:krGrow .55s cubic-bezier(.2,.8,.2,1) both}
@media (prefers-reduced-motion:reduce){.krc-anim .krc-bar{animation:none}}
.krl-usw{display:flex;justify-content:flex-end;align-items:center;gap:2px;margin:0 -7px 3px 0;font-size:.76em;letter-spacing:.03em;user-select:none}
.krl-usw span{cursor:pointer;padding:3px 7px;opacity:.5;border-radius:6px;transition:opacity .2s,color .2s}
.krl-usw span:hover{opacity:.85}
.krl-usw span.krl-on{opacity:1;color:var(--kr-accent,#2a7de1);font-weight:600}
.krl-usw i{opacity:.3;font-style:normal}
.krc-title{margin:14px 0 4px;font-weight:600;opacity:.85}
.krl-ns .krl-val{margin-top:4px}
.krl-info{grid-column:1/-1;min-height:0;flex-direction:row;justify-content:center;align-items:baseline;gap:10px;padding:7px 10px}
.krl-info .krl-lbl{border-top:0;padding-top:0;margin:0;width:auto}
.ks-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}
.ks-edrow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 6px;padding:6px 8px;border:1px dashed rgba(128,128,128,.5);border-radius:8px}
.ks-edsub{gap:12px;border-style:solid;border-color:rgba(128,128,128,.2)}
.ks-zoom{position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(30,34,41,.88);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);font:600 13px system-ui,sans-serif;user-select:none}
.ks-zoom button{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;height:28px;min-width:28px;padding:0 6px;border-radius:999px}
.ks-zoom button:hover{background:rgba(255,255,255,.14)}
.ks-zoom .ks-zv{min-width:52px}
.ks-upd{margin:18px 0 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(128,128,128,.28);background:linear-gradient(160deg,rgba(128,128,128,.10),rgba(128,128,128,.02))}
.ks-upd-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.ks-upd-h b{font-size:1.02em}
.ks-upd-st{margin:6px 0 8px;opacity:.85;font-size:.92em}
.ks-upd-st.ks-new{color:#e0a82e;opacity:1;font-weight:600}
.ks-upd-st.ks-bad{color:#e5534b;opacity:1}
.ks-upd-st.ks-good{color:#3fb950;opacity:1}
.ks-upd-btn{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.ks-upd-auto{display:inline-flex;align-items:center;gap:6px;font-size:.88em;opacity:.85;cursor:pointer}
.ks-gh{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.ks-gt{display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 8px 12px;border-radius:12px;border:1px solid rgba(128,128,128,.28);background:linear-gradient(160deg,rgba(128,128,128,.12),rgba(128,128,128,.02));color:inherit;text-decoration:none;transition:box-shadow .25s ease,transform .12s ease}
.ks-gt:hover{box-shadow:0 0 10px rgba(128,128,128,.45);color:inherit;text-decoration:none}
.ks-gt:active{transform:scale(.98)}
.ks-gt i{font-style:normal;font-size:1.35em;line-height:1}
.ks-gt b{font-size:1.9em;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.ks-gt small{opacity:.7;font-size:.84em}
.ks-sup{margin:18px 0 6px;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,221,0,.35);background:linear-gradient(160deg,rgba(255,221,0,.10),rgba(255,221,0,.02));display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.ks-sup b{display:block;font-size:1.02em;margin-bottom:2px}
.ks-sup span{opacity:.75;font-size:.9em}
.ks-coffee{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;background:#ffdd00;color:#000!important;font-weight:700;text-decoration:none!important;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:transform .15s,box-shadow .15s}
.ks-coffee:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.35)}
.ks-foot{text-align:center;opacity:.6;font-size:.82em;margin:8px 0 2px}
.ks-foot a{color:inherit}
.krl-info .krl-val{font-size:1.02em;font-weight:700}
.krl-sdown .krl-val,.krl-sup .krl-val{margin-top:4px}
`;

return view.extend({
	/* Kart: başlığa tıklayınca içerik katlanır (tercih tarayıcıda saklanır) */
	card(el, key, title, children) {
		const open = !collapsed(key);
		const body = h('div', { 'class': 'kr-cbody' + (open ? '' : ' kr-fold') }, h('div', { 'class': 'kr-cin' }, children));
		const cap = h('span', { 'class': 'kr-caret' }, open ? '▾' : '▸');
		const head = h('h3', { 'class': 'kr-ch', 'title': 'Küçült / aç' }, [cap, h('span', { 'class': 'kr-ct' }, title)]);
		head.addEventListener('click', () => {
			const now = body.classList.toggle('kr-fold');
			cap.textContent = now ? '▸' : '▾';
			try { localStorage.setItem('kedistat-fold-' + key, now ? '1' : '0'); } catch (e) {}
		});
		dom.content(el, [head, body]);
	},
	/* Kart içindeki bölüm: başlığa tıklayınca katlanır */
	fold(key, title, content) {
		const open = !collapsed(key);
		const body = h('div', { 'class': 'kr-cbody' + (open ? '' : ' kr-fold') }, h('div', { 'class': 'kr-cin' }, content));
		const cap = h('span', { 'class': 'kr-caret' }, open ? '▾' : '▸');
		const head = h('div', { 'class': 'krc-title kr-ch', 'title': 'Küçült / aç' }, [cap, h('span', { 'class': 'kr-ct' }, title)]);
		head.addEventListener('click', () => {
			const now = body.classList.toggle('kr-fold');
			cap.textContent = now ? '▸' : '▾';
			try { localStorage.setItem('kedistat-fold-' + key, now ? '1' : '0'); } catch (e) {}
		});
		return h('div', {}, [head, body]);
	},

	lastStats: null,
	liveRate: null,
	/* Düzen: hangi bölüm görünsün, hangi sırada, hangi dönem kartları. Tarayıcıda saklanır. */
	secTitles: { live: 'Şu an', periods: 'Toplam', devs: 'Cihaz bazında trafik', chart: 'Ortalama' },
	rowTitles: { today: 'Bugün', yesterday: 'Dün', week: 'Bu hafta', month: 'Bu ay', total: 'Toplam' },
	loadLayout() {
		const def = { order: ['live', 'periods', 'devs', 'chart'], hide: {}, hideRows: {} };
		try {
			const c = JSON.parse(localStorage.getItem('kedistat-layout') || 'null');
			if (c && Array.isArray(c.order)) {
				const o = c.order.filter(k => def.order.indexOf(k) >= 0);
				def.order.forEach(k => { if (o.indexOf(k) < 0) o.push(k); });
				return { order: o, hide: c.hide || {}, hideRows: c.hideRows || {} };
			}
		} catch (e) {}
		return def;
	},
	saveLayout() { try { localStorage.setItem('kedistat-layout', JSON.stringify(this.layoutCfg)); } catch (e) {} },
	relayout() {
		this.saveLayout(); this.layout();
		if (this.lastStats) this.renderTraffic(this.lastStats);
	},
	layout() {
		const c = this.layoutCfg, ed = this.editing, out = [];
		dom.content(this.elTools, [
			h('button', { 'class': 'btn cbi-button' + (ed ? ' cbi-button-positive' : ''), 'click': () => { this.editing = !this.editing; this.layout(); } }, ed ? '✓ Bitti' : '⚙ Düzenle'),
			ed ? h('button', { 'class': 'btn cbi-button', 'click': () => { this.layoutCfg = { order: ['live', 'periods', 'devs', 'chart'], hide: {}, hideRows: {} }; this.relayout(); } }, 'Varsayılana dön') : '',
			(!c.hide.live || ed) ? this.elRate : ''
		]);
		c.order.forEach((k, i) => {
			if (c.hide[k] && !ed) return;
			const box = [];
			if (ed) {
				const mv = d => { const j = i + d; if (j < 0 || j >= c.order.length) return; const t = c.order[i]; c.order[i] = c.order[j]; c.order[j] = t; this.relayout(); };
				const cb = h('input', { 'type': 'checkbox' });
				cb.checked = !c.hide[k];
				cb.addEventListener('change', () => { c.hide[k] = !cb.checked; this.relayout(); });
				box.push(h('div', { 'class': 'ks-edrow' }, [
					h('b', { 'style': 'flex:1' }, this.secTitles[k]),
					h('button', { 'class': 'btn cbi-button', 'click': () => mv(-1) }, '▲'),
					h('button', { 'class': 'btn cbi-button', 'click': () => mv(1) }, '▼'),
					h('label', { 'style': 'margin-left:8px;white-space:nowrap' }, [cb, ' Göster'])
				]));
				if (k === 'periods') {
					box.push(h('div', { 'class': 'ks-edrow ks-edsub' }, Object.keys(this.rowTitles).map(rk => {
						const rc = h('input', { 'type': 'checkbox' });
						rc.checked = !c.hideRows[rk];
						rc.addEventListener('change', () => { c.hideRows[rk] = !rc.checked; this.relayout(); });
						return h('label', { 'style': 'white-space:nowrap' }, [rc, ' ' + this.rowTitles[rk]]);
					})));
				}
			}
			box.push(h('div', { 'style': (ed && c.hide[k]) ? 'opacity:.35' : '' }, this.secs[k]));
			out.push(h('div', {}, box));
		});
		dom.content(this.elSecs, out);
	},

	/* Yakınlaştırma / uzaklaştırma: % değeri tarayıcıda saklanır; sağ alttaki − % + düğmeleri */
	zoomApply(z) {
		z = Math.min(160, Math.max(60, Math.round((+z || 100) / 10) * 10));
		try { localStorage.setItem('kedistat-zoom', String(z)); } catch (e) {}
		let st = document.getElementById('ks-zoom-css');
		if (!st) { st = document.createElement('style'); st.id = 'ks-zoom-css'; document.head.appendChild(st); }
		st.textContent = z !== 100 ? 'body #maincontent{zoom:' + (z / 100) + '}' : '';
		const v = document.getElementById('ks-zoom-val');
		if (v) v.textContent = z + '%';
		return z;
	},
	/* Tema: Otomatik (LuCI'nin kendi teması) → Koyu → Açık; tercih tarayıcıda saklanır */
	themeApply(mode) {
		mode = (mode === 'dark' || mode === 'light') ? mode : 'auto';
		try { localStorage.setItem('kedistat-theme', mode); } catch (e) {}
		let st = document.getElementById('ks-theme-css');
		if (!st) { st = document.createElement('style'); st.id = 'ks-theme-css'; document.head.appendChild(st); }
		let css = '';
		if (mode !== 'auto') {
			const d = mode === 'dark';
			const bg = d ? '#14181e' : '#f3f5f8', fg = d ? '#e4e8ee' : '#1b2330', card = d ? '#1d232c' : '#ffffff',
				bd = d ? '#333b47' : '#d3dae3', inp = d ? '#252c37' : '#ffffff';
			css = 'html,body,body .main,body .main-right,body #maincontent,body #view,body .cbi-map,body .cbi-section,body .cbi-tabcontainer,body .cbi-section-node{background:' + bg + '!important;color:' + fg + '!important}'
				+ 'body header,body .modal{background:' + card + '!important;color:' + fg + '!important}'
				+ 'body header a,body .menu a,body label,body h1,body h2,body h3,body p,body td,body th{color:' + fg + '!important}'
				+ '.kr-card{background:' + card + '!important;border-color:' + bd + '!important}'
				+ 'body input,body select,body textarea,body .cbi-dropdown{background:' + inp + '!important;color:' + fg + '!important;border-color:' + bd + '!important}'
				+ 'body .table .tr,body .table .th,body .table .td,body .cbi-section-table-row{background:transparent!important}'
				+ 'body .btn,body .cbi-button{background:' + inp + '!important;color:' + fg + '!important;border-color:' + bd + '!important}'
				+ 'body .cbi-button-negative{color:#e05252!important;border-color:#e05252!important}'
				+ 'body .cbi-button-positive{background:#22a355!important;color:#fff!important;border-color:#22a355!important}'
				+ 'body .cbi-button-action{background:#2a7de1!important;color:#fff!important;border-color:#2a7de1!important}';
		}
		st.textContent = css;
		document.documentElement.setAttribute('data-krt', mode);
		const b = document.getElementById('ks-theme-btn');
		if (b) {
			b.textContent = mode === 'dark' ? '🌙' : (mode === 'light' ? '☀️' : '◐');
			b.title = 'Tema: ' + (mode === 'dark' ? 'Koyu' : (mode === 'light' ? 'Açık' : 'Otomatik')) + ' (değiştirmek için tıkla)';
		}
		return mode;
	},
	zoomBar() {
		let z = 100;
		try { z = +localStorage.getItem('kedistat-zoom') || 100; } catch (e) {}
		const old = document.getElementById('ks-zoom');
		if (old) old.remove();
		const bar = h('div', { 'id': 'ks-zoom', 'class': 'ks-zoom' }, [
			h('button', { 'type': 'button', 'title': 'Uzaklaştır', 'click': ev => { ev.preventDefault(); z = this.zoomApply(z - 10); } }, '−'),
			h('button', { 'type': 'button', 'id': 'ks-zoom-val', 'title': 'Sıfırla (%100)', 'class': 'ks-zv', 'click': ev => { ev.preventDefault(); z = this.zoomApply(100); } }, '100%'),
			h('button', { 'type': 'button', 'title': 'Yakınlaştır', 'click': ev => { ev.preventDefault(); z = this.zoomApply(z + 10); } }, '+'),
			h('button', { 'type': 'button', 'id': 'ks-theme-btn', 'click': ev => {
				ev.preventDefault();
				let m = 'auto'; try { m = localStorage.getItem('kedistat-theme') || 'auto'; } catch (e) {}
				this.themeApply(m === 'auto' ? 'dark' : (m === 'dark' ? 'light' : 'auto'));
			} }, '◐')
		]);
		document.body.appendChild(bar);
		z = this.zoomApply(z);
		let tm = 'auto'; try { tm = localStorage.getItem('kedistat-theme') || 'auto'; } catch (e) {}
		this.themeApply(tm);
	},

	trafficBuilt: false,
	chartSig: '',
	days: null,

	load() { return Promise.resolve(null); },

	/* Canlı hız: iki yoklama arasındaki sayaç farkı */
	trafficLive(s) {
		let r = { d: 0, u: 0 };
		const p = this.lastStats, c = s.counters;
		if (p && s.t > p.t) {
			const dt = s.t - p.t, pc = p.counters;
			// sayaç sıfırlandıysa fark = şimdiki değer
			const f = (a, b) => { const v = (a >= b ? a - b : a) / dt; return v > MAX_RATE ? 0 : v; };
			r = { d: f(c.wr, pc.wr), u: f(c.wt, pc.wt) };
		} else if (this.liveRate) r = this.liveRate;
		this.liveRate = r;
		this.lastStats = s;
		return r;
	},

	chartState() {
		if (!this.cs) {
			let c = null;
			try { c = JSON.parse(localStorage.getItem('kedistat-chart') || 'null'); } catch (e) {}
			this.cs = { range: c && c.range === 'a' ? 'a' : (c && +c.range === 7 ? 7 : 30), sel: null, anim: true };
		}
		return this.cs;
	},
	chartSave() {
		try { localStorage.setItem('kedistat-chart', JSON.stringify({ range: this.cs.range })); } catch (e) {}
	},
	/* Bu ayın ortalaması: takvim ayının toplamı ÷ ayın başından son güne geçen gün sayısı */
	monthAvg() {
		const all = this.days || [];
		if (!all.length) return { tot: 0, day: 1, avg: 0 };
		const last = all[all.length - 1], ym = last.day.slice(0, 7), day = Math.max(1, +last.day.slice(8, 10) || 1);
		const tot = all.filter(x => x.day.slice(0, 7) === ym).reduce((p, x) => p + M.fa(x) + M.fb(x), 0);
		return { tot: tot, day: day, avg: tot / day };
	},

	trafficChart(days, sel) {
		const cs = this.chartState();
		const W = Math.max(280, Math.min(1100, this.elChart.clientWidth || 700)), H = 190;
		const R = 8, T = 12, B = 24, ph = H - T - B;
		const n = days.length;
		const tot = days.map(x => M.fa(x) + M.fb(x));
		const max = Math.max(1, ...tot);
		// "güzel" üst sınır: 4 eşit aralık, adım güzel bir sayı (etiketler 1024 tabanlı birimde)
		const bu = Math.max(0, Math.min(4, Math.floor(Math.log(max) / Math.log(1024)))), unit = Math.pow(1024, bu), mu = max / unit;
		const mag = Math.pow(10, Math.floor(Math.log10(mu / 4)));
		const step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 15, 20].map(m => m * mag).find(v => v * 4 >= mu * 1.02) || 20 * mag) * unit;
		const top = step * 4;
		// sol boşluk en uzun eksen etiketine göre: "160.0 GB" gibi üç haneli değerler kesilmesin
		let lw = 0; for (let i = 1; i <= 4; i++) lw = Math.max(lw, fmtBytes(top * i / 4).length);
		const L = Math.max(46, Math.ceil(lw * 6.6) + 12), pw = W - L - R, slot = pw / n, bw = Math.min(24, Math.max(4, slot - 4));
		const y = v => T + ph - (v / top) * ph;
		// çizgi: günlük görünümde bu ayın günlük ortalaması; aylık görünümde verisi olan ayların ortalaması
		const act = tot.filter(v => v > 0), avg = cs.range === 'a' ? (act.length ? act.reduce((p, v) => p + v, 0) / act.length : 0) : this.monthAvg().avg;
		let g = '';
		for (let i = 0; i <= 4; i++) {
			const v = top * i / 4, yy = y(v).toFixed(1);
			g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="krc-grid"/>' +
				'<text x="' + (L - 6) + '" y="' + (+yy + 4) + '" text-anchor="end" class="krc-ax">' + (v ? fmtBytes(v) : '0') + '</text>';
		}
		let bars = '';
		days.forEach((x, i) => {
			const cx = L + slot * i + slot / 2, x0 = (cx - bw / 2).toFixed(1);
			const va = M.fa(x), vb = M.fb(x);
			const hv = va > 0 ? Math.max(1, (va / top) * ph) : 0, hd = vb > 0 ? Math.max(1, (vb / top) * ph) : 0;
			const base = T + ph, today = i === n - 1 ? ' krc-today' : '';
			const st = ' style="animation-delay:' + Math.round(i * 600 / n) + 'ms"';
			// alt: indirme, üst: yükleme; en üstteki parçanın ucu 4px yuvarlak, taban düz; ikisi arasında 2px boşluk
			const gap = hv > 0 && hd > 2 ? 2 : 0;
			if (hv > 0) bars += hd > 0 ? '<rect x="' + x0 + '" y="' + (base - hv).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hv.toFixed(1) + '" class="krc-bar ' + M.ca + today + '"' + st + '/>'
				: '<path d="' + roundTop(+x0, base - hv, bw, hv, 4) + '" class="krc-bar ' + M.ca + today + '"' + st + '/>';
			if (hd > 0) bars += '<path d="' + roundTop(+x0, base - hv - hd, bw, hd - gap, 4) + '" class="krc-bar ' + M.cb + today + '"' + st + '/>';
			// gezinme/dokunma hedefi: sütunun tamamı (seçili gün vurgulu)
			bars += '<rect x="' + (L + slot * i).toFixed(1) + '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + ph + '" class="krc-hit' + (i === sel ? ' krc-sel' : '') + '" data-i="' + i + '"/>';
			if (i % Math.ceil(n / (W < 500 ? 5 : 10)) === 0 || i === n - 1)
				bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="krc-ax' + (i === n - 1 ? ' krc-axb' : '') + '">' + kovaKisa(x) + '</text>';
		});
		const ya = y(avg).toFixed(1);
		bars += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ya + '" y2="' + ya + '" class="krc-avg"/>' +
			'<text x="' + (W - R - 2) + '" y="' + (+ya - 4) + '" text-anchor="end" class="krc-avgt">' + (cs.range === 'a' ? 'ort. ' : 'ay ort. ') + fmtBytes(avg) + '</text>';
		return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" class="krc-svg' + (cs.anim ? ' krc-anim' : '') + '" role="img" aria-label="' + (cs.range === 'a' ? 'Aylık' : 'Günlük') + ' trafik (indirme ve yükleme)">' + g + bars + '</svg>';
	},

	chartDays() {
		const cs = this.chartState();
		if (cs.range === 'a') return (this.months || []).map(x => Object.assign({ mo: true }, x));
		return (this.days || []).slice(-cs.range);
	},
	chartSel(n) {
		const cs = this.chartState();
		return (cs.sel == null || cs.sel >= n) ? n - 1 : cs.sel;
	},

	/* Grafiğin üstündeki özet kutuları (seçili süre için) */
	renderChartSummary() {
		const cs = this.chartState(), days = this.chartDays(), n = days.length;
		if (!n) return;
		const A = days.reduce((p, x) => p + M.fa(x), 0), Bv = days.reduce((p, x) => p + M.fb(x), 0), all = A + Bv;
		// ortalama: sayaç verisi olmayan baştaki (0) günler sayılmaz
		const i0 = Math.max(0, days.findIndex(x => M.fa(x) + M.fb(x) > 0)), na = Math.max(1, n - i0), avg = all / na;
		let mx = days[0], mxv = -1;
		days.forEach(x => { const v = M.fa(x) + M.fb(x); if (v > mxv) { mxv = v; mx = x; } });
		const last = days[n - 1], lv = M.fa(last) + M.fb(last);
		const pv = all > 0 ? Math.round(A / all * 100) : 0;
		const big = v => { const q = fmtParts(v); return h('div', { 'class': 'krl-val' }, [h('span', { 'class': 'krl-num' }, q[0]), h('span', { 'class': 'krl-unit' }, q[1])]); };
		const dot = (cls, txt) => h('div', { 'class': 'krl-sub', 'style': 'margin-top:0' }, [h('i', { 'class': cls }), txt]);
		const aA = A / na, aB = Bv / na;
		const mo = this.monthAvg();
		const isM = cs.range === 'a', ndSum = days.slice(i0).reduce((p, x) => p + Math.max(1, x.nd || 1), 0);
		dom.content(this.elChartTiles, h('div', { 'class': 'krl-band' }, [
			h('div', { 'class': 'krl-tile krl-per' }, [big(avg), dot(M.ca, M.a + ' ' + fmtBytes(aA)), dot(M.cb, M.b + ' ' + fmtBytes(aB)),
				h('div', { 'class': 'krl-bar' }, [h('span', { 'class': M.ca, 'style': 'width:' + (all > 0 ? pv : 0) + '%' }), h('span', { 'class': M.cb, 'style': 'width:' + (all > 0 ? 100 - pv : 0) + '%' })]),
				h('div', { 'class': 'krl-lbl' }, (isM ? 'Aylık ortalama (' + na + ' ay)' : 'Günlük ortalama (' + na + ' gün)'))]),
			(isM ? h('div', { 'class': 'krl-tile krl-per' }, [big(all / Math.max(1, ndSum)), h('div', { 'class': 'krl-sub', 'style': 'margin-top:3px' }, 'verisi olan aylar'), h('div', { 'class': 'krl-lbl' }, 'Günlük ortalama')])
				: h('div', { 'class': 'krl-tile krl-per' }, [big(avg / 24), h('div', { 'class': 'krl-sub', 'style': 'margin-top:3px' }, 'bugün günlük ortalamanın %' + (avg > 0 ? Math.round(lv / avg * 100) : 0) + '\'i'), h('div', { 'class': 'krl-lbl' }, 'Saatlik ortalama')])),
			h('div', { 'class': 'krl-tile krl-per' }, [big(mo.avg), h('div', { 'class': 'krl-sub', 'style': 'margin-top:3px' }, 'bu ay ' + fmtBytes(mo.tot) + ' ÷ ' + mo.day + ' gün'), h('div', { 'class': 'krl-lbl' }, 'Bu ay ortalama')]),
			h('div', { 'class': 'krl-tile krl-per' }, [big(Math.max(0, mxv)), h('div', { 'class': 'krl-sub', 'style': 'margin-top:3px' }, kovaAd(mx)), h('div', { 'class': 'krl-lbl' }, isM ? 'En yoğun ay' : 'En yoğun gün')])
		]));
	},

	/* Çubuk grafik + seçili günün bilgi satırı + düğmelerin durumu */
	renderChartBody() {
		const cs = this.chartState(), days = this.chartDays(), n = days.length;
		if (!n) return;
		const sel = this.chartSel(n), x = days[sel];
		this.elSvg.innerHTML = this.trafficChart(days, sel);   // yalnızca sayılardan üretilen SVG
		cs.anim = false;
		dom.content(this.elLegend, [h('span', {}, [h('i', { 'class': 'krc-sw ' + M.ca }), M.a]), h('span', {}, [h('i', { 'class': 'krc-sw ' + M.cb }), M.b])]);
		dom.content(this.elChartInfo, [
			h('b', {}, kovaAd(x)),
			h('span', { 'class': 'kr-sub' }, [h('i', { 'class': 'krc-sw ' + M.ca }), M.a + ' ' + fmtBytes(M.fa(x))]),
			h('span', { 'class': 'kr-sub' }, [h('i', { 'class': 'krc-sw ' + M.cb }), M.b + ' ' + fmtBytes(M.fb(x))]),
			h('span', { 'class': 'kr-sub' }, 'Toplam ' + fmtBytes(M.fa(x) + M.fb(x))),
			x.mo ? h('span', { 'class': 'kr-sub' }, 'günlük ort. ' + fmtBytes((M.fa(x) + M.fb(x)) / Math.max(1, x.nd || 1))) : ''
		]);
		Object.keys(this.segB).forEach(k => this.segB[k].classList.toggle('kr-act', k === String(cs.range)));
	},
	chartPick(ev) {
		const t = ev.target && ev.target.closest ? ev.target.closest('[data-i]') : null;
		if (!t || !this.days) return;
		const cs = this.chartState(), n = this.chartDays().length, i = +t.getAttribute('data-i');
		this.chartTip(i, t);
		if (i === this.chartSel(n)) return;
		cs.sel = i;
		this.renderChartBody();
	},
	/* Grafiğin üstüne gelince (ya da dokununca): o günün indirme, yükleme ve toplamı */
	chartTip(i, t) {
		const x = this.chartDays()[i];
		if (!x || !this.elTip) return;
		const row = (c, l, v) => h('div', {}, [h('i', { 'class': c }), l + ' ', h('b', {}, fmtBytes(v))]);
		dom.content(this.elTip, [
			h('div', { 'class': 'krc-tt' }, kovaAd(x)),
			row('krc-dl', 'İndirme', x.r), row('krc-ul', 'Yükleme', x.t),
			h('div', { 'class': 'krc-tt krc-ttot' }, 'Toplam ' + fmtBytes(x.r + x.t))
		]);
		const wr = this.elChart.getBoundingClientRect(), tr = t.getBoundingClientRect(), tip = this.elTip;
		tip.style.display = 'block';
		const w = tip.offsetWidth, cx = tr.left - wr.left + tr.width / 2;
		let left = cx + 10;
		if (left + w > wr.width) left = cx - w - 10;   // sağ kenara yakınsa barın soluna aç
		tip.style.left = Math.max(0, left) + 'px';
		tip.style.top = '4px';
	},

	/* Canlı şerit: anlık hız (çizgili) + oturum toplamı + modemin açık kalma süresi */
	buildLiveBand() {
		const lb = this.lb;
		const big = k => {
			lb[k + 'N'] = h('span', { 'class': 'krl-num' }, '0');
			lb[k + 'U'] = h('span', { 'class': 'krl-unit' }, rateParts(0)[1]);
			return h('div', { 'class': 'krl-val' }, [lb[k + 'N'], lb[k + 'U']]);
		};
		const speed = (k, cls, label) => {
			lb[k + 'S'] = h('div', { 'class': 'krl-spark' });
			lb[k + 'P'] = h('div', { 'class': 'krl-peak' }, 'Tepe: —');
			return h('div', { 'class': 'krl-tile ' + cls }, [lb[k + 'S'], big(k), lb[k + 'P'], h('div', { 'class': 'krl-lbl' }, label)]);
		};
		const sess = (k, cls, label) => {
			lb[k + 'N'] = h('span', { 'class': 'krl-num' }, '—'); lb[k + 'U'] = h('span', { 'class': 'krl-unit' }, '');
			return h('div', { 'class': 'krl-tile krl-ns ' + cls }, [h('div', { 'class': 'krl-val' }, [lb[k + 'N'], lb[k + 'U']]), h('div', { 'class': 'krl-lbl' }, label)]);
		};
		lb.up = h('span', {}, '—');
		return h('div', { 'class': 'krl-band kr-traffic' }, [
			speed('d', 'krl-down', 'İndirme'),
			speed('u', 'krl-up', 'Yükleme'),
			sess('sd', 'krl-down', 'Oturum indirilen'),
			sess('su', 'krl-up', 'Oturum yüklenen'),
			h('div', { 'class': 'krl-tile krl-info krl-ns' }, [h('div', { 'class': 'krl-val', 'style': 'color:inherit' }, lb.up), h('div', { 'class': 'krl-lbl' }, 'Modem açık')])
		]);
	},
	/* Yedekleme: tüm sayaç verisini dosyaya indir / dosyadan geri yükle */
	buildBackup() {
		const msg = h('div', { 'class': 'ks-upd-st' }, 'Sayaç verilerini (günlük, aylık, cihaz başına) tek dosyaya yedekleyebilirsin.');
		const say = (t, c) => { msg.className = 'ks-upd-st ' + (c || ''); msg.textContent = t; };
		const btnB = h('button', { 'class': 'cbi-button' }, '⬇ Yedek indir');
		const btnR = h('button', { 'class': 'cbi-button' }, '⬆ Yedekten geri yükle');
		const file = h('input', { 'type': 'file', 'accept': '.json,application/json', 'style': 'display:none' });
		btnB.addEventListener('click', () => {
			say('Yedek hazırlanıyor…', '');
			fs.exec(CLI, ['save']).then(() => fs.exec(CLI, ['backup'])).then(r => {
				const t = r.stdout || '';
				if (t.indexOf('kedistat_backup') < 0) return say('Yedek alınamadı', 'ks-bad');
				const d = new Date(), p2 = x => (x < 10 ? '0' : '') + x;
				const name = 'kedistat-yedek-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
				const a = document.createElement('a');
				a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = name;
				document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
				say('Yedek indirildi: ' + name, 'ks-good');
			}).catch(() => say('Yedek alınamadı', 'ks-bad'));
		});
		btnR.addEventListener('click', () => { file.value = ''; file.click(); });
		file.addEventListener('change', () => {
			const f = file.files && file.files[0];
			if (!f) return;
			if (f.size > 2097152) return say('Dosya çok büyük (en fazla 2 MB); bu bir KediStat yedeği olamaz', 'ks-bad');
			if (!confirm('Mevcut sayaç verisi "' + f.name + '" dosyasındaki yedekle DEĞİŞTİRİLECEK. Devam edilsin mi?')) return;
			const rd = new FileReader();
			rd.onload = () => {
				say('Geri yükleniyor…', '');
				fs.write('/tmp/kedistat-restore.json', String(rd.result))
					.then(() => fs.exec(CLI, ['restore-file']))
					.then(r => {
						if ((r.stdout || '').trim() !== 'ok') return say('Geçersiz yedek dosyası', 'ks-bad');
						say('Geri yüklendi, sayfa yenileniyor…', 'ks-good'); setTimeout(() => location.reload(true), 1000);
					}).catch(() => say('Geri yükleme başarısız', 'ks-bad'));
			};
			rd.readAsText(f);
		});
		return h('div', { 'class': 'ks-upd' }, [
			h('div', { 'class': 'ks-upd-h' }, [h('b', {}, '💾 Yedekleme')]),
			msg,
			h('div', { 'class': 'ks-upd-btn' }, [btnB, btnR, file])
		]);
	},

	/* GitHub'dan güncelleme: denetle / şimdi güncelle / otomatik kur */
	buildUpdate() {
		const st = h('div', { 'class': 'ks-upd-st' }, 'Denetleniyor…');
		const vr = h('span', { 'style': 'opacity:.7;font-size:.88em' }, '');
		const say = (t, c) => { st.className = 'ks-upd-st ' + (c || ''); st.textContent = t; };
		const btnI = h('button', { 'class': 'cbi-button cbi-button-action', 'style': 'display:none' }, 'Şimdi güncelle');
		const btnC = h('button', { 'class': 'cbi-button' }, 'Güncellemeyi denetle');
		const auto = h('input', { 'type': 'checkbox' });
		const show = j => {
			if (!j) return say('Henüz denetlenmedi', '');
			if (j.cur) vr.textContent = 'Kurulu: v' + j.cur;
			if (!j.ok) { btnI.style.display = 'none'; return say("GitHub'a ulaşılamadı", 'ks-bad'); }
			if (j.newer) { btnI.style.display = ''; return say('Yeni sürüm var: v' + j.cur + ' → v' + j.latest, 'ks-new'); }
			if (j.rev_new) { btnI.style.display = ''; return say('Aynı sürümde (v' + j.cur + ') depoda yeni değişiklikler var', 'ks-new'); }
			btnI.style.display = 'none'; say('Güncelsin (v' + j.cur + ')', 'ks-good');
			st.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px;margin-right:6px"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>');
		};
		const chk = () => { btnC.disabled = true; say('Denetleniyor…', ''); return fs.exec(CLI, ['update', 'check', '--json']).then(r => { let j = null; try { j = JSON.parse(r.stdout || 'null'); } catch (e) {} show(j || { ok: false }); }).catch(() => show({ ok: false })).then(() => { btnC.disabled = false; }); };
		const inst = () => {
			btnI.disabled = btnC.disabled = true; say('Güncelleme indiriliyor ve kuruluyor…', '');
			fs.exec(CLI, ['update', 'bg']).then(() => {
				let n = 0;
				const tm = setInterval(() => {
					fs.exec(CLI, ['update', 'status']).then(r => {
						const o = r.stdout || '', m = o.match(/__BITTI__ (\d+)/);
						if (!m) { if (++n > 90) { clearInterval(tm); say('Zaman aşımı; sayfayı yenileyip tekrar dene', 'ks-bad'); btnC.disabled = btnI.disabled = false; } return; }
						clearInterval(tm);
						if (m[1] === '0') { say('Güncellendi, sayfa yenileniyor…', 'ks-good'); setTimeout(() => location.reload(true), 1200); }
						else { say('Güncelleme başarısız: ' + (o.trim().split('\n').slice(-2, -1)[0] || 'bilinmeyen hata'), 'ks-bad'); btnC.disabled = btnI.disabled = false; }
					}).catch(() => {});
				}, 2000);
			}).catch(() => { say('Güncelleme başlatılamadı', 'ks-bad'); btnC.disabled = btnI.disabled = false; });
		};
		btnC.addEventListener('click', chk); btnI.addEventListener('click', inst);
		auto.addEventListener('change', () => { fs.exec(CLI, ['update', 'auto-set', auto.checked ? '1' : '0']).catch(() => {}); });
		fs.exec(CLI, ['update', 'auto-get']).then(r => { auto.checked = (r.stdout || '').trim() === '1'; }).catch(() => {});
		fs.exec(CLI, ['update', 'cached']).then(r => { let j = null; try { j = JSON.parse(r.stdout || 'null'); } catch (e) {} if (j) show(j); else { fs.exec(CLI, ['version']).then(v => { vr.textContent = 'Kurulu: ' + ((v.stdout || '').trim().replace(/^KediStat /, 'v')); }).catch(() => {}); say('Henüz denetlenmedi', ''); } }).catch(() => {});
		return h('div', { 'class': 'ks-upd' }, [
			h('div', { 'class': 'ks-upd-h' }, [h('b', {}, '⟳ Güncelleme'), vr]),
			st,
			h('div', { 'class': 'ks-upd-btn' }, [btnC, btnI, h('label', { 'class': 'ks-upd-auto' }, [auto, 'Yeni sürümü otomatik kur (günde bir denetlenir)'])])
		]);
	},

	/* GitHub yıldız ve indirme sayısı: modem GitHub API'sinden okur (6 saat önbellekli); ulaşılamazsa "—" gösterir */
	buildRepoStats() {
		const REPO = 'https://github.com/sabanvurgun03-ui/kedistat';
		const tile = (ico, color, label, href) => {
			const num = h('b', {}, '…');
			const a = h('a', { 'class': 'ks-gt', 'href': href, 'target': '_blank', 'rel': 'noopener noreferrer' }, [h('i', { 'style': 'color:' + color }, ico), num, h('small', {}, label)]);
			return { a, num };
		};
		const st = tile('★', '#e3b341', 'yıldız', REPO + '/stargazers');
		const dl = tile('⬇', '#3b82f6', 'indirme', REPO + '/releases');
		const none = why => { st.num.textContent = dl.num.textContent = '—'; st.a.title = dl.a.title = why; };
		fs.exec(CLI, ['repostats', '--json']).then(r => {
			let j = null; try { j = JSON.parse((r.stdout || '').trim()); } catch (e) {}
			if (!j || !j.ok) return none("GitHub'a ulaşılamadı");
			const d = new Date(j.ts * 1000), p = n => String(n).padStart(2, '0');
			const when = p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
			const tip = 'Son güncelleme: ' + when + (j.stale ? " (GitHub'a ulaşılamadı, son kayıtlı değer)" : '');
			st.num.textContent = j.stars;
			st.a.title = tip;
			dl.num.textContent = j.releases ? j.downloads : '—';
			dl.a.title = (j.releases ? "GitHub Releases'teki kurulum dosyasının (kedistat-install.sh) indirme sayısı. " : 'Depoda henüz GitHub Release yok; indirme sayısı Release dosyalarından okunur. ') + tip;
		}).catch(() => none('Panel yanıt vermedi'));
		return h('div', { 'class': 'ks-upd' }, [
			h('div', { 'class': 'ks-upd-h' }, [h('b', {}, '📊 İstatistikler'), h('span', { 'style': 'opacity:.6;font-size:.85em' }, 'GitHub')]),
			h('div', { 'class': 'ks-gh' }, [st.a, dl.a])
		]);
	},

	/* Hız birimi seçici: MB/s (bayt) ya da Mbps (bit). Seçim tarayıcıda saklanır. */
	buildRateSeg() {
		const btns = {};
		const paint = () => Object.keys(btns).forEach(k => btns[k].classList.toggle('krl-on', k === rateUnitMode()));
		const mk = (k, label) => { btns[k] = h('span', { 'role': 'button', 'click': () => { setRateUnit(k); paint(); if (this.lastStats && this.liveRate) { this.renderLiveBand(this.lastStats, this.liveRate, true); this.renderDevTraffic(this.lastStats.devices || [], this.lastStats.t, this.lastStats.others, true); } } }, label); return btns[k]; };
		const el = h('div', { 'class': 'krl-usw' }, [mk('byte', 'MB/s'), h('i', {}, '·'), mk('bit', 'Mbps')]);
		paint();
		return el;
	},
	renderLiveBand(s, r, again) {
		const lb = this.lb, N = LIVE_N;
		if (!lb.loaded) {   // sekme değişince sıfırlanmasın: tepe değerler ve çizgi geçmişi tarayıcıdan geri yüklenir
			const sv = loadLive(s);
			lb.loaded = true; lb.boot = sv.boot; lb.pd = sv.pd; lb.pu = sv.pu; lb.hd = sv.hd; lb.hu = sv.hu; lb.cd = 0; lb.cu = 0;
		}
		if (!again) {
			lb.hd.push(r.d); lb.hu.push(r.u);
			if (lb.hd.length > N) lb.hd.shift();
			if (lb.hu.length > N) lb.hu.shift();
			lb.pd = Math.max(lb.pd, r.d); lb.pu = Math.max(lb.pu, r.u);
			lb.cd = r.d; lb.cu = r.u;
			saveLive(lb);
		}
		const rate = (k, v) => { const p = rateParts(v); lb[k + 'N'].textContent = p[0]; lb[k + 'U'].textContent = p[1]; };
		rate('d', lb.cd); rate('u', lb.cu);
		lb.dS.innerHTML = sparkSvg(lb.hd, N);   // yalnızca sayılardan üretilen SVG
		lb.uS.innerHTML = sparkSvg(lb.hu, N);
		lb.dP.textContent = 'Tepe: ' + (lb.pd > 0 ? fmtRate(lb.pd) : '—');
		lb.uP.textContent = 'Tepe: ' + (lb.pu > 0 ? fmtRate(lb.pu) : '—');
		const ses = s.session || { r: 0, t: 0 };
		const tp = (k, v) => { const p = fmtParts(v); lb[k + 'N'].textContent = p[0]; lb[k + 'U'].textContent = p[1]; };
		tp('sd', ses.r); tp('su', ses.t);
		lb.up.textContent = s.uptime > 0 ? fmtDur(s.uptime) : '—';
	},

	/* Dönem kutuları (Bugün/Dün/Bu hafta/Bu ay/Toplam) + dönem karşılaştırması */
	renderPeriods(s) {
		const hr = (this.layoutCfg && this.layoutCfg.hideRows) || {};
		const rows = [['today', 'Bugün', s.today], ['yesterday', 'Dün', s.yesterday], ['week', 'Bu hafta', s.week], ['month', 'Bu ay', s.month], ['total', 'Toplam', s.total]].filter(r => !hr[r[0]]);
		// Karşılaştırma (son 30 günlük kovalardan): bugün→dün, dün→önceki gün, bu hafta→geçen hafta aynı süre
		const dd = s.days || [], tot = x => x.r + x.t, nd = dd.length;
		const sumD = (i, j) => { let t = 0; for (let k = Math.max(0, i); k <= j && k < nd; k++) t += tot(dd[k]); return t; };
		const wdx = nd ? (new Date(dd[nd - 1].day + 'T12:00:00').getDay() + 6) % 7 : 0;
		const notes = {};
		if (nd >= 3) {
			const t0 = tot(dd[nd - 1]), t1 = tot(dd[nd - 2]), t2 = tot(dd[nd - 3]);
			if (t1 > 0) notes.today = { t: 'Dünün %' + Math.round(t0 / t1 * 100) + '\'i', d: 0 };
			if (t2 > 0) notes.yesterday = { t: Math.round((t1 / t2 - 1) * 100), s: 'önceki güne göre' };
			if (nd >= wdx + 8) {
				const cw = sumD(nd - 1 - wdx, nd - 1), pw = sumD(nd - 8 - wdx, nd - 8);
				if (pw > 0) notes.week = { t: Math.round((cw / pw - 1) * 100), s: 'geçen haftaya göre' };
			}
		}
		const per = (l, b, key) => {
			const dl = M.fa(b), ul = M.fb(b), all = dl + ul, pv = all > 0 ? Math.round(dl / all * 100) : 0;
			const pt = fmtParts(all);
			return h('div', { 'class': 'krl-tile krl-per' }, [
				h('div', { 'class': 'krl-val' }, [h('span', { 'class': 'krl-num' }, pt[0]), h('span', { 'class': 'krl-unit' }, pt[1])]),
				h('div', { 'class': 'krl-sub', 'style': 'margin-top:3px' }, [h('i', { 'class': M.ca }), M.a + ' ' + fmtBytes(dl)]),
				h('div', { 'class': 'krl-sub', 'style': 'margin-top:0' }, [h('i', { 'class': M.cb }), M.b + ' ' + fmtBytes(ul)]),
				h('div', { 'class': 'krl-bar' }, [h('span', { 'class': M.ca, 'style': 'width:' + (all > 0 ? pv : 0) + '%' }), h('span', { 'class': M.cb, 'style': 'width:' + (all > 0 ? 100 - pv : 0) + '%' })]),
				(() => {
					const nt = notes[key];
					if (!nt) return '';
					if (nt.d === 0) return h('div', { 'class': 'krl-sub krl-cmp' }, nt.t);
					const up = nt.t > 0, same = nt.t === 0;
					return h('div', { 'class': 'krl-sub krl-cmp ' + (same ? '' : up ? 'krl-cup' : 'krl-cdn') }, (same ? '＝ ' : up ? '▲ %' : '▼ %') + Math.abs(nt.t) + ' · ' + nt.s);
				})(),
				h('div', { 'class': 'krl-lbl' }, l)
			]);
		};
		dom.content(this.elPeriods, h('div', { 'class': 'krl-pgrid kr-traffic' }, rows.map(([k, l, b]) => per(l, b, k))));
	},

	/* Cihaz bazında trafik: indirme = cihaza gelen, yükleme = cihazdan giden (nft sayaçları, LAN IP'si başına).
	   Canlı hız, iki yoklama arasındaki sayaç farkından hesaplanır. */
	renderDevTraffic(devs, t, others, again) {
		const prev = this.devPrev || {}, next = {}, oldHist = this.devHist || {}, hist = {};
		if (!devs.length) {
			dom.content(this.elDevTr, h('div', { 'class': 'kr-sub' }, 'Henüz cihaz verisi yok; sayaçlar başladıktan 1-2 dakika sonra dolar.'));
			this.devPrev = next; this.devHist = hist;
			return;
		}
		let srx = others && others.n ? others.today.rx : 0, stx = others && others.n ? others.today.tx : 0;
		const hide = (() => { try { return localStorage.getItem('kedistat-hide-ids') === '1'; } catch (e) { return false; } })();
		const maskIp = ip => (hide && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ? '•••.•••.•••.' + ip.split('.')[3] : ip;
		const list = devs.map(dv => {
			let dd = 0, du = 0;
			const c = dv.counter, p = prev[dv.ip];
			if (again) { const q = (this.devRate || {})[dv.ip]; if (q) { dd = q.dd; du = q.du; } }
			else if (c) {
				if (p && t > p.t) {
					const dt = t - p.t, f = (a, b) => { const v = (a >= b ? a - b : a) / dt; return v > MAX_RATE ? 0 : v; };
					dd = f(c.rx, p.rx); du = f(c.tx, p.tx);
				}
				next[dv.ip] = { t: t, rx: c.rx, tx: c.tx };
			}
			const hs = (oldHist[dv.ip] || []).concat(again ? [] : [dd + du]);
			if (hs.length > LIVE_N) hs.shift();
			hist[dv.ip] = hs;
			srx += dv.today.rx; stx += dv.today.tx;
			return { dv, dd, du, hs };
		});
		if (again) { this.devPrev = prev; this.devHist = oldHist; }
		else {
			this.devPrev = next; this.devHist = hist;
			this.devRate = {}; list.forEach(x => { this.devRate[x.dv.ip] = { dd: x.dd, du: x.du }; });
		}
		const todayAll = Math.max(1, srx + stx);
		list.sort((x, y) => (y.dv.today.rx + y.dv.today.tx) - (x.dv.today.rx + x.dv.today.tx));
		const cards = list.map(({ dv, dd, du, hs }) => {
			const dtot = dv.today.rx + dv.today.tx, pct = Math.min(100, Math.round(dtot / todayAll * 100));
			const a = rateParts(dd), b = rateParts(du);
			const sp = h('div', { 'class': 'krl-spark' });
			sp.innerHTML = sparkSvg(hs, LIVE_N);   // yalnızca sayılardan üretilen SVG
			return h('div', { 'class': 'krl-tile krl-dev', 'title': 'Bu ay: ' + fmtBytes(dv.month.rx + dv.month.tx) + ' · Toplam (kurulumdan beri): ' + fmtBytes(dv.total.rx + dv.total.tx) }, [
				h('div', { 'class': 'krl-dname' }, dv.name || maskIp(dv.ip)),
				dv.name ? h('div', { 'class': 'krl-dip' }, maskIp(dv.ip)) : '',
				sp,
				h('div', { 'class': 'krl-drates' }, [
					h('div', { 'class': 'krl-dr d' }, ['↓ ' + a[0], h('small', {}, a[1])]),
					h('div', { 'class': 'krl-dr u' }, ['↑ ' + b[0], h('small', {}, b[1])])
				]),
				h('div', { 'class': 'krl-bar' }, h('span', { 'class': 'krl-fill', 'style': 'width:' + pct + '%' })),
				h('div', { 'class': 'krl-dtoday' }, [h('span', {}, 'Bugün ↓ ' + fmtBytes(dv.today.rx) + ' ↑ ' + fmtBytes(dv.today.tx)), h('span', {}, '%' + pct)])
			]);
		});
		dom.content(this.elDevTr, [
			h('div', { 'class': 'krl-band krl-dgrid kr-traffic' }, cards),
			h('div', { 'class': 'kr-sub', 'style': 'margin-top:6px' }, '↓ cihaza gelen (indirme), ↑ cihazdan giden (yükleme). Çubuk, cihazın bugünkü payı. Sayaçlar modem yeniden başlasa da saklanır. Yalnızca IPv4 trafiği sayılır; donanım hızlandırma (NSS/flow offload) açıksa bazı akışlar eksik görünebilir.')
		]);
	},

	renderTraffic(s) {
		if (!s || !s.counters || !s.today) { this.card(this.elTraffic, 'traffic', 'Trafik', h('div', { 'class': 'kr-sub' }, 'Henüz veri yok; sayaçlar başladıktan 1-2 dakika sonra dolar.')); this.trafficBuilt = false; return; }
		const r = this.trafficLive(s);
		if (!this.trafficBuilt) {
			this.lb = { hd: [], hu: [] };
			this.elRate = this.buildRateSeg();
			this.elLive = h('div', {}, [this.buildLiveBand()]);
			this.elPeriods = h('div', {});
			this.elDevTr = h('div', {});
			this.elChart = h('div', { 'class': 'krc-wrap' });
			this.elSvg = h('div', {});
			this.elChart.appendChild(this.elSvg);
			this.elTip = h('div', { 'class': 'krc-tip' });
			this.elChart.appendChild(this.elTip);
			this.elChart.addEventListener('mouseleave', () => { this.elTip.style.display = 'none'; });
			this.elChart.addEventListener('mousemove', ev => this.chartPick(ev));
			this.elChart.addEventListener('click', ev => this.chartPick(ev));
			this.elChartTiles = h('div', {});
			this.elChartInfo = h('div', { 'class': 'krc-info' });
			this.elLegend = h('div', { 'class': 'krc-legend' });
			const cs = this.chartState();
			this.segB = {};
			const rangeSeg = h('div', { 'class': 'kr-seg kr-seg-sm krc-rng' }, [[7, '7 gün'], [30, '30 gün'], ['a', 'Aylar']].map(d => {
				const bt = h('button', { 'class': 'btn', 'click': () => { cs.range = d[0] === 'a' ? 'a' : +d[0]; cs.sel = null; cs.anim = true; this.chartSave(); this.renderChartSummary(); this.renderChartBody(); } }, d[1]);
				this.segB[String(d[0])] = bt;
				return bt;
			}));
			this.layoutCfg = this.loadLayout(); this.editing = false;
			this.elTools = h('div', { 'class': 'ks-tools' });
			this.elSecs = h('div', {});
			this.secs = {
				live: this.elLive,
				periods: this.fold('t-periods', 'Toplam', this.elPeriods),
				devs: this.fold('t-devs', 'Cihaz bazında trafik', this.elDevTr),
				chart: this.fold('t-chart', 'Ortalama', h('div', {}, [
					this.elChartTiles,
					h('div', { 'class': 'krc-ctl' }, [rangeSeg]),
					this.elLegend,
					this.elChart,
					this.elChartInfo
				]))
			};
			this.card(this.elTraffic, 'traffic', 'Trafik', [
				this.elTools,
				this.elSecs,
				h('div', { 'class': 'kr-sub', 'style': 'margin-top:8px' }, 'Sayaçlar modem yeniden başlasa da saklanır (her saat flash\'a yazılır). İndirme = modeme/cihaza gelen, yükleme = giden.')
			]);
			this.trafficBuilt = true;
			this.layout();
		}
		this.renderLiveBand(s, r);
		this.renderPeriods(s);
		this.renderDevTraffic(s.devices || [], s.t, s.others);
		// grafik yalnızca veri ya da genişlik değişince yeniden çizilir (gezinme titremesin)
		const sig = JSON.stringify(s.days) + JSON.stringify(s.months || []) + '|' + (this.elChart.clientWidth || 0);
		if (sig !== this.chartSig) {
			this.chartSig = sig;
			this.days = s.days; this.months = s.months || [];
			this.renderChartSummary();
			this.renderChartBody();
		}
	},

	render() {
		this.elTraffic = h('div', { 'class': 'kr-card kr-traffic', 'style': 'margin-bottom:14px' });
		this.trafficBuilt = false; this.chartSig = ''; this.lastStats = null;
		this.renderTraffic(null);
		setTimeout(() => this.zoomBar(), 0);
		// poll ile: sayfadan çıkınca LuCI durdurur, sekme arkadayken boşa çalışmaz
		poll.add(() => runJson(['stats']).then(s => this.renderTraffic(s)), 2);
		return h('div', {}, [
			h('style', {}, CSS),
			h('h2', {}, [h('img', { 'src': '/luci-static/kedistat-logo.svg', 'style': 'height:1.3em;vertical-align:-0.25em;margin-right:8px;border-radius:6px' }), 'KediStat']),
			this.elTraffic,
			this.buildUpdate(),
			this.buildRepoStats(),
			this.buildBackup(),
			h('div', { 'class': 'ks-sup' }, [
				h('div', {}, [h('b', {}, '☕ Beğendin mi?'), h('span', {}, 'KediStat ücretsiz ve açık kaynak. Emeğe küçük bir destek çok değerli.')]),
				h('a', { 'class': 'ks-coffee', 'href': 'https://buymeacoffee.com/sabanvurgun', 'target': '_blank', 'rel': 'noopener noreferrer' }, '☕ Bana bir kahve ısmarla')
			]),
			h('div', { 'class': 'ks-foot' }, [h('a', { 'href': 'https://github.com/sabanvurgun03-ui/kedistat', 'target': '_blank', 'rel': 'noopener noreferrer' }, 'KediStat'), ' · Şaban Vurgun · GPL-3.0'])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
