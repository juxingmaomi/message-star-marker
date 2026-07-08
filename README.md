# 楼层星心标记

TavernHelper / SillyTavern 单文件脚本：在 AI 消息楼层右上角的三点按钮旁加 `★` 和 `♥`，用于标记没看完、想回看的楼层。

## 功能

- 只给 AI 消息加按钮，不标用户消息。
- `★` 和 `♥` 可分别点亮、分别取消。
- 标记状态保存到当前聊天消息的 `extra.thMessageMarker`。
- 不保存到浏览器 `localStorage`，也不写世界书。
- 不修改消息正文，只改聊天 JSON 里该楼层的附加字段。

## 跨设备说明

这一版的标记跟着 SillyTavern 聊天文件走。

如果电脑和手机访问的是同一个 SillyTavern 服务、同一份聊天数据，手机也能看到标记。

如果电脑和手机各自运行不同的 SillyTavern 数据目录，就不会自动同步；需要同步聊天文件。

## 使用

在 TavernHelper 新建脚本，把 `index.js` 的完整内容粘贴进去并启用。

## GitHub 入口壳

仓库地址：

```text
https://github.com/juxingmaomi/message-star-marker
```

在 TavernHelper 中导入 `tavern-helper-loader.json`，以后更新只需要在入口壳里修改：

```js
const VERSION = 'v0.4.1';
```

loader 会加载：

```js
https://cdn.jsdelivr.net/gh/juxingmaomi/message-star-marker@v0.4.1/index.js
```

## 控制台接口

脚本加载后会暴露：

```js
window.__th_message_star_marker_instance_v1__
```

可用方法：

- `refresh()`：重新扫描楼层按钮。
- `getMarkedRecords()`：查看当前聊天里已标记的消息记录。
- `stop()`：卸载按钮和样式。
