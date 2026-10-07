# AGENTS.md

## Repo nature

**本仓库是**「风暴智校 —— 台风路径智能订正与预测」的可视化网页项目（参赛/参展作品）。

- `index.html` —— 单文件前端（约 600 KB / 10437 行，前端核心，唯一入口；**行尾固定 LF**，见下）
- `tile_proxy.py` —— 服务端常驻进程：静态文件 + 瓦片缓存/代理（:8899），含 gzip / HTTP-1.1 / single-flight
- `vendor/` —— 第三方前端库（Leaflet / topojson / msgpack / html2canvas）；2026-10-07 起已入库，
  在此之前只存在于服务器上，导致 `git clone` 后本地根本打不开页面
- `data/`（线上）/ `.dev/site/data/` —— 陆地掩膜数据（Natural Earth countries-50m.json）
- `wind_field/`（线上）—— 逐时风场 msgpack 风羽数据
- `mobile/` —— 手机端源码（CSS / 交互 / i18n / 二维码），由 `mobile/build.py` 内联进 `index.html`
- `typhoon_workflow/` —— WRF → 台风路径 → 风场 → 网页的流水线
- `legacy/` —— **已隔离的死脚本**：`gen_tail.py`（旧口径 wind 生成器，重跑会把
  `fix_track_wind.py` 修好的 wind 一列打回原形）、`inspect_wrf.py`、根目录那份 `process_wind.py`、
  `typhoon_track.json`（193 点、修复前数据）。动它们之前先读 `legacy/README.md`
- `wind_wrfout_d02_*` —— WRF 原始输出（约 241 MiB，已 gitignore）。2026-10-07 删掉了重名副本
  `…_00%3A00%3A00`（浏览器下载留下的 URL 编码名，与正本 MD5 完全相同）
- `合规整改记录.md` / `天地图操作方法.md` —— **地图合规的权威说明，改底图前必读**

## ⚠️ 地图合规硬约束（改前端前必读）

这些是**已经踩过坑并修好**的合规要求，改动前必须知道：

1. **底图只允许两种**：天地图（行政，自带审图号 `GS（2026）4921号`）与 Esri 卫星影像（纯影像）。
2. **不要恢复 OSM / OpenTopoMap**：其瓦片把藏南标为 `Arunachal Pradesh`、国界沿麦克马洪线、
   台湾按独立国家要素表示、无十段线，违反《公开地图内容表示规范》五（三）/七（一）/八（一）/十。
3. **不要恢复高德直连瓦片**：违反《高德地图开放平台服务协议》3.5，且官网不公开固定审图号、
   无法按《地图审核管理规定》第 27 条依法标注。
4. **不要恢复自绘国界/省界层**：豁免前提是「未对国界、行政区域界线进行编辑调整」
   （《地图审核管理规定》第十条），一旦叠加即豁免失效、须重新送审。
5. **`buildLandMask()` 必须保留**：风场渲染与航线避让依赖它算陆地掩膜；它只产出内部栅格、不画线。
6. **审图号必须标注**：地图**左下角**角标（第 27 条要求左下角）+ Leaflet 署名。审图号变更时同步 `TDT_APPROVAL`。
7. **坐标系**：数据一律 WGS-84；仅在交给 Leaflet 绘制时经 `patchDisplayCRS()` 转 GCJ-02
   （天地图瓦片坐标系）。**不要改数据本身的坐标系**，也不要给 `L.latLng` 加转换
   （会二次偏移并破坏风场画布的仿射变换）。
8. **天地图 Key 不进版本库**：`index.html` 的 `TDT_KEY` 留空；线上由服务端 `tile_proxy.py` 持有。
   回源天地图**必须用浏览器 UA**（自定义 UA / 无 UA 会被其 WAF 403，表现为瓦片全 404）。

细节与依据见 [合规整改记录.md](合规整改记录.md) 与 [天地图操作方法.md](天地图操作方法.md)。

## 本仓库确实有的东西（别再说"没有"）

- `mobile/` 下有测试：`test-qr.mjs` / `selftest-css.mjs` / `test-i18n.mjs`，以及 `build.py --check`
- `.dev/` 下有校验与回归脚本。**2026-10-07 起「契约级」脚本已入库**（`.gitignore` 由 `.dev/`
  改为 `.dev/*` + 逐条 `!` 白名单）：`check-syntax.mjs` / `check-dict.mjs` / `check-gcj.mjs` /
  `check-tileproxy-deny.py` / `check-tileproxy-perf.py` / `verify-live-hardening.py` /
  `page-check.mjs`（真实 Chrome + CDP 的无头验证台，零依赖）/ `verify-*.mjs` /
  `touch-test.mjs` / `mouse-test.mjs` / `jig-proxy.py` / `gen-i18n-dict.mjs`。
  其余探针、截图、历史副本与 `.dev/site/` 站点快照仍是本地文件、不入库
- **是 git 仓库**（`origin` = `https://github.com/mango12q/SmartOceanProject.git`）
- 没有 `package.json` / CI / lint 配置；`node_modules/` 已 gitignore

## 验证命令（改动后至少跑这些，全部 exit 0）

```bash
node .dev/check-syntax.mjs index.html     # 内联脚本语法
node .dev/check-dict.mjs                  # 内嵌 i18n 词表是否为合法 JS
node .dev/check-gcj.mjs index.html        # WGS-84→GCJ-02（基准取自 eviltransform 官方夹具）
node mobile/test-qr.mjs && node mobile/selftest-css.mjs && node mobile/test-i18n.mjs
python mobile/build.py --check            # index.html 是否与 mobile/ 源码同步
python .dev/check-tileproxy-deny.py       # 静态黑名单：%2e 绕过必须 404、目录列表必须关闭
python .dev/check-tileproxy-perf.py       # gzip / HTTP-1.1 / 304 / single-flight / 唯一 tmp
node   .dev/check-md-reload.mjs <url>     # 断点回退自救：加载期抖动不重载、真实旋转才重载
```

动了 `index.html` 的界面行为之后，还要跑真机无头验证（用本机 Chrome，`.dev/page-check.mjs`
零依赖、走 CDP 注入探针，会报 console 报错与坏资源）：

```bash
node .dev/page-check.mjs --url http://127.0.0.1:8123/index.html --devices 390x844,768x1024,1440x900
```

> `--wait` 现在的含义是「就绪之后的稳定期」（默认 1500ms）：测试台会先轮询
> `window.__mainReady` 再注入探针。这一点很要紧 —— 线上走公网要 **约 5.3 秒**才就绪
> （本地 0.44 秒），原先固定睡 3500ms 会偶发「mobile-ui=true 但 dock=none」的假故障
> （同一命令连跑 5 次出现 1 次）。

线上部署之后跑线上验收（只读 GET，同时断言「绕过硬封死」「资产没被误伤」「性能生效」）：

```bash
python .dev/verify-live-hardening.py
```

改 `mobile/` 下的东西后**必须**跑 `python mobile/build.py` 重新内联；
`mobile/i18n-dict.js` 的对象字面量必须是**纯数据**（混注释会让 i18n 静默失效）。

**行尾契约（2026-10-07 起）**：`.gitattributes` 用 `index.html -text` 关掉了行尾转换，
仓库与工作区**都是 LF**；`mobile/build.py` 的出口也强制归一到 LF，`slurp()` 会把 mobile/
源码的 CRLF 一并归一化。因此 `--check` 在**全新 clone 上也能通过** —— 在这之前
`core.autocrlf=true` 会把它 checkout 成整份 CRLF（实测 10364 行全 CRLF），
clone 后 `--check` 必然 exit 1。若某工具还是把文件改成了 CRLF，跑一次
`python mobile/build.py` 即回到 LF。

## Remote server context

用户维护一台远程 Ubuntu 服务器 `haike@43.154.210.202`，已配置免密 SSH。
站点目录 `/home/haike/test_web/`，由 `tile_proxy.py` 在 **:8899** 提供服务（公网可访问）。

**脚本实体在站点目录之外**（2026-10-07 起）：`/home/haike/tile_proxy.py`（`chmod 600`，含明文 Key）。
**绝不要把带 Key 的 `tile_proxy.py` 放回 `~/test_web/`** —— 「Key 不进 web 根」比任何黑名单都靠前。
历史教训：2026-09-30 17:11 起的旧进程没有静态黑名单，`/data/convert_simplify.py`、
`index.html.bak-*` 一度都能匿名下载（22:17 重启后已 404）。`~/test_web/` 里现在也没有这个文件。

```bash
# 上传
scp -o StrictHostKeyChecking=no <local_file> haike@43.154.210.202:/home/haike/test_web/

# 重启瓦片代理（无 systemd 单元，手工 nohup；脚本在 web 根之外，cwd 仍取站点目录）
# -u = 不缓冲；不加则 stdout/stderr 是块缓冲，访问日志要攒到 4-8KB 才落盘
# ⚠ 不要照抄单行 `kill $(ss -lntp | grep ":8899" | grep -oP "pid=\K[0-9]+" | head -1)`：
#   2026-10-07 实测那条命令的 PID 提取在服务器上取不到值（kill 只报 usage），
#   新进程随即因 "Address already in use" 退出 —— 于是**补丁静默没生效**，
#   而端口看起来仍在监听（旧进程还在）。改成先本地解析 PID、再传字面量：
#     ssh haike@43.154.210.202 "ss -lntp | grep ':8899'"        # 本地读出 pid=NNN
#     ssh haike@43.154.210.202 "kill NNN"; sleep 2
#     ssh haike@43.154.210.202 "cd /home/haike/test_web && nohup python3 -u /home/haike/tile_proxy.py > /tmp/tile_proxy.log 2>&1 &"
#   重启后必须确认：PID 变了、`head -2 /tmp/tile_proxy.log` 有 `tdt_key=set`（Key 没丢）。
```

- **静态黑名单**：`/tile_proxy.py`、`/*.bak`、`/*.log`、`/data/*.py`、`*.pyc` 等一律 404，
  正则含 `py|pyc|pyo|sh|log|swp|tmp|bak|conf|ini|env`。**2026-10-07 修掉一个绕过**：
  `do_GET` 原先拿 `urlparse().path` 的 basename 去匹配（不解码），而匹配失败后
  `translate_path()` **会**解码 —— 实测 `/data/convert_simplify%2epy` 因此 200 返回源码全文
  （`%2E` 大小写都行，`index.html%2ebak` 同理）。现在**先 unquote 再匹配**；
  同时 `list_directory()` 覆写为 404（`/data/`、`/tiles/`、`/vendor/`、`/wind_field/`
  曾能匿名列目录，等于把「站内有哪些 .py/.bak」的清单直接递给攻击者）。
  回归见 `.dev/check-tileproxy-deny.py`（本地）与 `.dev/verify-live-hardening.py`（线上）
- 页面资产不受影响：`/`、`/tiles/tdt/…`、`/tiles/satellite/…`、`/data/countries-50m.json`、
  `/vendor/*`、`/wind_field/*.bin` 均 200。**取备份 / 脚本改走 scp / sftp**（SSH 不受黑名单约束）
- **脚本落到服务器上要「原地打补丁」**：本地 `tile_proxy.py` 的 `TDT_KEY` 是空串，
  直接 scp 覆盖会抹掉 Key、天地图瓦片整片 404。做法是 scp 到 `…/tile_proxy.py.new`，
  再用脚本从**服务器现有文件**读出 Key 行、填回、校验指纹一致后再 `os.replace`
  （`chmod 600` 全程保持）
- `sudo` 需要密码，**代理不可用**；凡需 root 的操作（如装 systemd 单元）交给用户执行
- 改服务器上 `tile_proxy.py` 的 `TDT_KEY` 时，用脚本从**服务器现有文件**里读出旧值再填回，
  不要把 Key 复制到本地或写进任何受版本控制的文件
- 非 ASCII 内容写远程文件时，用 base64 或 `python3` 脚本落盘，避免编码问题

## Git workflow

- **不要自动 push**，也不要自动打标签 —— 两者都必须等用户明确要求
- 提交可以自动做（用户要求"干完就提交"时），但 push / tag / 部署一律等指令
- 提交信息用中文（与既有提交风格一致），说清"改了什么 + 为什么 + 怎么验证的"
- 标签用**附注标签**（`git tag -a`），消息风格参照 `v1.0` – `v1.4`

## User preferences

- **Do NOT auto-push to GitHub** after commits. Wait for explicit user request.
- **Do NOT auto-deploy** to the remote server. Wait for explicit user request.
- **Do NOT auto-tag.** Tags only when the user explicitly asks.
- 用户不需要被反复确认显而易见的事；但**部署、push、打标签**这三件事必须先问
- 已知未闭环事项（机场军民合用属性、systemd 自启、"非实时预报"声明位置）
  见 合规整改记录.md，不要擅自"顺手修掉"
