# 大肥鱼衣橱

一个可以部署在 GitHub Pages 的开源皮肤图鉴与共创投稿站。

**网站代码使用 MIT 许可；角色、三视图和投稿图片的权利单独说明，不因代码开源而自动开放商用或再许可。** 请先阅读 [图片权利说明](ASSET_RIGHTS.md)。

## 已收录的历史皮肤

| 皮肤 | 完整三视图 | 关键词 |
| --- | --- | --- |
| 原装大肥鱼 | [查看原图](public/skins/original/reference.png) | 原装、原皮、女仆装 |
| 冬装大肥鱼 | [查看原图](public/skins/winter/reference.jpg) | 冬装、冬日装、冬季装 |
| 毛衣大肥鱼 | [查看原图](public/skins/sweater/reference.png) | 毛衣、针织装 |
| 像素风大肥鱼 | [查看原图](public/skins/pixel/reference.png) | 像素风、像素画、像素皮肤 |

四套保留原始图片字节、尺寸与 SHA-256。历史素材的具体创作者署名和授权范围尚需补充，不能将收录理解为项目拥有全部相关权利。

## 同学怎样投稿

1. 打开网站，点击「投稿我的皮肤」。
2. 选择一张**正面＋侧面＋背面**的横向三视图；填写名称、昵称署名、关键词、设计和素材来源。
3. 图片只在浏览器本地检查和预览。本站没有上传后端，不保存图片，也不要求 API Key。
4. 点击「去 GitHub 附图投稿」，在打开的 GitHub Issue 正文中**拖入刚才那张原图**，然后发布 Issue。需要 GitHub 账号。
5. 维护者审核后通过 PR 收录。投稿、发 Issue、合入本站均不会自动更新机器人或调用付费生图。

也可以直接使用 [皮肤投稿入口](https://github.com/Fightingshine/blue-whale-wardrobe/issues/new?template=skin-submission.md)。详细流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

> GitHub Pages 托管静态网页，不能仅靠前端把文件写进仓库。网站故意不内置访问令牌、不收集登录口令、不伪造“上传成功”。

## 投稿规格

- 一张横向拼图，顺序为正面、侧面、背面；白底、全身、人物等高。
- 服装配色、配饰和纹样在三个视角中一致，避免裁掉鞋子和鲸尾。
- 保留角色的辨识特征；像素风等画法可以在说明中写清。
- 使用 PNG、JPG 或 WebP，不超过 10 MB；最多 2400 万像素。
- 不填写真实姓名、学号、宿舍、电话，不夹带群聊截图或其他人的个人信息。
- 基本文件检查不等于人工审核三视图，也不构成权利证明。

## 本地运行

需要 Node.js 22.12 或更高版本，推荐 Node.js 24。

```powershell
npm ci
npm run dev
```

项目默认使用国内 npm 镜像，并保持 TLS 验证开启。不需要任何模型密钥或机器人服务器配置。

```powershell
npm run validate
npm test
npm run build
npm run preview
```

浏览器测试：

```powershell
npx playwright install chromium
npm run test:e2e
```

## 发布 GitHub Pages

仓库推送后，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

`.github/workflows/pages.yml` 会先校验目录、运行单元测试、构建，然后上传并部署 `dist`。项目使用相对资源路径，支持仓库子路径，不需要修改路由。

如需部署到其他账号或仓库，先修改 `src/site.js` 中的账号、仓库和 GitHub 地址，再更新 README 与模板中的相关链接。

## 维护者收录

网站可下载投稿 JSON。维护者人工核对 Issue 中附图、来源和使用范围，将图片和 JSON 下载到本地后，在工作分支运行：

```powershell
node scripts/add-skin.mjs --id campus --image ./reference.png --metadata ./skin-submission.json --approve yes
npm run validate
npm test
npm run build
```

脚本只处理维护者已经审核的本地图片，拒绝覆盖已有 ID、路径穿越、哈希不一致和缺少确认的投稿；不从用户输入的 URL 下载内容，不自动批准 Issue。

**收录到网站与启用到机器人是两步。** 本项目不包含服务器地址、SSH、QQ 登录、群聊、模型密钥或机器人控制 API。现有机器人皮肤轮换与“禁止连续抽中”机制保持独立；将来同步时仍需管理员单独批准并验证。

## 项目结构

```text
public/skins/catalog.json       已收录目录
public/skins/<id>/reference.*   不改写的三视图
public/skins/<id>/metadata.json 署名、权利说明、关键词与原图哈希
src/                           网站与本地投稿预览
scripts/                       校验与维护者收录工具
tests/                         单元与浏览器测试
.github/ISSUE_TEMPLATE/         皮肤投稿和反馈入口
```

欢迎贡献新皮肤、文案修正、署名补充、无障碍与功能改进。请不要在 Issue、PR 或配置示例中提交任何密钥和个人信息。
