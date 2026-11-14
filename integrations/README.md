# AstrBot 皮肤库接入

管理插件源码见 [`../plugins/astrbot_plugin_whale_skins`](../plugins/astrbot_plugin_whale_skins)。网站保持纯静态；服务器上的插件主动拉取已发布目录，不需要把 SSH 密钥、生图 Key 或 GitHub Token 配进网站。

## 现有部署

本项目维护者的机器人已安装皮肤库 v0.1.0，生图插件已适配到 v0.7.0。每 5 分钟检查一次 `skins/catalog.json`，也可以在管理员页面点击「同步已审核皮肤」。从打标到可用需要等待网站构建和一次同步。

## 迁移至其他机器

1. 准备 AstrBot >=4.29.1，以及兼容的 `astrbot_plugin_kuaiai_image` 生图插件和四套已确认的基础原图。
2. 备份生图插件代码与数据，确认没有正在进行的生图或日报配图任务。
3. 如果代码与本项目原先的 v0.6.5 一致，可以先在生图插件的**独立工作副本**运行：

   ```powershell
   git -c core.autocrlf=input apply --check <补丁绝对路径>
   git -c core.autocrlf=input apply <补丁绝对路径>
   ```

   补丁为本目录的 `kuaiai-image-v0.6.5-to-v0.7.0.patch`。命令中的临时换行设置兼容旧源码的 CRLF，不修改全局 Git 配置。检查不通过时，按 `plugins/astrbot_plugin_whale_skins/integrations/kuaiai_image/` 中的适配器接口人工集成，不要强制覆盖不同版本。

4. 用配套补丁升级生图插件；安装管理插件时，将 `plugins/astrbot_plugin_whale_skins` 目录打包为一个 ZIP，再在 AstrBot 的插件管理中上传。也可以把目录放入插件目录后按 AstrBot 对新插件的正规安装流程加载；不要以未知插件名调用全局重载。
5. 核实 `builtins.json` 与实际基础原图的 SHA-256；配置可信的图鉴 HTTPS 根地址。仅热重载目标插件。
6. 打开皮肤库管理页，确认最近同步成功、原图校验通过、动态皮肤可见，检查默认原装与连续禁抽规则。

本仓库未包含生图插件旧版全部源代码或任何运行配置。该补丁是针对上述自有部署的适配，不保证适用于其他名称相近的第三方生图插件。

## 运行验证

在仓库根目录：

```powershell
python -m pip install -r plugins/astrbot_plugin_whale_skins/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
python -m unittest discover -s plugins/astrbot_plugin_whale_skins/tests -v
```

测试不调用真实模型和 QQ。线上投递和付费生成需要单独验收；不要把测试日志里的替身发送当作真实群消息。
