# 前行者 (EWEADN) X87 V2 — SignalRGB 插件

把 X87 V2 接到 SignalRGB 的画布上做逐键灯光，有线 / 2.4G 两条链路都支持。
87 颗灯逐键可控，只发画面真正变化的包，退出时交还灯光（不会僵在最后一帧）。
协议逆向自官方 WebHID Hub，没抓过 USB 包。

## 支持的设备

| 链路 | VID | PID | 灯光接口 |
|---|---|---|---|
| 有线 | `0x0C45` | `0x80BB` | `usage_page 0xFF68`, `usage 0x61` |
| 2.4G 接收器 | `0x0C45` | `0xFEF9` | `usage_page 0xFF60`, `usage 0x61` |

两条链路是同一把键盘，键位与槽位完全一致，插件同时声明两个 PID，运行时按 `device.productId()` 判断。
**线和接收器同时插着时**，SignalRGB 会当成两个独立设备各渲染一遍 —— 请在设备列表里把不用的那条禁用掉。

## 安装

把 `EWEADN X87 V2.js` 复制到 `%USERPROFILE%\Documents\WhirlwindFX\Plugins\`
（也可以在 SignalRGB 里 **设置 → 插件 → 打开插件文件夹**），重启 SignalRGB，然后把它拖到画布上。

## 设置

**灯光**

| 设置 | 说明 |
|---|---|
| Lighting Mode | `Canvas` 跟随画布；`Forced` 整把键盘固定成一个颜色 |
| Forced Color | `Forced` 模式下的颜色 |
| Shutdown Color | 「退出灯效」选 `Shutdown Color` 时收尾用的颜色 |

**退出时**

| 设置 | 说明 |
|---|---|
| Hand Back To Keyboard | `Restore Original` 写回接管前的原灯效（读不到就退回内置）；`Built-in Effect` 直接切内置灯效；`Off` 关灯；`Shutdown Color` 涂成收尾色 |
| Exit Effect / Color / Brightness / Speed | 交还时用的内置灯效，共 20 种（常亮、呼吸、光谱、波浪……）及参数 |

**设备** —— 正常使用不用动，出问题才改

| 设置 | 默认 | 说明 |
|---|---|---|
| Frame Rate Limit (fps) | `20` | 插件自己限帧。2.4G 接收器吃不下 60fps × 10 个包，调高会开始丢包 |
| Send Only Changed Data | `On` | 只发变化的包；切 `Off` 则每帧整发，个别固件不认局部更新时用 |
| Reapply Mode Every (s) | `15` | 定期重发「进自定义通道」，防止键盘自己切回内置灯效；`0` = 关闭 |

其余几项（Device Lighting Mode / Brightness / Wired Write Mode / 2.4G Channel / Music Amplitude）
只在不同固件版本上排查时才有意义。

## 排查

- **灯只亮一小片 / 卡顿 / 闪** —— 把 Frame Rate Limit 降到 10–15。日志里 `包 X.X/帧` 稳态下应远小于 10。
- **退出后键盘不回原样** —— SignalRGB 只有 `Shutdown()` 一个退出钩子，**强杀进程**时不会被调用。想要保险就把 Hand Back To Keyboard 设成 `Built-in Effect`。
- **日志写「原灯效读取无应答」** —— 正常。这块键盘没有 feature report，读不回原灯效就直接用你选的内置灯效收尾。
- **调了颜色没反应** —— 先用 `Forced` 模式确认链路通不通。

## 测试

```bash
node tools/verify-layout.mjs      # 键位表、槽位唯一性、坐标范围、与真机对照表比对
node tools/verify-dirty-send.mjs  # 增量发送：首帧全量、静止帧零包、单键变更只发 2 包
```

两个脚本都在 Node 里直接加载插件本体、用桩替换掉 `device`，**不需要键盘，也不需要启动 SignalRGB**。
改完插件跑一遍，都应该是 `全部通过 ✓`。

## 备注

- **槽位不是「行 × 21 + 列」。** F 排前 13 个（Esc、F1..F12）碰巧等于 0..12，所以「给全部 128 槽涂同一个颜色」的测试完全掩盖了这个错误。真实槽位表在插件里，已在真机上逐槽点亮验证过。
- **画布坐标必须是整数，而且网格要比一个键更细。** 厂商键间距是 `0.525 / 0.33 / 1.1` 这类小数，一键一格时 SignalRGB 取整会让同一个 1.525 时而占 2 格时而占 1 格。插件用「一键宽 = 4 格」的整数网格。

## 致谢与免责

协议逆向自前行者官方 WebHID Hub 与其打包的华奋达键盘 SDK。本插件与前行者（EWEADN）、
华奋达、WhirlwindFX 均无关联，非官方作品。使用后果自负。MIT License。
