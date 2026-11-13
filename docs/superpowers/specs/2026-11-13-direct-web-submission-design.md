# 大肥鱼衣橱：网页直传投稿设计方案

## 1. 背景与目标

目前「大肥鱼衣橱」托管在 GitHub Pages 纯静态环境中，同学在网页填写投稿资料后，仍需跳转 GitHub 页面手动拖拽上传原图并发布 Issue。对于不熟悉 GitHub 或没有 GitHub 账号的同学存在一定操作门槛。

本次改造的目标是：**在保留现有纯静态前端与 `已收录` 标签自动同步上线流程的前提下，接入 Cloudflare Workers 免费版 + Cloudflare Turnstile，实现“网页内选图填表后一键直接提交投稿、无需跳转 GitHub、无需登录 GitHub 账号”。**

---

## 2. 总体架构与未审图片存储决策

### 2.1 存储方案选型：`submissions` 独立暂存分支

Worker 收到网页直传的投稿原图后，通过 GitHub REST API 将原图写入当前仓库的一个**独立非保护暂存分支 `submissions`**（不写入受保护的 `main` 分支，也不使用需要额外绑卡开通的 Cloudflare R2）：

1. 若仓库尚无 `submissions` 分支，Worker 自动基于空目录树创建一次孤立初始提交与 `refs/heads/submissions` 引用（仅发生一次，不把 `main` 源代码带入暂存分支）。
2. Worker 将校验合格的原图写入 `submissions/<YYYYMM>/<timestamp>-<sha8>/reference.<ext>`，拿回返回的 `commit.sha`。
3. 使用精确 Commit SHA 构造不可变图片直链：`https://raw.githubusercontent.com/<owner>/<repo>/<commit-sha>/<path>`。
4. `raw.githubusercontent.com` 已经包含在现有 `scripts/sync-approved-issues.mjs` 的 `ALLOWED_IMAGE_HOSTS` 白名单中，维护者审核后只需按既有习惯给对应 Issue 打上 `已收录` 标签即可全自动同步到图鉴，完全不污染 `main` 分支历史。

### 2.2 双通道优雅兼容

- 站点支持配置 `submitApiUrl` 与 `turnstileSiteKey`（通过 Vite 构建变量 `VITE_SUBMIT_API_URL` / `VITE_TURNSTILE_SITE_KEY` 或 `src/site.js` 默认值注入）。
- **已配置直传端点时**：投稿弹窗内渲染 Turnstile 人机验证组件，主按钮为「**直接提交投稿**」；提交成功后弹窗内直接显示回执卡（含投稿皮肤名称、生成的 GitHub Issue 编号及可点击查看链接），全程不跳转。同时保留次要链接/按钮作为备用通道，确保网络异常或手动投稿场景仍可顺畅使用。
- **未配置直传端点时**：自动退回现有的「**去 GitHub 附图投稿**」流程，不出现残缺控件或报错。

---

## 3. 组件设计与数据流

### 3.1 前端改造（`src/site.js`、`src/domain.js`、`src/App.jsx`、`src/styles.css`）

1. **配置读取（`src/site.js`）**
   - `SITE` 暴露 `submitApiUrl` 与 `turnstileSiteKey`（默认优先读取 `import.meta.env.VITE_SUBMIT_API_URL` 和 `import.meta.env.VITE_TURNSTILE_SITE_KEY`，未配置时为空字符串，且新增 `directSubmitEnabled` 判定辅助）。
2. **领域辅助扩展（`src/domain.js`）**
   - `submissionMarkdown(data, options)` 支持可选 `{ imageUrl }`：当提供 `imageUrl`（直传已上传的图片直链）时，直接生成 `![${name} 三视图原图](${imageUrl})` 替代 `【在这里附上图片】` 占位符，并说明这是网页直传提交的待审投稿。
3. **投稿组件与 Turnstile 挂载（`src/App.jsx`）**
   - `image` 状态额外保存原始 `File` 对象引用（供 `FormData` 上传使用，并在清理预览 URL 时同步释放）。
   - 打开弹窗且启用直传时，按需加载 `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`（支持本地/测试环境下通过显式全局钩子或路由拦截调试），获取 `turnstileToken`；提交失败或过期时自动重置小部件避免旧 token 卡死。
   - 点击「直接提交投稿」先执行既有的 `validateSubmission` 检查，确认已拿到 Turnstile 验证 token 后向 `submitApiUrl` 发送 `POST` `multipart/form-data`（包含 `image` 文件、`submission` JSON 字符串、`cf-turnstile-response`）。
   - 收到 `{ ok: true, issueNumber, issueUrl, name }` 后切换到弹窗内「投稿已提交」成功视图，展示 Issue 编号、查看链接与「继续逛逛图鉴」关闭按钮。

### 3.2 Cloudflare Worker 接收端（新增独立目录 `worker/`）

目录结构保持与前端构建隔离，同时通过标准 ES Module 复用 `src/domain.js` 的纯函数校验规则：

- `worker/wrangler.toml`：Worker 名称、入口 `src/index.js`、`compatibility_date`、免费版原生 `[[ratelimits]]` 限流绑定（例如同一客户端 IP 每 60 秒最多 3 次投稿），以及公开非敏感环境变量（`GITHUB_REPOSITORY`、`SUBMISSIONS_BRANCH`、`ALLOWED_ORIGINS`、`TURNSTILE_ALLOWED_HOSTS`）。
- `worker/src/submit-handler.js`：纯函数/可测试核心逻辑，负责：
  1. **CORS 与 HTTP 方法控制**：仅放行配置允许的 `Origin`（如 `https://fightingshine.github.io` 及本地开发来源），正确处理 `OPTIONS` 预检请求，仅接收 `POST`。
  2. **请求体积拦截**：检查 `Content-Length`（存在时拒绝 `> 12 MiB` 的请求，返回 `413`），避免超大请求耗尽 Worker `128 MB` 内存上限。
  3. **限流校验**：调用 `env.RATE_LIMITER.limit({ key: clientIp })`，超限返回中文提示的 `429`。
  4. **Turnstile 服务端验签**：携带 `env.TURNSTILE_SECRET_KEY` 调用 `https://challenges.cloudflare.com/turnstile/v0/siteverify`，验证 `outcome.success === true` 且 `outcome.hostname` 命中允许域名列表，未通过返回 `403`。
  5. **图片与表单二次强校验**：
     - 校验表单 JSON，复用 `validateSubmission`、`cleanText`、`keywordsFrom`、`submissionData`；
     - 读取上传文件字节（`24 <= bytes.length <= 10 * 1024 * 1024`），复用 `sniffImage` 与 `imageDimensions` 验证真实 `PNG / JPG / WebP` 文件头、像素总数 `<= 24_000_000`、宽高 `600 <= width <= 10000`、`300 <= height <= 10000` 且 `width >= height`；
     - 使用 Web Crypto 计算真实 `SHA-256`（不信任前端传入的哈希）。
  6. **原生 Base64 与 GitHub 写入**：
     - 使用 V8 原生 `bytes.toBase64()`（兼容 `Buffer.from` 作为 Node 测试后备），确保在免费版 `10 ms` CPU 时间额度内稳定处理最高 `10 MB` 原图；
     - 通过 GitHub Fine-grained PAT（仅授权 `Fightingshine/blue-whale-wardrobe` 的 `Contents: Read & write` 与 `Issues: Read & write`）保证 `submissions` 分支存在，通过 `PUT /repos/{owner}/{repo}/contents/{path}` 写入图片，再用返回 `commit.sha` 调用 `POST /repos/{owner}/{repo}/issues` 创建带有 `皮肤投稿` 标签的 Issue。
- `worker/src/index.js`：极简 Worker Fetch 入口，调用 `handleSubmitRequest(request, env)`。

### 3.3 部署与配置链路（`.github/workflows/pages.yml` 与项目文档）

- GitHub Actions 构建前端时支持从仓库 **Actions Variables** 读取 `VITE_SUBMIT_API_URL` 和 `VITE_TURNSTILE_SITE_KEY`（均为公开可入前端的配置项，不含任何私密凭据），这样无需在仓库源码中硬编码部署后的 Worker 域名或测试 Key。
- GitHub Token 与 Turnstile Secret Key **只保存在 Cloudflare Worker Secrets** 中，`scripts/validate.mjs` 保持 100% 干净。

---

## 4. 错误处理与安全边界

- **敏感凭据隔离**：`GITHUB_TOKEN` 与 `TURNSTILE_SECRET_KEY` 仅通过 `wrangler secret put` 注入 Cloudflare 运行环境，绝不提交到代码或 GitHub Pages 产物。
- **友好错误回显**：429 频控、403 验证未通过、400 图片/字段不合法、502 GitHub 上游失败等均返回统一结构 `{ ok: false, error: '...' }` 中文提示，前端展示清晰原因并保留「改去 GitHub 附图投稿」兜底入口。
- **孤儿文件容错**：若上传图片到 `submissions` 分支成功但创建 Issue 失败，返回可诊断提示，后续人工关闭或忽略未被引用的分支文件即可，不影响 `main` 与线上图鉴。

---

## 5. 验证计划

1. **Worker 核心单元测试（`tests/worker.test.mjs`，纳入 `npm test`）**：
   - Mock `fetch` 与限流绑定，验证 CORS 拦截、超大 `Content-Length` 拦截（413）、限流触发（429）、Turnstile 失败及 hostname 不匹配（403）、非图片伪造文件（400）、`submissions` 分支自动初始化与正常写入图片 + 创建 Issue（201/200）、以及上游错误返回。
2. **领域与脚本兼容验证**：
   - 验证 `submissionMarkdown(data, { imageUrl })` 生成的 Issue 正文能被现有 `scripts/sync-approved-issues.mjs` 的 `extractSubmissionJson` 与 `extractImageUrls` 正确解析。
3. **前端端到端测试（`tests/e2e/site.spec.js`）**：
   - 覆盖未启用直传（默认备用通道）与启用直传后（Mock Turnstile + `/api/submit`）的直传成功回执、报错兜底及桌面/手机响应式布局。
4. **安全与构建校验**：
   - `npm run validate && npm test && npm run build && npm run test:e2e` 全部通过。
