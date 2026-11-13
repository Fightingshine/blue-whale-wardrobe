# 网页直传投稿接口（Cloudflare Workers）

本目录提供「大肥鱼衣橱」网页内免跳转直接投稿的轻量接收接口，运行在 **Cloudflare Workers 免费版**：

- 校验 `Origin`、单 IP 频控（`[[ratelimits]]` 限流绑定，默认每 60 秒最多 3 次提交）与请求体积（`<= 12 MiB`）
- 验证 **Cloudflare Turnstile** 人机校验 token 与授权站点域名
- 复用仓库 [`../src/domain.js`](../src/domain.js) 在服务端强校验 `PNG / JPG / WebP` 文件头、像素尺寸、SHA-256 与必填字段
- 通过 V8 原生 `Uint8Array.toBase64()` 将原图写入独立非保护分支 `submissions/`，并用精确 Commit SHA 生成不可变 `raw.githubusercontent.com` 图片直链，自动创建带 `皮肤投稿` 标签的投稿 Issue

---

## 部署步骤

### 1. 生成最小权限 GitHub Fine-grained Token

前往 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**：

1. **Repository access** 选择 **Only select repositories**，仅勾选 `Fightingshine/blue-whale-wardrobe`。
2. **Permissions → Repository permissions**：
   - **Contents**：`Read and write`（用于写入 `submissions` 暂存分支原图）
   - **Issues**：`Read and write`（用于自动创建带 `皮肤投稿` 标签的投稿 Issue）
   - **Metadata**：默认 `Read-only`
3. 复制生成的 Token（切勿写进任何代码文件）。

### 2. 创建免费 Cloudflare Turnstile 小部件

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Turnstile** → **Add widget**。
2. 在 **Hostname Management** 添加：
   - `blue-chubby-whale.cyou` 与 `www.blue-chubby-whale.cyou`（以及兼容过渡期 `fightingshine.github.io`）
   - 本地联调如有需要可临时加 `127.0.0.1` 和 `localhost`
3. Widget Mode 选择 **Managed**（托管无感/一键验证），创建后记录：
   - **Site Key**（公开可用，供前端渲染组件）
   - **Secret Key**（私密，仅存入 Worker Secret）

### 3. 登录并部署 Cloudflare Worker

在仓库的 `worker/` 目录下执行（PowerShell）：

```powershell
cd worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler deploy
```

部署完成后终端会打印公网访问地址，例如：`https://blue-whale-wardrobe-submit.<你的子域>.workers.dev`；如需免代理国内直连访问，推荐在 Cloudflare Worker **设置 → 域和路由 → 添加自定义域** 绑定自有域名（如 `https://submit.blue-chubby-whale.cyou`），随后访问 `<地址>/health` 验证返回 `{"ok":true}`。

> **提示**：如部署到自己的子域或复用至其他 GitHub 仓库，请同步修改 [`wrangler.toml`](wrangler.toml) 中的 `GITHUB_REPOSITORY`、`ALLOWED_ORIGINS` 与 `TURNSTILE_ALLOWED_HOSTS` 后重新执行 `npx wrangler deploy`。

### 4. 在 GitHub 仓库开启网页直传模式

打开 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables（注意是 Variables，不是 Secrets）**，新建两个公开变量：

- `VITE_SUBMIT_API_URL`：填写上一步配置的 Worker 自定义域或 `workers.dev` 地址（例如 `https://submit.blue-chubby-whale.cyou`，末尾不带斜杠）
- `VITE_TURNSTILE_SITE_KEY`：填写 Turnstile 的 **Site Key**

保存后，触发一次 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) 构建，网页端即自动切换为「完成人机验证后直接提交投稿」，同时保留「GitHub 手动投稿」作为备用通道。
