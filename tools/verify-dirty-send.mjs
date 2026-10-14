// 验证「只发变化的数据」这一优化，同样不需要键盘。
//
//   node tools/verify-dirty-send.mjs
//
// 断言：
//   1. 第一帧必须全量（10 个包）—— 设备缓冲里原本有什么，插件无从得知
//   2. 画面完全没变的下一帧，一个包都不发
//   3. 只改一颗灯，只发「它所在的那个窗口 + 末包」
//   4. 末包永远带末包标志（设备靠它判定传输结束）
//   5. DirtySend = Off (Full Frame) 时退回全量

import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = pathToFileURL(fileURLToPath(new URL("../EWEADN X87 V2.js", import.meta.url))).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let packets = [];
let pauses = [];
const canvas = new Map();

globalThis.device = {
	log: () => {},
	write: (p) => { packets.push(Array.prototype.slice.call(p)); },
	read: (b) => b,
	pause: (ms) => { pauses.push(ms); },
	color: (x, y) => canvas.get(x + "," + y) || [0, 0, 0],
	productId: () => 0xfef9,
	getLastReadSize: () => 0
};

globalThis.LightingMode = "Canvas";
globalThis.forcedColor = "009bde";
globalThis.shutdownColor = "000000";
globalThis.ExitLighting = "Restore Original";
globalThis.ExitEffect = "Static (0x01)";
globalThis.ExitColor = "FFFFFF";
globalThis.ExitBrightness = "5";
globalThis.ExitSpeed = "5";
globalThis.WriteMode = "Realtime (0x32)";
globalThis.WirelessChannel = "Custom Area (0x24 / 36)";
globalThis.SendModeCommand = "On";
globalThis.DeviceMode = "0x80 (128)";
globalThis.Brightness = "5";
globalThis.Amplitude = "5";
globalThis.ReapplySeconds = "0";      // 关掉重放，免得干扰计数
globalThis.FrameRate = "60";
globalThis.DirtySend = "On";

const mod = await import(PLUGIN);

const names = mod.LedNames();
const positions = mod.LedPositions();

let fail = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fail++; };

/* 整块画布涂同一个颜色，extra 指定的那一颗除外 */
function paintAll(rgb, extra) {
	canvas.clear();
	for (let i = 0; i < positions.length; i++) {
		canvas.set(positions[i][0] + "," + positions[i][1],
			extra && extra.i === i ? extra.rgb : rgb);
	}
}

async function frame() {
	packets = [];
	pauses = [];
	await sleep(40);          // 越过限帧（60fps = 17ms）
	mod.Render();
	return packets;
}

/* 把这一帧的 cmd 0x24 包拆成 {addr, len, last} */
function describe(pkts) {
	return pkts
		.filter((p) => p[2] === 0x24)
		.map((p) => ({ addr: p[4] | (p[5] << 8), len: p[3], last: p[7] === 1 }));
}

console.log("");
console.log("=== 初始化 ===");
mod.Initialize();
await sleep(50);
console.log("  LED " + names.length + " 颗，画布 " + mod.Size().join("×"));

console.log("");
console.log("=== 1. 第一帧：必须全量 ===");
paintAll([255, 0, 0]);
let d = describe(await frame());
console.log("  发出 " + d.length + " 个 cmd 0x24 包: " + d.map((x) => x.addr + "+" + x.len).join(", "));
if (d.length === 10) ok("全量 10 包（512 字节 / 每包 56）");
else bad("应为 10 包，实际 " + d.length);
if (d.length && d[d.length - 1].last) ok("末包带末包标志");
else bad("末包没有末包标志");
if (d.length && d[d.length - 1].addr === 504 && d[d.length - 1].len === 8) ok("末包 = 偏移 504、长度 8");
else bad("末包地址/长度不对");

console.log("");
console.log("=== 2. 画面没变：一个包都不该发 ===");
d = describe(await frame());
console.log("  发出 " + d.length + " 个包");
if (d.length === 0) ok("零包 —— 整帧被跳过");
else bad("应当 0 包，实际 " + d.length);

console.log("");
console.log("=== 3. 只改一颗灯：只发它所在窗口 + 末包 ===");
const target = names.indexOf("PageDown");
if (target < 0) {
	bad("没找到 PageDown");
} else {
	const slot = 108;                       // PageDown 的槽位
	const wantChunk = Math.floor((slot * 4) / 56);
	paintAll([255, 0, 0], { i: target, rgb: [0, 255, 0] });
	d = describe(await frame());
	console.log("  改「" + names[target] + "」(槽 " + slot + ")，发出 " +
		d.length + " 个包: " + d.map((x) => x.addr + "+" + x.len).join(", "));
	if (d.length === 2) ok("只发 2 包，不是 10 包");
	else bad("应为 2 包（窗口 " + wantChunk + " + 末包），实际 " + d.length);
	if (d.length && Math.floor(d[0].addr / 56) === wantChunk) ok("第一包正是它所在的窗口 " + wantChunk);
	else bad("第一包窗口不对: " + (d.length ? Math.floor(d[0].addr / 56) : "无"));
	if (d.length && d[d.length - 1].last) ok("末包仍带末包标志");
	else bad("末包没带标志");
}

console.log("");
console.log("=== 4. 改动之后，影子应已同步 ===");
d = describe(await frame());
if (d.length === 0) ok("再画一次同样内容 —— 又是零包");
else bad("影子没更新，又发了 " + d.length + " 包");

console.log("");
console.log("=== 5. DirtySend = Off 退回全量 ===");
globalThis.DirtySend = "Off (Full Frame)";
d = describe(await frame());
console.log("  发出 " + d.length + " 个包");
if (d.length === 10) ok("全量 10 包");
else bad("应为 10 包，实际 " + d.length);
globalThis.DirtySend = "On";

console.log("");
console.log("=== 6. 包间停顿是否按预算摊开 ===");
paintAll([0, 0, 255]);
packets = []; pauses = [];
await sleep(40);
mod.Render();
console.log("  全量帧停顿: [" + pauses.join(", ") + "] ms（限 " +
	Math.round(1000 / 60) + " ms/帧，单次上限 6 ms）");
if (pauses.every((ms) => ms <= 6)) ok("停顿没超过上限");
else bad("停顿超上限: " + pauses.join(","));

console.log("");
console.log(fail === 0 ? "全部通过 ✓" : fail + " 项不通过 ✗");
process.exit(fail === 0 ? 0 : 1);
