# 楼层星心标记

TavernHelper / SillyTavern 单文件脚本：在 AI 消息楼层顶部和底部添加 `问答`、`来信`、`★` 和 `♥` 四种标记。

## 功能

- 只给 AI 消息加按钮，不标用户消息。
- 四种标记按 `问答`、`来信`、`★`、`♥` 排列，可分别点亮、分别取消；顶部与底部实时同步。
- 点击 TavernHelper 的 `星心面板` 按钮或右下角备用 `星心` 按钮时才打开标记列表。
- 列表支持按全部 / 问答 / 来信 / 星标 / 爱心筛选，点击楼层可跳转，也可直接取消对应标记。
- 如果楼层正文里有 `<Scene_Title>标题</Scene_Title>`，列表会显示这个标题。
- 点击很早的懒加载楼层时，会先调用酒馆助手 `/chat-jump` 请求加载；如果仍未渲染，会临时显示目标楼层附近一段，并可在面板里恢复完整聊天。
- 标记状态保存到当前聊天消息的 `extra.thMessageMarker`。
- 不保存到浏览器 `localStorage`，也不写世界书。
- 不修改消息正文，只改聊天 JSON 里该楼层的附加字段。

## 跨设备说明

这一版的标记跟着 SillyTavern 聊天文件走。

如果电脑和手机访问的是同一个 SillyTavern 服务、同一份聊天数据，手机也能看到标记。

如果电脑和手机各自运行不同的 SillyTavern 数据目录，就不会自动同步；需要同步聊天文件。

## 使用

在 TavernHelper 新建脚本，把 `index.js` 的完整内容粘贴进去并启用。

如果想发布到 GitHub 后用 CDN 加载：

1. 新建公开仓库，例如 `message-star-marker`。
2. 上传 `index.js` 到仓库根目录。
3. 创建 release/tag，例如 `v0.5.0`。
4. 把 `tavern-helper-loader.template.js` 里的 `YOUR_GITHUB_USERNAME` 改成你的 GitHub 用户名。
5. 在 TavernHelper 中粘贴修改后的 loader。

loader 会加载：

```js
https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/message-star-marker@v0.5.0/index.js
```

## 控制台接口

脚本加载后会暴露：

```js
window.__th_message_star_marker_instance_v1__
```

可用方法：

- `refresh()`：重新扫描楼层按钮。
- `openList()`：打开当前聊天的标记列表。
- `getMarkedRecords()`：查看当前聊天里已标记的消息记录。
- `stop()`：卸载按钮和样式。
