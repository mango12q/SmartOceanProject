# AGENTS.md

## Repo nature

**本仓库是**「风暴智校 —— 台风路径智能订正与预测」的可视化网页项目（参赛/参展作品）。

- `index.html` —— 单文件前端（约 560 KB，前端核心，唯一入口）
- `tile_proxy.py` —— 服务端常驻进程：静态文件 + 瓦片缓存/代理（:8899）
- `data/`（线上）/ `.dev/site/data/` —— 陆地掩膜数据（Natural Earth countries-50m.json）
- `wind_field/`（线上）—— 逐时风场 msgpack 风羽数据
- `mobile/` —— 手机端源码（CSS / 交互 / i18n / 二维码），由 `mobile/build.py` 内联进 `index.html`
- `typhoon_workflow/` —— WRF → 台风路径 → 风场 → 网页的流水线
- `wind_wrfout_d02_*` —— WRF 原始输出（约 253 MB，已 gitignore）
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
- `.dev/` 下有校验与回归脚本：`check-syntax.mjs` / `check-dict.mjs` / `check-gcj.mjs` /
  `jig-proxy.py` / `verify-page.mjs`，以及大量历史界面回归脚本
- **是 git 仓库**（`origin` = `https://github.com/mango12q/SmartOceanProject.git`）
- 没有 `package.json` / CI / lint 配置；`.dev/` 与 `node_modules/` 已 gitignore

## 验证命令（改动后至少跑这些，全部 exit 0）

```bash
node .dev/check-syntax.mjs index.html     # 内联脚本语法
node .dev/check-dict.mjs                  # 内嵌 i18n 词表是否为合法 JS
node .dev/check-gcj.mjs index.html        # WGS-84→GCJ-02（基准取自 eviltransform 官方夹具）
node mobile/test-qr.mjs && node mobile/selftest-css.mjs && node mobile/test-i18n.mjs
python mobile/build.py --check            # index.html 是否与 mobile/ 源码同步
```

改 `mobile/` 下的东西后**必须**跑 `python mobile/build.py` 重新内联；
`mobile/i18n-dict.js` 的对象字面量必须是**纯数据**（混注释会让 i18n 静默失效）。

**改 `index.html` 之后也要跑一次 `python mobile/build.py`**：CSS 内联块按约定是 LF，
而多数编辑器 / 补丁工具会把整份文件统一成 CRLF —— 于是 `build.py --check` 报「不同步」
（内容其实没变）。跑一次 build 即归一化行尾，之后 `--check` 应回到 exit 0。

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
ssh haike@43.154.210.202 'kill $(ss -lntp | grep ":8899" | grep -oP "pid=\K[0-9]+" | head -1); cd ~/test_web && nohup python3 -u /home/haike/tile_proxy.py > /tmp/tile_proxy.log 2>&1 &'
```

- **静态黑名单已生效**（2026-10-07 22:17 重启加载）：`/tile_proxy.py`、`/*.bak`、`/*.log`、
  `/data/*.py`、`*.pyc` 等一律 404。正则含 `py|pyc|pyo|sh|log|swp|tmp|bak|conf|ini|env`。
  实测页面资产不受影响：`/`、`/tiles/tdt/…`、`/tiles/satellite/…`、`/data/countries-50m.json`、
  `/wind_field/*.bin` 仍 200。**取备份 / 脚本改走 scp / sftp**（SSH 不受该黑名单约束）
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
