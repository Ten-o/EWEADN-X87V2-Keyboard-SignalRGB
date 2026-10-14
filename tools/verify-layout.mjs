// 在 Node 里直接加载插件，核对键位表 —— 不需要键盘，也不需要启动 SignalRGB。
//
//   node tools/verify-layout.mjs
//
// 检查四件事：
//   1. LED 颗数是不是 87，有没有 layoutCode 漏了槽位映射
//   2. 逐个键反推它实际被写到哪个设备槽位（走真实 Render 路径，不是读源码猜）
//   3. 槽位有没有重复、坐标有没有越界
//   4. 槽位与已知的真机对照表逐条比对

import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN = pathToFileURL(fileURLToPath(new URL("../EWEADN X87 V2.js", import.meta.url))).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let written = [];
const canvas = new Map();

globalThis.device = {
	log: (m) => console.log("    [log] " + m),
	write: (p) => { written.push(Array.prototype.slice.call(p)); },
	read: (buf) => buf,
	pause: () => {},
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
globalThis.ReapplySeconds = "0";
globalThis.FrameRate = "60";
globalThis.DirtySend = "On";

const mod = await import(PLUGIN);

const names = mod.LedNames();
const positions = mod.LedPositions();
const size = mod.Size();
let fail = 0;
const bad = (m) => { console.log("  ✗ " + m); fail++; };
const ok = (m) => console.log("  ✓ " + m);

console.log("");
console.log("=== 1. 基本形状 ===");
console.log("  Name     : " + mod.Name());
console.log("  Size     : [" + size[0] + ", " + size[1] + "]");
console.log("  LED 颗数 : " + names.length);
if (names.length !== 87) bad("应为 87 颗，实际 " + names.length);
else ok("87 颗，与 X87 键数一致");

if (positions.length !== names.length) bad("LedNames / LedPositions 长度不一致");

console.log("");
console.log("=== 2. 坐标范围 ===");
let outside = 0;
for (let i = 0; i < positions.length; i++) {
	const x = positions[i][0], y = positions[i][1];
	if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) {
		if (outside < 5) bad(names[i] + " 越界 [" + x + ", " + y + "]");
		outside++;
	}
}
if (!outside) ok("全部落在 0.." + (size[0] - 1) + " × 0.." + (size[1] - 1) + " 内");

// ---- 反推槽位：让第 i 颗单独亮白，看颜色落进哪个槽 ----
mod.Initialize();
await sleep(30);

const slots = [];
for (let i = 0; i < names.length; i++) {
	canvas.clear();
	canvas.set(positions[i][0] + "," + positions[i][1], [255, 255, 255]);

	written = [];
	await sleep(20);          // 越过限帧
	mod.Render();

	// 把这一帧的 cmd 0x24 包拼回 512 字节
	const data = new Array(512).fill(0);
	let saw = false;
	for (const p of written) {
		if (p[2] !== 0x24) continue;
		saw = true;
		const addr = p[4] | (p[5] << 8);
		for (let k = 0; k < p[3]; k++) data[addr + k] = p[9 + k];
	}
	if (!saw) { slots.push("没有 cmd 0x24 包"); continue; }

	const hits = [];
	for (let s = 0; s < 128; s++) {
		if (data[s * 4 + 1] || data[s * 4 + 2] || data[s * 4 + 3]) hits.push(s);
	}
	slots.push(hits.length === 1 ? hits[0] : ("命中 " + hits.length + " 个槽: " + hits.join(",")));
}

console.log("");
console.log("=== 3. 逐键 名称 / 槽位 / 坐标 ===");
const byRow = new Map();
for (let i = 0; i < names.length; i++) {
	const row = positions[i][1];
	if (!byRow.has(row)) byRow.set(row, []);
	byRow.get(row).push({ n: names[i], x: positions[i][0], s: slots[i] });
}
for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
	const items = byRow.get(row).sort((a, b) => a.x - b.x);
	console.log("  行" + row + ": " + items.map((k) => k.n + "@" + k.s).join("  "));
}

console.log("");
console.log("=== 4. 槽位唯一性 ===");
const seen = new Map();
for (let i = 0; i < names.length; i++) {
	const s = slots[i];
	if (typeof s !== "number") { bad(names[i] + " 槽位异常: " + s); continue; }
	if (seen.has(s)) bad("槽位 " + s + " 被「" + seen.get(s) + "」和「" + names[i] + "」抢");
	seen.set(s, names[i]);
}
if (seen.size === names.length) ok(names.length + " 个槽位互不重复");

console.log("");
console.log("=== 5. 与真机对照表逐条比对 ===");
// 这张表是用 tools 之外的一次逐槽点亮（每槽单独点亮、人眼确认）测出来的
const expect = {
	"Esc": 0, "F1": 1, "F12": 12, "PrintScreen": 99, "ScrollLock": 100, "Pause": 102,
	"`": 16, "1": 17, "0": 26, "-": 27, "=": 28, "Backspace": 92,
	"Tab": 32, "Q": 33, "P": 42, "[": 43, "]": 44, "\\": 60,
	"Caps": 48, "A": 49, "L": 57, ";": 58, "'": 59, "Enter": 76,
	"L Shift": 64, "Z": 65, "M": 71, ",": 72, ".": 73, "/": 74, "R Shift": 75,
	"L Ctrl": 80, "L Win": 81, "L Alt": 82, "Space": 83, "R Alt": 84, "Fn": 85,
	"Menu": 86, "R Ctrl": 87, "Left": 88, "Down": 89, "Up": 90, "Right": 91,
	"Insert": 103, "Home": 104, "PageUp": 105,
	"Delete": 106, "End": 107, "PageDown": 108
};
const got = {};
for (let i = 0; i < names.length; i++) got[names[i]] = slots[i];

let wrong = 0;
for (const k of Object.keys(expect)) {
	if (got[k] !== expect[k]) { bad(k + " 槽位 " + got[k] + "，应为 " + expect[k]); wrong++; }
}
if (!wrong) ok(Object.keys(expect).length + " 个键全部吻合");

console.log("");
console.log(fail === 0 ? "全部通过 ✓" : (fail + " 项不通过 ✗"));
process.exit(fail === 0 ? 0 : 1);
