// How every place that waits for a result words it (通用状态), the toasts at
// start-up (运行环境 › 启动时的提示, 命令 › 第一次使用的提示) and the toast
// a save shows (设置 › 保存). Each sentence is the feature map's own; the
// engine puts the mod's name above a toast, so the text is its second line.

/** In progress in a pane or a dropdown: 正在获取模型列表… */
export const progressInPane = (action: string) => `正在${action}…`

/** In progress anywhere else: 翻译中… */
export const progressInline = (action: string) => `${action}中…`

/** Failed, where the result would have gone: 翻译失败：<原因> */
export const failure = (action: string, reason: string) => `${action}失败：${reason}`

/** A word or text named inside a sentence: 正在解析“cause”… */
export const quoted = (text: string) => `“${text}”`

/** Once, the first time the plugin starts after it is installed */
export const firstRunToast = () => '输入 /wwe 打开设置。'

/** Once, the first time the terminal starts without fullscreen rendering */
export const notFullscreenToast = () =>
  '未开启全屏渲染，段落上的按钮和查词暂时无法使用，横条上的按钮不能用鼠标点。输入 /tui fullscreen 即可开启。'

/** Once, the first time it starts on a system other than macOS or in a remote session */
export const notMacLocalToast = () =>
  'work-with-english 第一版仅支持在 macOS 本机上运行，部分功能可能无法使用。'

/** Each save: 已保存：翻译延迟 1.5 s; a value shown as nothing (a short API Key) leaves no space behind */
export const savedToast = (item: string, value: string) =>
  value === '' ? `已保存：${item}` : `已保存：${item} ${value}`
