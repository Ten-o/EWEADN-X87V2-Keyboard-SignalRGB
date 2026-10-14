/*
	前行者 (EWEADN) X87 V2 键盘 — SignalRGB 逐键灯光插件

	协议逆向自官方 WebHID Hub 与 @hfd-sdk/keyboard-sdk 2.0.2。
	键盘方案：华奋达 (huafenda)，keyboardType = huafenda87。

	两条链路是同一把键盘，键位、槽位、内置灯效表完全一致，所以只有一个插件文件：
	  有线   VID 0x0C45 / PID 0x80BB   灯光接口 usage_page 0xFF68, usage 0x61
	  2.4G   VID 0x0C45 / PID 0xFEF9   灯光接口 usage_page 0xFF60, usage 0x61
	ProductId() 同时返回两个 PID，运行时用 device.productId() 判断当前实例挂在哪条链路上。

	── HID 报告 ────────────────────────────────────────────────────────────
	厂商接口没有 feature report，只有输出报告。线上报告 65 字节，**字节 0 是 report ID**，
	华奋达包头从字节 1 开始：

	    [0]      report ID (0x00)
	    [1]      0xAA
	    [2]      cmd
	    [3]      本包长度
	    [4][5]   地址，小端（按字节偏移寻址）
	    [6]      振幅（音乐通道用）
	    [7]      末包标志
	    [8]      0
	    [9..64]  载荷，每包最多 56 字节

	长度必须 65：写 64 字节会拿到 WriteFile err 87。必须用 device.write()（WriteFile →
	输出报告）；device.send_report() 走 HidD_SetFeature，本设备直接返回
	ERROR_INVALID_FUNCTION，永远发不出去。应答包头字节 1 = 0x55、字节 2 = cmd，载荷从
	字节 9 起。

	── 逐键通道 ────────────────────────────────────────────────────────────
	进自定义通道必须先发 cmd 0x23 SET_LED_EFFECT（16 字节），再推逐键数据；顺序反了实体
	会全黑。0x23 载荷：byte0 = mode，byte4 = 0xFF（驱动标志，必填），byte8 = colorMode
	（0 单色 / 1 RGB），byte9 = 亮度 1~5，byte10 = 速度 1~5，byte11 = 方向 0~3，
	byte14/15 = 0xAA/0x55。

	逐键数据走 cmd 0x24 SET_CUSTOM_LED_DATA：512 字节 = 128 组 [槽位, R, G, B]，
	**数组下标就是槽位**（SDK 传的 ledId 字段被它自己的写入端丢弃，是个幌子）。每包
	56 字节，末包打末包标志。因为地址是按字节偏移寻址的，所以可以只发变化的那几个窗口。

	两个备用通道（默认不用，见 WirelessChannel 设置）：
	  cmd 0x3C  RGB565 大端，每灯 2 字节，数组下标即灯位，每包 56 字节
	  cmd 0x35  头 4 字节 [0xAA, 53, 包序号, 振幅]，载荷从第 5 字节起，每包 60 字节

	── 退出时还原 ──────────────────────────────────────────────────────────
	接管前用 cmd 0x13 GET_LED_EFFECT 读回 16 字节原灯效，退出时原样写回。本设备没有
	feature report，device.read() 收不到输入报告时会把传入的请求缓冲区原样退回，所以
	判断「是否真的读到了」必须看 device.getLastReadSize() —— 只看包头会把「没读到」
	误判成读到了。读不到、或原灯效本身就是不可还原的自定义/律动档（20 / 0x80 / 128），
	就写回用户选定的内置灯效。
*/

export function Name() { return "前行者 X87 V2"; }
export function VendorId() { return 0x0C45; }
export function ProductId() { return [0x80BB, 0xFEF9]; }
export function Publisher() { return "Reverse-engineered from the official WebHID hub"; }
export function Size() { return [layoutWidth, layoutMatrix.length * SUB]; }
export function DefaultPosition() { return [10, 100]; }
export function DefaultScale() { return 8.0; }

export function ControllableParameters() {
	return [
		{ "property": "shutdownColor", "group": "lighting", "label": "Shutdown Color", "min": "0", "max": "360", "type": "color", "default": "000000" },
		{ "property": "LightingMode", "group": "lighting", "label": "Lighting Mode", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
		{ "property": "forcedColor", "group": "lighting", "label": "Forced Color", "min": "0", "max": "360", "type": "color", "default": "009bde" },

		{ "property": "ExitLighting", "group": "on exit", "label": "Hand Back To Keyboard", "type": "combobox", "values": ["Restore Original", "Built-in Effect", "Off", "Shutdown Color"], "default": "Restore Original" },
		{ "property": "ExitEffect", "group": "on exit", "label": "Exit Effect", "type": "combobox", "values": ["Static (0x01)", "Press Light (0x02)", "Release Off (0x03)", "Starry (0x04)", "Snow (0x05)", "Blossom (0x06)", "Breathing (0x07)", "Spectrum (0x08)", "Spring (0x09)", "Colorful (0x0A)", "Wave (0x0B)", "Peak Turn (0x0C)", "Instant (0x0D)", "Double Hit (0x0E)", "Ripple (0x0F)", "Flow (0x10)", "Mountain (0x11)", "Rain (0x12)", "Shuttle (0x13)", "Heartbeat (0xFE)"], "default": "Static (0x01)" },
		{ "property": "ExitColor", "group": "on exit", "label": "Exit Effect Color", "min": "0", "max": "360", "type": "color", "default": "FFFFFF" },
		{ "property": "ExitBrightness", "group": "on exit", "label": "Exit Brightness (1-5)", "min": "1", "max": "5", "type": "number", "default": "5" },
		{ "property": "ExitSpeed", "group": "on exit", "label": "Exit Speed (1-5)", "min": "1", "max": "5", "type": "number", "default": "5" },

		{ "property": "WriteMode", "group": "device", "label": "Wired Write Mode", "type": "combobox", "values": ["Realtime (0x32)", "Profile (0x24)"], "default": "Realtime (0x32)" },
		{ "property": "WirelessChannel", "group": "device", "label": "2.4G Channel", "type": "combobox", "values": ["Custom Area (0x24 / 36)", "Music 24G 64B (0x3C / 60)", "Music (0x35 / 53)"], "default": "Custom Area (0x24 / 36)" },
		{ "property": "SendModeCommand", "group": "device", "label": "Send Custom-Mode Command", "type": "combobox", "values": ["On", "Off"], "default": "On" },
		{ "property": "DeviceMode", "group": "device", "label": "Device Lighting Mode", "type": "combobox", "values": ["0x80 (128)", "20"], "default": "0x80 (128)" },
		{ "property": "Brightness", "group": "device", "label": "Brightness (1-5)", "min": "1", "max": "5", "type": "number", "default": "5" },
		{ "property": "Amplitude", "group": "device", "label": "Music Channel Amplitude (0-7)", "min": "0", "max": "7", "type": "number", "default": "5" },
		{ "property": "ReapplySeconds", "group": "device", "label": "Reapply Mode Every (s, 0=off)", "min": "0", "max": "600", "type": "number", "default": "15" },
		{ "property": "FrameRate", "group": "device", "label": "Frame Rate Limit (fps)", "min": "5", "max": "60", "type": "number", "default": "20" },
		{ "property": "DirtySend", "group": "device", "label": "Send Only Changed Data", "type": "combobox", "values": ["On", "Off (Full Frame)"], "default": "On" }
	];
}

/* ------------------------------------------------------------------ *
 *  HID 常量
 * ------------------------------------------------------------------ */
const CMD_GET_LED_EFFECT = 0x13;             // 读取 LED 特效区（还原用）
const CMD_SET_LED_EFFECT = 0x23;             // 写入 LED 特效区 / 进自定义通道
const CMD_SET_CUSTOM_LED_DATA = 0x24;        // 写入自定义逐键数据
const CMD_GET_LED_DATA = 0x32;               // 有线实时逐键通道
const CMD_SET_MUSIC_DATA = 0x35;             // 2.4G 旧实时通道（RGB565）
const CMD_SET_MUSIC_DATA_24G_64B = 0x3C;     // 2.4G 新实时通道（RGB565）

const REPORT_SIZE = 65;                      // 线上报告总长（含 report ID 字节）
const REPORT_ID = 0x00;                      // 字节 0：report ID，实测必须为 0x00
const HEADER_AT = 1;                         // 华奋达包头起始（0xAA 所在）
const HEADER_SIZE = 8;                       // 华奋达包头长度
const PAYLOAD_AT = HEADER_AT + HEADER_SIZE;  // 9，载荷起点
const PAYLOAD_MAX = REPORT_SIZE - PAYLOAD_AT;                         // 56
const MUSIC53_HEADER = 4;                    // cmd 0x35 的自定义包头长度
const MUSIC53_PAYLOAD_MAX = REPORT_SIZE - HEADER_AT - MUSIC53_HEADER; // 60

const LED_SLOTS = 128;                       // 512 / 4，槽位 0..127

const RESPONSE_HEADER = 0x55;
const READ_TIMEOUT_MS = 300;

/* 链路判定 */
const PID_WIRED = 0x80BB;
const PID_DONGLE = 0xFEF9;
const PAGE_WIRED = 0xFF68;
const PAGE_DONGLE = 0xFF60;
const USAGE_LIGHT = 0x0061;

/* 华奋达判定为「不可还原」的灯效 mode：UI 自定义档 20，固件自定义/律动通道 128 */
function isNonRestorableMode(mode) {
	return mode === 20 || mode === 128 || mode === 0x80;
}

/* 内置灯效 mode 表 */
const exitEffectModes = {
	"Static (0x01)": 0x01,
	"Press Light (0x02)": 0x02,
	"Release Off (0x03)": 0x03,
	"Starry (0x04)": 0x04,
	"Snow (0x05)": 0x05,
	"Blossom (0x06)": 0x06,
	"Breathing (0x07)": 0x07,
	"Spectrum (0x08)": 0x08,
	"Spring (0x09)": 0x09,
	"Colorful (0x0A)": 0x0A,
	"Wave (0x0B)": 0x0B,
	"Peak Turn (0x0C)": 0x0C,
	"Instant (0x0D)": 0x0D,
	"Double Hit (0x0E)": 0x0E,
	"Ripple (0x0F)": 0x0F,
	"Flow (0x10)": 0x10,
	"Mountain (0x11)": 0x11,
	"Rain (0x12)": 0x12,
	"Shuttle (0x13)": 0x13,
	"Heartbeat (0xFE)": 0xFE
};

/* ------------------------------------------------------------------ *
 *  布局：华奋达 X87 骨架矩阵（layoutCode，0 = 无键位）
 * ------------------------------------------------------------------ */
const GRID_COLS = 21;

/* 画布坐标用「1 键宽 = SUB 格」的整数网格，不做小数。
   厂商的缝是 0.525 / 0.33 / 1.1 这类小数：如果画布是 1 键 1 格，SignalRGB 按格取整后，
   同一个物理间隔会时显时隐 —— F4→F5 的 1.525 变成 2 格，F8→F9 的同一个 1.525 却只剩
   1 格，结果 F5 被挤到 F6 的位置上。提到 4 倍分辨率后坐标全是整数，缝精确。 */
const SUB = 4;

const layoutMatrix = [
	[41, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 0, 0, 0, 0, 0],
	[53, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42, 73, 74, 75, 0, 0, 0, 0],
	[43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49, 76, 77, 78, 0, 0, 0, 0],
	[57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 40, 0, 0, 0, 0, 0, 0, 0, 0],
	[225, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 229, 0, 0, 82, 0, 0, 0, 0, 0, 0],
	[224, 227, 226, 0, 0, 0, 44, 0, 0, 0, 230, 61697, 101, 228, 80, 81, 79, 0, 0, 0, 0]
];

/* ------------------------------------------------------------------ *
 *  layoutCode -> 设备灯光槽位
 *
 *  槽位**不是**「行*21+列」。F 排前 13 个（Esc、F1..F12）碰巧等于 0..12，所以「给全部
 *  128 槽涂同一个颜色」的测试掩盖了这个错误 —— 统一颜色下槽位错位是看不出来的。
 *      PrintScreen  行*21+列 = 13   实际 = 99
 *      `            行*21+列 = 21   实际 = 16
 *      Tab          行*21+列 = 42   实际 = 32
 *      A            行*21+列 = 64   实际 = 49
 *  这张表已在真机上逐槽点亮验证过。
 * ------------------------------------------------------------------ */
const codeToSlot = {
	// 字母/数字/符号主区
	4: 49, 5: 69, 6: 67, 7: 51, 8: 35, 9: 52, 10: 53, 11: 54, 12: 40, 13: 55,
	14: 56, 15: 57, 16: 71, 17: 70, 18: 41, 19: 42, 20: 33, 21: 36, 22: 50,
	23: 37, 24: 39, 25: 68, 26: 34, 27: 66, 28: 38, 29: 65,
	30: 17, 31: 18, 32: 19, 33: 20, 34: 21, 35: 22, 36: 23, 37: 24, 38: 25, 39: 26,
	// 功能键
	40: 76, 41: 0, 42: 92, 43: 32, 44: 83, 45: 27, 46: 28, 47: 43, 48: 44, 49: 60,
	51: 58, 52: 59, 53: 16, 54: 72, 55: 73, 56: 74, 57: 48,
	58: 1, 59: 2, 60: 3, 61: 4, 62: 5, 63: 6, 64: 7, 65: 8, 66: 9, 67: 10, 68: 11, 69: 12,
	70: 99, 71: 100, 72: 102,
	// 导航区
	73: 103, 74: 104, 75: 105, 76: 106, 77: 107, 78: 108,
	// 方向键
	79: 91, 80: 88, 81: 89, 82: 90,
	// 修饰键
	224: 80, 225: 64, 226: 82, 227: 81, 228: 87, 229: 75, 230: 84, 101: 86, 61697: 85
};

/* ------------------------------------------------------------------ *
 *  视觉间距：after = 该行数组下标，size 以键宽为单位。
 *  不加这套缝，画出来的键盘会挤成一个方块，跟实机对不上版。
 * ------------------------------------------------------------------ */
const gapRules = [
	{ row: 0, after: 0, size: 1.1 },     // Esc 后（F 排分四组）
	{ row: 0, after: 4, size: 0.525 },   // F4 后
	{ row: 0, after: 8, size: 0.525 },   // F8 后
	{ row: 0, after: 12, size: 0.33 },   // F12 后
	{ row: 1, after: 13, size: 0.25 },   // Backspace 后
	{ row: 2, after: 13, size: 0.25 },   // \ 后
	{ row: 4, after: 12, size: 1.3 },    // RShift 后
	{ row: 4, after: 16, size: 1.1 },    // ↑ 后
	{ row: 5, after: 13, size: 0.25 }    // R Ctrl 后
];

function gapAfter(row, col) {
	for (let i = 0; i < gapRules.length; i++) {
		if (gapRules[i].row === row && gapRules[i].after === col) return gapRules[i].size;
	}
	return 0;
}

/* layoutCode -> LED 名称 */
const codeToName = {
	4: "A", 5: "B", 6: "C", 7: "D", 8: "E", 9: "F", 10: "G", 11: "H", 12: "I", 13: "J",
	14: "K", 15: "L", 16: "M", 17: "N", 18: "O", 19: "P", 20: "Q", 21: "R", 22: "S",
	23: "T", 24: "U", 25: "V", 26: "W", 27: "X", 28: "Y", 29: "Z",
	30: "1", 31: "2", 32: "3", 33: "4", 34: "5", 35: "6", 36: "7", 37: "8", 38: "9", 39: "0",
	40: "Enter", 41: "Esc", 42: "Backspace", 43: "Tab", 44: "Space",
	45: "-", 46: "=", 47: "[", 48: "]", 49: "\\",
	51: ";", 52: "'", 53: "`", 54: ",", 55: ".", 56: "/",
	57: "Caps",
	58: "F1", 59: "F2", 60: "F3", 61: "F4", 62: "F5", 63: "F6",
	64: "F7", 65: "F8", 66: "F9", 67: "F10", 68: "F11", 69: "F12",
	70: "PrintScreen", 71: "ScrollLock", 72: "Pause",
	73: "Insert", 74: "Home", 75: "PageUp", 76: "Delete", 77: "End", 78: "PageDown",
	79: "Right", 80: "Left", 81: "Down", 82: "Up",
	101: "Menu",
	224: "L Ctrl", 225: "L Shift", 226: "L Alt", 227: "L Win",
	228: "R Ctrl", 229: "R Shift", 230: "R Alt",
	61697: "Fn"
};

/* 由矩阵生成 LED 表：
     ledSlots[i]     设备灯光槽位
     ledPositions[i] 画布坐标，单位 1/SUB 键宽，全是整数 */
const ledSlots = [];
const ledPositions = [];
const ledNames = [];
const unmappedCodes = [];
let layoutWidth = 0;

for (let row = 0; row < layoutMatrix.length; row++) {
	let x = 0;

	for (let col = 0; col < GRID_COLS; col++) {
		const code = layoutMatrix[row][col];

		if (code) {
			const slot = codeToSlot[code];

			if (slot === undefined) {
				unmappedCodes.push(code);
			} else {
				ledSlots.push(slot);
				ledPositions.push([x, row * SUB]);
				ledNames.push(codeToName[code] || ("KEY_" + code));
				if (x + SUB > layoutWidth) layoutWidth = x + SUB;
			}
		}

		// 先占满一键宽，再补厂商那道缝（缝同样取整到 1/SUB，误差 ≤ 1/8 键宽）
		x += SUB + Math.round(gapAfter(row, col) * SUB);
	}
}

export function LedNames() { return ledNames; }
export function LedPositions() { return ledPositions; }

/* ------------------------------------------------------------------ *
 *  状态
 * ------------------------------------------------------------------ */
let loggedFailure = false;
let savedEffect = null;         // 接管前的 16 字节灯效，读不到则为 null
let restoreDone = false;
let wireless = false;           // 当前实例是否挂在 2.4G 接收器上

/* 节流与统计。
   SignalRGB 不管插件死活照 60fps 调 Render，照单全收地往下灌的话写会无限积压、全部
   挂 PENDING，最后句柄报 995 (ERROR_OPERATION_ABORTED)，键盘只被点亮一小片。
   厂商 SDK 是靠「每个包都等一次应答」来背压的，这里没有那条路，只能自己限帧。 */
let nextFrameAt = 0;            // 限帧从帧首起算，见 Render()
let nextReapplyAt = 0;
let sendFailures = 0;
let framesSent = 0;
let packetsSent = 0;            // 统计窗口内实际发出的包数
let statsWindowAt = 0;

/* 增量发送用的影子副本：cmd -> 上一帧真正发出去的完整内容。
   没有条目 = 必须整帧重发（设备缓冲不可信：刚进自定义通道、刚重放 mode、上次有包失败）。*/
const shadows = {};
let shadowStream = null;        // cmd 0x35 专用：上一帧的 RGB565 流
let shadowStreamValid = false;

/* 包间停顿的上限（毫秒），见 packetGapMs() */
const PACKET_GAP_MAX = 6;

/* writeMsTotal / writeCount 既是诊断数据，也是 packetGapMs() 的输入 */
let writeMsTotal = 0, writeCount = 0;

function nowMs() {
	if (typeof performance !== "undefined" && performance &&
		typeof performance.now === "function") {
		return performance.now();
	}
	return Date.now();
}

function ms(v) {
	return Math.round(v * 10) / 10;
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex));
	if (!result) return [0, 0, 0];
	return [
		parseInt(result[1], 16),
		parseInt(result[2], 16),
		parseInt(result[3], 16)
	];
}

function clampByte(v) {
	const n = Math.round(Number(v));
	if (!isFinite(n) || n < 0) return 0;
	if (n > 255) return 255;
	return n;
}

function hex2(v) {
	return ("0" + (v & 0xFF).toString(16).toUpperCase()).slice(-2);
}

function hexPreview(bytes, count) {
	if (!bytes || !bytes.length) return "(空)";
	const out = [];
	for (let i = 0; i < Math.min(count, bytes.length); i++) out.push(hex2(bytes[i]));
	return out.join(" ");
}

function clampLevel(v, fallback) {
	let n = parseInt(v, 10);
	if (!isFinite(n)) n = fallback;
	return Math.max(1, Math.min(5, n));
}

function clampAmplitude(v) {
	let n = parseInt(v, 10);
	if (!isFinite(n)) n = 0;
	return Math.max(0, Math.min(7, n));
}

function logOnce(msg) {
	if (!loggedFailure) {
		loggedFailure = true;
		device.log(msg);
	}
}

/* 发出一个 65 字节输出报告。本设备没有 feature report，必须用 write。 */
function writeReport(packet) {
	const t0 = nowMs();
	try {
		device.write(packet, REPORT_SIZE);
	} catch (e) {
		sendFailures++;
		logOnce("X87 V2 发送失败: " + e);
		return false;
	}

	writeMsTotal += nowMs() - t0;
	writeCount++;
	return true;
}

/* 限帧上限，毫秒/帧 */
function frameIntervalMs() {
	let fps = parseInt(FrameRate, 10);
	if (!isFinite(fps) || fps < 1) fps = 20;
	if (fps > 60) fps = 60;
	return Math.round(1000 / fps);
}

function dirtyEnabled() {
	return String(DirtySend) !== "Off (Full Frame)";
}

/* 影子里所有 cmd 作废：下次调用整帧重发 */
function invalidateShadows() {
	for (const k in shadows) delete shadows[k];
	shadowStreamValid = false;
}

/* 包间停顿不写死常数，而是把这一帧的时间预算摊到每个包上。
   固定 2ms 的问题：单包写入只要 1ms 时它白吃掉整帧的一大半，单包写入真要 5ms 时它又
   拦不住积压。现在改成「只有预算还有富余才补停顿」—— 写入本身的耗时已经是一种节流，
   不重复等；有富余时就把这帧摊开，而不是一股脑塞进接收器的 OUT 队列（队列满了写就
   不完成，最后整片报 995）。 */
function packetGapMs(packets) {
	const perPacket = frameIntervalMs() / Math.max(1, packets);
	const w = writeCount > 0 ? (writeMsTotal / writeCount) : 0;
	const gap = Math.round(perPacket - w);
	if (gap <= 0) return 0;
	return Math.min(PACKET_GAP_MAX, gap);
}

/* 每 5 秒往设备控制器日志里报一次实测帧率、每帧包数和发送失败数 */
function logFrameStats(now) {
	framesSent++;

	if (statsWindowAt === 0) {
		statsWindowAt = now;
		return;
	}

	const elapsed = now - statsWindowAt;
	if (elapsed < 5000) return;

	const fps = (framesSent * 1000 / elapsed).toFixed(1);
	const avgWrite = writeCount > 0 ? ms(writeMsTotal / writeCount) : 0;

	device.log("X87 V2: 实测 " + fps + " fps（限 " + frameIntervalMs() + " ms/帧）" +
		" | 包 " + (packetsSent / Math.max(1, framesSent)).toFixed(1) + "/帧" +
		" | 写 " + writeCount + " 次 均 " + avgWrite + " ms" +
		" | 失败 " + sendFailures + " 次");

	framesSent = 0;
	packetsSent = 0;
	writeMsTotal = 0;
	writeCount = 0;
	statsWindowAt = now;
}

/* 组装一个 65 字节出站包：字节 0 是 report ID，华奋达包头从字节 1 起，载荷从字节 9 起 */
function buildPacket(cmd, len, addr, lastFlag, payload, amplitude) {
	const packet = new Array(REPORT_SIZE).fill(0);
	packet[0] = REPORT_ID;
	packet[HEADER_AT] = 0xAA;
	packet[HEADER_AT + 1] = cmd & 0xFF;
	packet[HEADER_AT + 2] = len & 0xFF;
	packet[HEADER_AT + 3] = addr & 0xFF;
	packet[HEADER_AT + 4] = (addr >> 8) & 0xFF;
	if (amplitude) packet[HEADER_AT + 5] = amplitude & 0xFF;
	packet[HEADER_AT + 6] = lastFlag ? 1 : 0;

	if (payload) {
		for (let i = 0; i < payload.length && i < PAYLOAD_MAX; i++) {
			packet[PAYLOAD_AT + i] = payload[i] & 0xFF;
		}
	}

	return packet;
}

/* cmd 0x35 的包：头 [0xAA, 53, 包序号, 振幅] 占字节 1..4，载荷从字节 5 起，无末包标志 */
function buildMusic53Packet(index, amplitude, payload) {
	const packet = new Array(REPORT_SIZE).fill(0);
	packet[0] = REPORT_ID;
	packet[HEADER_AT] = 0xAA;
	packet[HEADER_AT + 1] = CMD_SET_MUSIC_DATA;
	packet[HEADER_AT + 2] = index & 0xFF;
	packet[HEADER_AT + 3] = amplitude & 0xFF;

	const at = HEADER_AT + MUSIC53_HEADER;
	for (let i = 0; i < payload.length && i < MUSIC53_PAYLOAD_MAX; i++) {
		packet[at + i] = payload[i] & 0xFF;
	}

	return packet;
}

/**
 * 按字节偏移切分内容并下发（标准 8 字节头）。
 *   byte2 = 本包长度（末包为剩余长度）
 *   byte6 = 末包标志
 *   载荷从字节 9 起
 * force = true 时忽略影子，整帧重发。
 */
function sendContent(cmd, data, amplitude, force) {
	const total = data.length;
	const packets = Math.max(1, Math.ceil(total / PAYLOAD_MAX));
	const last = packets - 1;
	const prev = shadows[cmd];

	/* 协议本身按字节偏移寻址，所以只发内容真的变了的窗口就够了。厂商每次都发全量只是
	   因为它不比较 —— 对我们那是每帧雷打不动的 10 个包，画面静止时也一样。 */
	const dirty = [];
	if (force || !dirtyEnabled() || !prev || prev.length !== total) {
		for (let k = 0; k <= last; k++) dirty.push(k);
	} else {
		for (let k = 0; k <= last; k++) {
			const a = k * PAYLOAD_MAX;
			const e = Math.min(a + PAYLOAD_MAX, total);
			for (let i = a; i < e; i++) {
				if (data[i] !== prev[i]) { dirty.push(k); break; }
			}
		}
		// 末包必须跟上：设备靠末包标志判定这一帧传输结束
		if (dirty.length && dirty[dirty.length - 1] !== last) dirty.push(last);
	}

	if (!dirty.length) return;      // 整帧内容没变，一个包都不发

	const gap = packetGapMs(dirty.length);
	let sent = 0;

	for (let n = 0; n < dirty.length; n++) {
		const k = dirty[n];
		const offset = k * PAYLOAD_MAX;
		const end = Math.min(offset + PAYLOAD_MAX, total);

		if (writeReport(buildPacket(
			cmd,
			end - offset,
			offset,
			k === last,
			data.slice(offset, end),
			amplitude
		))) {
			sent++;
			packetsSent++;
		}

		if (n < dirty.length - 1 && gap > 0 && typeof device.pause === "function") {
			device.pause(gap);
		}
	}

	// 只有整批都成功，影子和设备缓冲才算一致；有一个失败就作废，下次整帧重来
	if (sent === dirty.length) shadows[cmd] = data.slice();
	else delete shadows[cmd];
}

/* ------------------------------------------------------------------ *
 *  链路判定
 * ------------------------------------------------------------------ */
/**
 * 判断当前实例挂在哪条链路。
 * 首选 device.productId()：SignalRGB 按 PID 建实例，直接告诉我们答案。
 * 拿不到就退回扫 device.getHidEndpoints()，顺便把端点钉死。
 */
function detectLink() {
	try {
		if (typeof device.productId === "function") {
			const pid = Number(device.productId());
			if (pid === PID_DONGLE) return true;
			if (pid === PID_WIRED) return false;
		}
	} catch (e) {
		// 落到端点扫描
	}

	try {
		if (typeof device.getHidEndpoints === "function") {
			const endpoints = device.getHidEndpoints() || [];
			for (let i = 0; i < endpoints.length; i++) {
				const ep = endpoints[i];
				const page = Number(ep.usage_page);
				if (page !== PAGE_WIRED && page !== PAGE_DONGLE) continue;
				if (Number(ep.usage) !== USAGE_LIGHT) continue;

				if (typeof device.set_endpoint === "function") {
					device.set_endpoint(ep.interface, ep.usage, ep.usage_page, ep.collection);
				}
				return page === PAGE_DONGLE;
			}
		}
	} catch (e) {
		// 保持有线默认
	}

	return false;
}

/* ------------------------------------------------------------------ *
 *  读取原灯效（用于退出时还原）
 *  cmd 0x13：应答 [1]=0x55 [2]=0x13 [9..24]=16 字节灯效
 *
 *  本设备没有 feature report，device.read() 读不到东西时会把传入的请求缓冲区原样退回
 *  （response[1] 会是 0xAA）。所以必须用 device.getLastReadSize() 判断是否真的收到了
 *  输入报告。
 * ------------------------------------------------------------------ */
function readOriginalEffect() {
	if (typeof device.read !== "function") {
		device.log("X87 V2: 无 device.read，退出时写回内置灯效");
		return null;
	}

	try {
		if (typeof device.flush === "function") device.flush();
		else if (typeof device.clearReadBuffer === "function") device.clearReadBuffer();

		const request = buildPacket(CMD_GET_LED_EFFECT, 16, 0, true, null, 0);
		device.write(request, REPORT_SIZE);
		if (typeof device.pause === "function") device.pause(20);

		const response = device.read(request, REPORT_SIZE, READ_TIMEOUT_MS);

		// 有没有真的收到输入报告，以 lastReadSize 为准
		let readSize = -1;
		if (typeof device.getLastReadSize === "function") {
			readSize = Number(device.getLastReadSize()) || 0;
			if (readSize <= 0) {
				device.log("X87 V2: 原灯效读取无应答 (lastReadSize=0)，退出时写回内置灯效");
				return null;
			}
		}

		const preview = hexPreview(response, 10);

		if (!response || response.length < PAYLOAD_AT + 16) {
			device.log("X87 V2: 原灯效应答过短 (" + preview + ")，退出时写回内置灯效");
			return null;
		}
		if (response[HEADER_AT] !== RESPONSE_HEADER || response[HEADER_AT + 1] !== CMD_GET_LED_EFFECT) {
			device.log("X87 V2: 原灯效应答异常 (" + preview + ")，退出时写回内置灯效");
			return null;
		}

		const effect = new Array(16).fill(0);
		for (let i = 0; i < 16; i++) effect[i] = response[PAYLOAD_AT + i] & 0xFF;

		device.log("X87 V2: 已记录原灯效 mode=0x" + hex2(effect[0]) +
			" rgb=" + hex2(effect[1]) + hex2(effect[2]) + hex2(effect[3]) +
			" 亮度=" + effect[9] + " 速度=" + effect[10] + " 方向=" + effect[11] +
			" (lastReadSize=" + readSize + ")");

		return effect;
	} catch (e) {
		device.log("X87 V2: 读取原灯效失败 (" + e + ")，退出时写回内置灯效");
		return null;
	}
}

/* ------------------------------------------------------------------ *
 *  进出设置：把键盘切到「逐键自定义」通道
 * ------------------------------------------------------------------ */
function enterCustomMode() {
	if (String(SendModeCommand) === "Off") return;

	let mode = 128;
	if (String(DeviceMode) === "20") mode = 20;

	const payload = new Array(16).fill(0);
	payload[0] = mode;
	payload[4] = 0xFF;        // 驱动/软件控制标志（必须）
	payload[8] = 1;           // colorMode: RGB
	payload[9] = clampLevel(Brightness, 5);
	payload[10] = 5;          // 速度 1~5
	payload[11] = 0;          // 方向
	payload[14] = 0xAA;       // 检测码
	payload[15] = 0x55;

	// 强制发：重放的意义就是「再喊一次」，被增量逻辑去重掉就白设了
	sendContent(CMD_SET_LED_EFFECT, payload, 0, true);

	// 重新进自定义通道后，设备里的逐键缓冲不可再信 —— 作废影子，下一帧整帧重发
	invalidateShadows();
}

/* 组装一个内置灯效的 16 字节 SET_LED_EFFECT 载荷 */
function buildEffectPayload(mode, rgb, brightness, speed, direction) {
	const payload = new Array(16).fill(0);
	payload[0] = mode & 0xFF;
	payload[1] = clampByte(rgb[0]);
	payload[2] = clampByte(rgb[1]);
	payload[3] = clampByte(rgb[2]);
	payload[4] = 0xFF;        // 驱动/软件控制标志
	payload[8] = 1;           // colorMode: RGB
	payload[9] = brightness;
	payload[10] = speed;
	payload[11] = direction || 0;
	payload[12] = 0;
	payload[14] = 0xAA;
	payload[15] = 0x55;
	return payload;
}

/* 用户选定的退出灯效 */
function exitEffectPayload() {
	const mode = exitEffectModes[String(ExitEffect)];
	return buildEffectPayload(
		(mode === undefined) ? 0x01 : mode,
		hexToRgb(ExitColor),
		clampLevel(ExitBrightness, 5),
		clampLevel(ExitSpeed, 5),
		0
	);
}

/**
 * 把键盘交还给它的内置灯效。
 *   Restore Original -> 写回接管前记录的灯效；读不到则用 ExitEffect
 *   Built-in Effect  -> 直接用 ExitEffect（忽略快照）
 *   Off              -> mode 0（关灯）
 *   Shutdown Color   -> 保持逐键通道，画成 shutdownColor
 */
function restoreLighting() {
	// 退出时一律整帧重发：这是「交还控制权」，不能因为内容和上一帧撞了就被增量逻辑吞掉
	invalidateShadows();

	const choice = String(ExitLighting);

	if (choice === "Shutdown Color") {
		pushFrame(true);
		return;
	}

	if (choice === "Off") {
		sendContent(CMD_SET_LED_EFFECT, buildEffectPayload(0x00, [0, 0, 0], 5, 5, 0), 0);
		return;
	}

	if (choice === "Restore Original" && savedEffect && !isNonRestorableMode(savedEffect[0])) {
		sendContent(CMD_SET_LED_EFFECT, savedEffect, 0);
		return;
	}

	sendContent(CMD_SET_LED_EFFECT, exitEffectPayload(), 0);
}

export function Initialize() {
	loggedFailure = false;
	restoreDone = false;
	wireless = detectLink();

	nextFrameAt = 0;
	nextReapplyAt = 0;
	sendFailures = 0;
	framesSent = 0;
	packetsSent = 0;
	statsWindowAt = 0;
	writeMsTotal = 0;
	writeCount = 0;
	invalidateShadows();

	device.log("X87 V2: LED " + ledSlots.length + " 颗，画布 " +
		layoutWidth + "×" + (layoutMatrix.length * SUB) + "（1 键 = " + SUB + " 格）");

	if (unmappedCodes.length) {
		device.log("X87 V2: 以下 layoutCode 没有槽位映射，已跳过: " + unmappedCodes.join(", "));
	}

	device.log("X87 V2: 链路 = " + (wireless ? "2.4G 接收器 (PID 0xFEF9)" : "有线 (PID 0x80BB)") +
		"，" + (wireless ? "2.4G 通道" : "有线写模式") + " = " +
		(wireless ? String(WirelessChannel) : String(WriteMode)) +
		"，自定义档 mode = " + String(DeviceMode));

	savedEffect = readOriginalEffect();
	enterCustomMode();
}

/* ------------------------------------------------------------------ *
 *  取色与载荷组装
 * ------------------------------------------------------------------ */
function ledColor(i, shutdown) {
	if (shutdown) return hexToRgb(shutdownColor);
	if (LightingMode === "Forced") return hexToRgb(forcedColor);
	return device.color(ledPositions[i][0], ledPositions[i][1]);
}

/* 512 字节 = 128 组 [槽位, R, G, B]。数组下标就是槽位，所以先把槽位字段铺满，
   再把每颗灯的颜色写到它自己的槽位上去。 */
function buildLedData(shutdown) {
	const data = new Array(LED_SLOTS * 4).fill(0);

	for (let slot = 0; slot < LED_SLOTS; slot++) {
		data[slot * 4] = slot;
	}

	for (let i = 0; i < ledSlots.length; i++) {
		const c = ledColor(i, shutdown);
		const base = ledSlots[i] * 4;
		data[base + 1] = clampByte(c[0]);
		data[base + 2] = clampByte(c[1]);
		data[base + 3] = clampByte(c[2]);
	}

	return data;
}

/* cmd 0x3C 备用通道：RGB565 大端流，数组下标即灯位 */
function buildColorStream(shutdown) {
	const count = ledSlots.length;
	const stream = new Array(count * 2).fill(0);

	for (let i = 0; i < count; i++) {
		const c = ledColor(i, shutdown);
		const v = ((clampByte(c[0]) & 0xF8) << 8) |
			((clampByte(c[1]) & 0xFC) << 3) |
			((clampByte(c[2]) & 0xF8) >> 3);
		stream[i * 2] = (v >> 8) & 0xFF;
		stream[i * 2 + 1] = v & 0xFF;
	}

	return stream;
}

/* cmd 0x35：每包固定 60 字节（末包补零），不设末包标志 */
function sendMusic53(stream, amplitude) {
	/* 这条通道没有地址字段，局部更新无从谈起，只能整帧比一次：内容没变就整个跳过。 */
	if (dirtyEnabled() && shadowStreamValid && shadowStream && shadowStream.length === stream.length) {
		let same = true;
		for (let i = 0; i < stream.length; i++) {
			if (stream[i] !== shadowStream[i]) { same = false; break; }
		}
		if (same) return;
	}

	const packets = Math.max(1, Math.ceil(stream.length / MUSIC53_PAYLOAD_MAX));
	const gap = packetGapMs(packets);
	let sent = 0;

	for (let k = 0; k < packets; k++) {
		const offset = k * MUSIC53_PAYLOAD_MAX;
		const end = Math.min(offset + MUSIC53_PAYLOAD_MAX, stream.length);
		const chunk = stream.slice(offset, end);
		while (chunk.length < MUSIC53_PAYLOAD_MAX) chunk.push(0);

		if (writeReport(buildMusic53Packet(k, amplitude, chunk))) {
			sent++;
			packetsSent++;
		}

		if (k < packets - 1 && gap > 0 && typeof device.pause === "function") {
			device.pause(gap);
		}
	}

	if (sent === packets) {
		shadowStream = stream.slice();
		shadowStreamValid = true;
	} else {
		shadowStreamValid = false;
	}
}

/* 2.4G 通道：默认走自定义区 cmd 0x24（与 hub 灯光页一致），另两条为对照备选 */
function wirelessChannel() {
	const s = String(WirelessChannel);
	if (s.indexOf("0x3C") !== -1) return 0x3C;
	if (s.indexOf("0x35") !== -1) return 0x35;
	return 0x24;
}

function pushFrame(shutdown) {
	const amplitude = clampAmplitude(Amplitude);

	if (!wireless) {
		if (String(WriteMode) === "Profile (0x24)") {
			sendContent(CMD_SET_CUSTOM_LED_DATA, buildLedData(shutdown), 0);
		} else {
			sendContent(CMD_GET_LED_DATA, buildLedData(shutdown), amplitude);
		}
		return;
	}

	const channel = wirelessChannel();
	if (channel === 0x3C) {
		sendContent(CMD_SET_MUSIC_DATA_24G_64B, buildColorStream(shutdown), amplitude);
	} else if (channel === 0x35) {
		sendMusic53(buildColorStream(shutdown), amplitude);
	} else {
		sendContent(CMD_SET_CUSTOM_LED_DATA, buildLedData(shutdown), 0);
	}
}

export function Render() {
	if (restoreDone) return;

	const now = Date.now();

	// 自己限帧。间隔从帧「首」起算，周期才是 max(帧耗时, 间隔)；从帧尾起算会变成
	// 「帧耗时 + 间隔」—— 设 60 实际只能拿到 20 出头，而且是静默少给。
	if (now < nextFrameAt) return;
	nextFrameAt = now + frameIntervalMs();

	// 定期重放「进自定义通道」，防止键盘自己切回内置灯效
	if (now >= nextReapplyAt) {
		enterCustomMode();

		let seconds = parseInt(ReapplySeconds, 10);
		if (!isFinite(seconds) || seconds < 0) seconds = 0;
		nextReapplyAt = (seconds === 0) ? Number.MAX_SAFE_INTEGER : (now + seconds * 1000);
	}

	pushFrame(false);
	logFrameStats(now);
}

export function Shutdown() {
	restoreDone = true;
	restoreLighting();
}

export function Validate(endpoint) {
	// 只要两条链路的灯光接口：有线 0xFF68/0x61、2.4G 0xFF60/0x61
	if (endpoint.usage !== USAGE_LIGHT) return false;
	return endpoint.usage_page === PAGE_WIRED || endpoint.usage_page === PAGE_DONGLE;
}
