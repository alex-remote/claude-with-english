<p align="center"><a href="README.md">简体中文</a> | English</p>

<p align="center">
  <img src="plugins/work-with-english/assets/icon.png" width="120" alt="claude-with-english">
</p>

<h1 align="center">claude-with-english</h1>

<p align="center">Think in your language. Work with Claude Code in English.</p>

claude-with-english is a free, open-source plugin for Claude Code. You work in Claude Code as usual, and every message you send becomes a bit of English practice.

**Write in Chinese, see it in English**

Type in Chinese in the input box as you normally would. When you pause, the English translation appears in the band just above the input box. Translation uses your Claude Code account by default, so there's nothing extra to set up.

**Use the translation, or type it yourself**

Press Control+A or click "Replace with translation" to swap your text for the English. For more practice, click "Clear input" or press Control+A twice, then type the English yourself while reading it off the band. Strict mode is on by default, so Enter won't send while there's Chinese in the input box.

Later on, when you write in English directly, the band switches to corrections and fixes only spelling, grammar and misused words.

**Read replies in English**

Set the reply language to English in the settings, and Claude replies in English. After each turn, a line of translation appears automatically under every paragraph. Stick to the English, and check the translation only when you get stuck. When you give Claude a big task, you can also translate only the last few messages of each turn. Translations stay on your machine and never enter Claude's context.

**Look up, read aloud, analyse**

Hover over a paragraph in a reply. Click "Read aloud" to hear it, or "Analyse" to see its sentence structure and key grammar points. Double-click a word in a reply, and the band shows its phonetic transcription and common meanings, with the meaning used in that sentence marked (in the desktop app, press ⌘C after double-clicking). In the terminal, these actions need fullscreen rendering. Enter `/tui fullscreen` to turn it on.

**Save what you learn**

Words you look up go into the word book on your machine, along with the sentence they came from. You can add sentences too. You can also save English you've sent, together with the Chinese you originally wrote. If Anki is open on your computer with the AnkiConnect add-on installed, these become Anki cards automatically, and you do your reviews in Anki.

**See your progress every week**

Stats record only numbers, never message content. They count three ways of writing separately: using the translation, typing it yourself and writing in English directly. The first time you open Claude Code each week, you get a reminder to check last week's report. If you want to share it, you can also make a share card.

In the first version, the source language is Simplified Chinese and the target language is English.

## Install

You need macOS and Claude Code. It works in the Code tab of the desktop app and in the terminal. In a Claude Code conversation, enter:

```
/plugin install work-with-english --marketplace alex-remote/claude-with-english
```

Or do it in two steps:

```
/plugin marketplace add alex-remote/claude-with-english
/plugin install work-with-english@claude-with-english
```

Once it's installed, run this command or start a new session:

```
/reload-plugins
```

Then open the settings with:

```
/wwe
```

---

If claude-with-english helps you, a star on [GitHub](https://github.com/alex-remote/claude-with-english) is welcome.
