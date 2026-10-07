# legacy/ —— 已隔离的根目录死脚本

本目录存放一批**已确认零引用**的历史脚本，用 `git mv` 从仓库根目录移入（保留完整 git 历史）。
隔离目的是：让它们不再出现在仓库根目录，也不会被误当成流水线的一部分运行。

## 目录内容

| 文件 | 原位置 | 性质 |
|---|---|---|
| `gen_tail.py` | 仓库根 | **修复前**口径的轨迹生成器（危险，见下节） |
| `typhoon_track.json` | 仓库根 | `gen_tail.py` 的产物（193 点） |
| `inspect_wrf.py` | 仓库根 | 一次性 WRF 变量探查脚本（打印 dims / data_vars） |
| `process_wind.py` | 仓库根 | 硬编码服务器路径的风场批处理脚本（无 `--config`，直接写线上目录） |

它们都没有被任何脚本 import 或调用：`run_pipeline.py` / `selftest.py` 里 import 的
`process_wind` 是 `typhoon_workflow/process_wind.py`（同名但不同文件，仍在原位）。
仓库内仅存的文字性提及是 README 里的历史说明，不构成依赖。

## ⚠️ 不要直接运行 gen_tail.py

`gen_tail.py` 是**修复前**口径的旧轨迹生成器，重跑会破坏现有正确数据：

1. **wind 口径错误（致命）**。它取 `wind = hypot(U10[i,j], V10[i,j])`，其中 `(i,j)` 是
   **离台风中心最近的那一个格点** —— 也就是台风眼内的静风值，而不是
   `typhoon_workflow/README.md` §2 约定的「中心 10m **最大**风速」。
   这个错误口径已被 `typhoon_workflow/fix_track_wind.py` 修正为「中心半径 R km 内最大风速」。
   **重跑 `gen_tail.py` 会把刚修好的 `track[].wind` 一列打回原形**，
   前端据此会把超强台风显示成热带低压。
2. **硬编码服务器绝对路径**，还会直接覆盖产物：
   `WRF_FILE = "/home/haike/test_web/wind_wrfout_d02_2025-09-15_000000"`，
   另有一段手抄进源码的 `EXISTING` 轨迹表（t=105~233）。
3. 它把结果 print 成一行 JSON（供当年手工贴进 `index.html`），**不是**当前流水线的产物：
   字段虽同为 `t/lat/lon/psfc/wind`，但口径、时次范围、点数都与正式产物不一致。

口径差异的实测对照（当前仓库内两份文件的实际值）：

| 产物 | 点数 | `wind` 前三点 |
|---|---|---|
| `legacy/typhoon_track.json`（旧口径，**不要用**） | 193 | 11.6 / 8.9 / 11.2 |
| `typhoon_workflow/out/桦加沙/track.json`（正式产物，正确） | 115 | 49.8 / 42.5 / 43.4 |

同名的 `legacy/process_wind.py` 也一样：它把 `OUT_DIR` 写死为
`/home/haike/test_web/wind_field`，**在服务器上跑会直接覆盖线上风场 bin**。
要生成风场请用 `typhoon_workflow/process_wind.py`（带 `--config/--name/--out`）。

## 正式产物在哪里

- **轨迹**：`typhoon_workflow/out/<台风名>/track.json`（附 `track_meta.json`）
  - 当前唯一在用的一份：`typhoon_workflow/out/桦加沙/track.json`（115 点）
- **风场**：`typhoon_workflow/out/<台风名>/wind_field_orig/`（原场）与
  `wind_field_corr/`（订正场），逐时 `wind_field_XXXX.bin`
- **流水线入口**：`typhoon_workflow/run_pipeline.py`；说明见 `typhoon_workflow/README.md`
- **只重算 wind 一列**：`typhoon_workflow/fix_track_wind.py`（半径内最大风速口径）
- **注册表 / 网页内嵌**：`typhoon_workflow/build_registry.py --patch-index ../index.html`

根目录的 `typhoon_track.json`（现 `legacy/typhoon_track.json`）与
`typhoon_workflow/out/桦加沙/track.json` **不是同一份产物，不要互相替代**。

## 需要恢复或查历史时

文件没有被删除，只是移动了位置，全部可用 git 找回：

```bash
git log --follow -- legacy/gen_tail.py     # 看这个文件的完整历史（跨重命名）
git show HEAD:gen_tail.py                  # 看移动前根目录版本的内容
git mv legacy/gen_tail.py gen_tail.py      # 真要移回根目录
```

行尾注意：本仓库 `.py` / `.md` 本地是 CRLF、git 里是 LF（`core.autocrlf=true`）。
移动或恢复这些文件时**不要顺手统一行尾**，否则会产生整文件级别的伪 diff。
