# 大肥鱼衣橱 · Blue Whale Wardrobe

蓝色大肥鱼三视图皮肤图鉴与开源共创投稿站 —— **一起，给大肥鱼换件新衣。**

- **在线图鉴**：[https://fightingshine.github.io/blue-whale-wardrobe/](https://fightingshine.github.io/blue-whale-wardrobe/)
- **皮肤投稿**：打开网站点击「投稿我的皮肤」，或使用 [GitHub 皮肤投稿入口](https://github.com/Fightingshine/blue-whale-wardrobe/issues/new?template=skin-submission.md)
- **权利说明**：网站源代码使用 [MIT 许可](LICENSE)；角色与皮肤三视图权利单独说明，详见 [图片与角色权利说明](ASSET_RIGHTS.md)

---

## 核心功能与机制

- **全部皮肤图鉴（不限数量）**
  展示基础与共创皮肤的正面、侧面、背面横向三视图，支持按风格标签筛选、名称/关键词搜索、高清预览弹窗、原图下载与 SHA-256 校验信息查看，并自动关联原投稿 Issue。
- **低门槛网页投稿辅助**
  选择本地三视图后即可实时预览并生成结构化投稿说明；支持关键词设置与**设计说明 / 素材来源快捷选题（均为选填）**，填写后一键带入 GitHub Issue 草稿，也可复制文本或下载 JSON 资料。
- **「已收录」标签自动同步上线**
  投稿 Issue 经维护者审核并打上 `已收录` 标签后，GitHub Actions 会自动分页拉取全部已收录投稿、校验并打包符合规格的 PNG/JPG/WebP 原图，无需手动修改代码或受数量限制，几分钟内即可显示在图鉴首页；取消标签、关闭或删除对应 Issue 后也会自动同步移除。
- **纯静态与隐私友好**
  无需后端数据库、账号体系或 API Key。网页选图仅在当前浏览器内存中检查与预览，只有在你主动前往 GitHub 发布带图 Issue 时图片才会上传至 GitHub。

---

## 仓库内置基础皮肤

仓库 `public/skins/` 内置了 4 套保留原始字节、尺寸与 SHA-256 哈希的历史参考皮肤；后续通过 Issue `已收录` 标签同步的新皮肤会在构建阶段自动合并展示。

| 皮肤名称 | 皮肤 ID | 风格分类 | 参考关键词 | 完整三视图 |
| --- | --- | --- | --- | --- |
| 原装大肥鱼 | `original` | 女仆 | `原装`、`原皮`、`女仆装` | [查看原图](public/skins/original/reference.png) |
| 冬装大肥鱼 | `winter` | 冬装 | `冬装`、`冬日装`、`冬季装` | [查看原图](public/skins/winter/reference.jpg) |
| 毛衣大肥鱼 | `sweater` | 毛衣 | `毛衣`、`针织装` | [查看原图](public/skins/sweater/reference.png) |
| 像素风大肥鱼 | `pixel` | 像素 | `像素风`、`像素画`、`像素皮肤` | [查看原图](public/skins/pixel/reference.png) |

> 这些参考图均标记 `LicenseRef-Asset-Rights-Reserved`，代码仓库的 MIT 许可不代表角色或图片素材已开放商用或再许可，详情请查看 [ASSET_RIGHTS.md](ASSET_RIGHTS.md)。

---

## 同学如何投稿新皮肤

### 1. 准备三视图原图

- **排版建议**：一张横向拼图，顺序从左到右为**正面、侧面、背面**；建议白底、全身、三面人物等高，鞋子和鲸尾完整可见，三面服装配色与饰品位置保持一致。
- **角色辨识度**：保留深蓝渐浅蓝长发、蓝眼、侧鳍、鲸尾与 Q 版比例；画风可自由发挥（可在投稿中说明）。你可以在网站首页直接下载「原装大肥鱼」三视图作为比例参考。
- **文件规格**：支持 `PNG`、`JPG`、`WebP`，单个文件不超过 `10 MB`，总像素不超过 `2400 万`（不支持压缩包或 SVG 伪装图片）。

### 2. 在网站填写并前往 GitHub 提交

1. 打开 [大肥鱼衣橱](https://fightingshine.github.io/blue-whale-wardrobe/)，点击「**投稿我的皮肤**」。
2. 选择本地三视图进行预览与基本规格检查（此时图片仅保留在当前浏览器内存中）。
3. 填写**皮肤名称**、**作者署名**（昵称或常用 ID 即可，勿提交学号、手机号等个人隐私）与**触发关键词**（多个关键词用逗号或顿号分隔）。
4. **设计说明**与**素材来源与使用范围**均为**选填**——可直接点选预设标签快速组合，或简单补充配色细节与出处；如希望作品加入每日日报随机轮换，保持对应勾选项开启即可。
5. 勾选确认将投稿公开至 GitHub，点击「**去 GitHub 附图投稿**」：
   - 若内容较多导致浏览器未自动带入全文，点击「**复制投稿说明**」粘贴到正文即可；
   - 在打开的 GitHub Issue 正文中**拖入刚才那张原图**，确认图片上传完成后点击提交。
6. 维护者审核无误并为 Issue 打上 `已收录` 标签后，作品即会自动加入线上皮肤图鉴（更多细节可参考 [CONTRIBUTING.md](CONTRIBUTING.md)）。

> 不方便打开网页时，也可直接使用 [GitHub 皮肤投稿模板](https://github.com/Fightingshine/blue-whale-wardrobe/issues/new?template=skin-submission.md) 手工填写并附图发布，同步脚本同样支持解析。

---

## 维护者管理与自动同步

### 方式一：Issue 打标自动发布（日常推荐）

日常收录无需在本地拉代码或跑脚本：

1. 检查投稿 Issue 的三视图完整性、署名信息及内容规范，确认无误后为 Issue 添加 `已收录` 标签。
2. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 监听 `push`（`main` 分支）、`issues`（`labeled`、`unlabeled`、`edited`、`closed`、`reopened`、`deleted`）与 `workflow_dispatch` 事件。
3. 站点构建完成后自动运行 [`scripts/sync-approved-issues.mjs`](scripts/sync-approved-issues.mjs)：
   - 通过 GitHub API 全量分页拉取所有带 `已收录` 标签的 Issue（`per_page=100` 逐页获取，过滤 Pull Request，不设上限）；
   - 同时兼容解析网站表单生成的 `whale-skin-submission/v1` JSON 代码块与手工 Markdown 模板段落；
   - 仅从受信任的 HTTPS GitHub 附件域名拉取图片（忽略表情图标），校验 `PNG`/`JPG`/`WebP` 文件头、体积（`<= 10 MB`）、尺寸（`<= 2400 万`像素）及 SHA-256 去重后写入 `dist/skins/issue-<n>/` 与 `dist/skins/catalog.json`，随后部署 GitHub Pages。
4. **图鉴展示与机器人启用互相独立**：打标收录进图鉴站不会自动修改线上群聊机器人的生图配置或日报轮换列表，机器人侧更新仍需管理员单独配置确认。

### 方式二：归档进仓库源码（可选）

如果希望将某套皮肤永久固化进仓库的 `public/skins/<id>/` 目录中，可在本地下载原图和网页导出的投稿 JSON 后执行导入脚本（该脚本要求 JSON 中包含完整字段且 SHA-256 与本地原图一致，拒绝覆盖已有 ID）：

```powershell
node scripts/add-skin.mjs --id campus --image ./reference.png --metadata ./skin-submission.json --approve yes
npm run validate
npm test
npm run build
```

---

## 本地开发与验证

### 环境准备

- **Node.js**：`>= 22.12.0`（GitHub Actions CI 使用 Node.js 24）
- **镜像配置**：仓库根目录 [`.npmrc`](.npmrc) 已默认设置国内 npm 镜像（`https://registry.npmmirror.com`）并保持 `strict-ssl=true`。

```powershell
npm ci
npm run dev
```

### 校验与测试命令

```powershell
npm run validate   # 校验 public/skins 目录、元数据一致性、原图哈希/尺寸与公开安全检查
npm test           # 运行 Node 原生单元测试（tests/*.test.mjs）
npm run build      # 执行 validate + test 并打包生产站点至 dist/
npm run preview    # 本地预览构建产物
```

### 端到端浏览器测试（Playwright）

```powershell
npx playwright install chromium
npm run test:e2e
```

在 Windows 本地环境下，如果未单独下载 Playwright Chromium 或默认端口 `4173` 被占用，可以通过环境变量指定系统 Edge 与自定义端口运行（配置见 [`playwright.config.js`](playwright.config.js)）：

```powershell
$env:PW_PORT = "24173"
$env:PW_CHANNEL = "msedge"
npm run test:e2e
```

---

## GitHub Pages 部署与二次配置

1. 推送仓库后，进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
2. 构建工具 [`vite.config.js`](vite.config.js) 使用相对资源基准路径（`base: './'`），可直接部署到仓库子路径，无需额外配置前端路由。
3. 如需复用到其他账号或仓库：
   - 修改 [`src/site.js`](src/site.js) 中的 `name`、`owner`、`repository` 与 `github` 链接；
   - 确认目标仓库已创建 `已收录` Issue 标签，并按需更新 [`scripts/sync-approved-issues.mjs`](scripts/sync-approved-issues.mjs) 的默认仓库名、Issue 模板和本文档中的仓库链接。

---

## 项目结构

```text
.github/
  ISSUE_TEMPLATE/          皮肤投稿与反馈 Issue 模板
  workflows/               CI 检查（ci.yml）与 GitHub Pages 自动同步部署（pages.yml）
public/skins/
  catalog.json             仓库内置基础皮肤目录
  <id>/                    基础皮肤原图（reference.*）与元数据（metadata.json）
scripts/
  sync-approved-issues.mjs 构建阶段从已收录 Issue 自动分页同步共创皮肤
  add-skin.mjs             维护者本地核验归档单套皮肤的工具脚本
  catalog.mjs              目录与单套皮肤元数据、SHA-256 校验逻辑
  validate.mjs             目录完整性和公开内容安全检查脚本
src/
  App.jsx                  图鉴首页、详情弹窗、三视图规范弹窗与投稿工作台
  domain.js                筛选搜索、图像头与尺寸检测、选题组合与投稿 Markdown/JSON 生成
  site.js                  站点信息与相对资源地址解析
  styles.css               桌面端与移动端自适应样式
tests/
  *.test.mjs               目录、领域逻辑与已收录 Issue 自动同步单元测试
  e2e/site.spec.js         Playwright 桌面端与移动端端到端回归测试
ASSET_RIGHTS.md            代码与角色/图片素材权利分界说明
CONTRIBUTING.md            共创投稿与代码贡献指南
SECURITY.md                安全与隐私边界说明
```

欢迎通过 Issue 或 Pull Request 参与共创投稿、补充历史署名或改进网站体验；提交内容请勿包含个人身份信息或任何访问凭据，安全边界详见 [SECURITY.md](SECURITY.md)。
