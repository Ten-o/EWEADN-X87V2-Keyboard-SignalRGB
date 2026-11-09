# 前行者 (EWEADN) X87 V2 键盘 — SignalRGB 插件

把 X87 V2 键盘接到 SignalRGB 的画布上做逐键灯光，有线 / 2.4G 两条链路都支持。
87 颗灯逐键可控，静止画面跳过发送，画面变化时按顺序发送完整帧，正常退出时尝试交还灯光。
协议逆向自官方 WebHID Hub，没抓过 USB 包。

## 支持的设备

| 链路 | VID | PID | 灯光接口 |
|---|---|---|---|
| 有线 | `0x0C45` | `0x80BB` | `usage_page 0xFF68`, `usage 0x61` |
| 2.4G 接收器 | `0x0C45` | `0xFEF9` | `usage_page 0xFF60`, `usage 0x61` |

两条链路是同一把键盘，键位与槽位完全一致，插件同时声明两个 PID，运行时按 `device.productId()` 判断。
**线和接收器同时插着时**，SignalRGB 会当成两个独立设备各渲染一遍 —— 请在设备列表里把不用的那条禁用掉。

## 安装

[![Add To SignalRGB](https://marketplace.signalrgb.com/resources/add-extension-256.png "Add to My SignalRGB Installation")](signalrgb://addon/install?url=https://github.com/Ten-o/EWEADN-X87V2-Keyboard-SignalRGB)

点击按钮，在弹出的窗口里确认即可。也可以按 `Win + R`，粘贴：

```
signalrgb://addon/install?url=https://github.com/Ten-o/EWEADN-X87V2-Keyboard-SignalRGB
```

**手动安装：** 在 SignalRGB 里 **设置 → 插件 → 打开插件文件夹**，把 `EWEADN X87 V2.js` 复制进去。
通常是 `%USERPROFILE%\Documents\WhirlwindFX\Plugins\`，重定向过文档目录的电脑会使用其他路径。重启 SignalRGB，
键盘会出现在设备列表里，把它拖到画布上即可。

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
| Frame Rate Limit (fps) | `10` | 2.4G 和有线 `Profile (0x24)` 最多 10fps；有线 `Realtime (0x32)` 最多 20fps。旧版保存的 60fps 也受限制 |
| Skip Unchanged Frames | `On` | 静止时不发包；画面变化时发送完整帧。`Off (Full Frame)` 每帧都发，不再跳过中间分包 |
| Reapply Mode Every (s) | `0` | 默认关闭周期性模式重写；调整亮度、模式或通道时仍会更新。非零值仅用于排查键盘自行退出自定义通道 |
| Wired Write Mode | `Profile (0x24)` | 默认使用原厂自定义灯光命令；`Realtime (0x32)` 保留作对照，持续使用的固件兼容性需要实机验证 |

其余几项（Device Lighting Mode / Brightness / 2.4G Channel / Music Amplitude）
只在不同固件版本上排查时才有意义。

**从旧版升级**：SignalRGB 可能保留旧参数，请手动设置 `Reapply Mode Every = 0`、
`Frame Rate Limit = 10`、`Skip Unchanged Frames = On`；有线使用 `Profile (0x24)`，
2.4G 使用 `Custom Area (0x24 / 36)`。默认值变化不会自动清除已保存的设置。

插件对有线保留至少 5ms、2.4G 至少 8ms 的包间静默，切换模式后等待 30ms。
这些间隔是保守的排查设置，不能替代设备应答。写入返回 65 字节也仅说明主机完成写入，
不代表键盘固件已处理成功。

## 排查

- **灯光卡死，原厂软件也调不了** —— 先从托盘正常退出 SignalRGB，再单独打开原厂软件，避免两个程序同时写灯光。仍不恢复时，拔掉 USB、关闭键盘电源，再重新连接；如果有线和接收器都插着，先只保留当前使用的链路。确认恢复后再按升级设置试用修复版。
- **灯只亮一小片 / 卡顿 / 闪** —— 把 Frame Rate Limit 降到 5–10。有变化的自定义帧固定 10 包，静止画面才是零包。
- **日志写「发送失败」** —— 插件会中止该帧，等待 1 秒、2 秒后重试；连续三次失败停止发送。请保留包含 `cmd`、`addr`、`write` 或异常码的日志。恢复连接后禁用再启用设备，或重启 SignalRGB。
- **退出后键盘不回原样** —— **强杀进程**不会调用 `Shutdown()`。正常退出会尝试还原；已卡死的固件也可能不响应还原命令。`Built-in Effect` 仅选择还原内容，不能保证故障时一定成功。
- **日志写「原灯效读取无应答」** —— 输入报告在插件中可能不可读或已被宿主读取；没有 feature report 本身不代表没有输入报告。读不回时用选定的内置灯效收尾。
- **调了颜色没反应** —— 先用 `Forced` 模式确认链路通不通。

## 测试

```bash
node tools/verify-layout.mjs      # 键位表、槽位唯一性、坐标范围、与真机对照表比对
node tools/verify-dirty-send.mjs  # 整帧去重：首帧全量、静止帧零包、单键变更完整 10 包
node tools/verify-transport.mjs   # 分包顺序、包间静默、短写/异常中止、失败退避和退出恢复
```

三个脚本都在 Node 里加载插件本体、用桩替换掉 `device`，**不需要键盘，也不需要启动 SignalRGB**。
改完插件跑一遍，都应该是 `全部通过 ✓`。
这些测试验证发送逻辑，不能证明实机固件不会卡死；还需要在实际连接方式下验证动态灯效和退出后的原厂控制。

## 备注

- **槽位不是「行 × 21 + 列」。** F 排前 13 个（Esc、F1..F12）碰巧等于 0..12，所以「给全部 128 槽涂同一个颜色」的测试完全掩盖了这个错误。真实槽位表在插件里，已在真机上逐槽点亮验证过。
- **画布坐标必须是整数，而且网格要比一个键更细。** 厂商键间距是 `0.525 / 0.33 / 1.1` 这类小数，一键一格时 SignalRGB 取整会让同一个 1.525 时而占 2 格时而占 1 格。插件用「一键宽 = 4 格」的整数网格。

## 致谢与免责

协议逆向自前行者官方 WebHID Hub 与其打包的华奋达键盘 SDK。本插件与前行者（EWEADN）、
华奋达、WhirlwindFX 均无关联，非官方作品。使用后果自负。MIT License。
