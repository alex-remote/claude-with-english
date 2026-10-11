<p align="center">
  <img src="plugins/work-with-english/assets/icon.png" width="120" alt="claude-with-english">
</p>

<h1 align="center">claude-with-english</h1>

<p align="center">用母语思考，用英语和 Claude Code 协作。</p>

claude-with-english 是一个免费开源的 Claude Code 插件。你照常用 Claude Code 工作，每发一条消息，都是一次英语练习。

**写中文，看英文**

在输入框里照常写中文，停顿一下，输入框正上方的横条就显示对应的英文译文。翻译默认使用你的 Claude Code 账号，不用另外配置。

**换成译文，或者照着敲**

按 Control+A 或点“替换为译文”，原文直接换成英文。想多练一点，就点“清空输入框”或按两下 Control+A，看着横条自己敲。严格模式默认开启，输入框里有中文时回车不会发出。

练到后面直接写英文时，横条改为纠错，只改拼写、语法和用错的词。

**读英文回复**

在设置里把回复语言设为英语，Claude 就用英文回复。每轮做完后，每段下面自动出现一行译文，主要读英文，看不懂再看译文。交给 Claude 大任务时，也可以只翻每轮最后几条。译文只存在本机，不进 Claude 的上下文。

**查词、朗读、解析**

把鼠标移到一段回复上，点“朗读”听一遍，点“解析”看句子结构和语法要点。在回复里双击一个单词，横条显示它的音标和常用释义，这句里用的那条会标出来（桌面端双击后再按 ⌘C）。在终端里，这些操作需要开启全屏渲染，输入 `/tui fullscreen` 即可。

**记下来**

查到的单词连同原句存进本机的单词本，句子也能加进去。自己发出的英文也能收藏，连同当时写的中文一起存下。电脑上开着 Anki 并装好 AnkiConnect 插件时，自动建成 Anki 卡片，复习在 Anki 里做。

**每周看进步**

统计只记数字，不记消息内容，按用译文、照着敲、直接写三种写法分别计数。每周第一次打开 Claude Code 时，提醒你查看上周的周报；想分享时，还能生成分享卡。

第一版的源语言是简体中文，目标语言是英语。

## 安装

需要 macOS 和 Claude Code，桌面端的 Code 标签或终端都可以。在 Claude Code 的对话里输入：

```
/plugin install work-with-english --marketplace alex-remote/claude-with-english
```

也可以分两步：

```
/plugin marketplace add alex-remote/claude-with-english
/plugin install work-with-english@claude-with-english
```

装好后输入下面的命令，或者开一个新会话：

```
/reload-plugins
```

之后输入下面的命令打开设置：

```
/wwe
```

---

如果 claude-with-english 对你有帮助，欢迎在 [GitHub](https://github.com/alex-remote/claude-with-english) 上点个 Star。
