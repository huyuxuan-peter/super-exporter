# ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter 1.1.3

本版仅统一品牌名称（扩展管理页、工具栏提示、预览页标题和Word作者元数据）。原导出功能及bata标记保留。

本版界面简化：移除只选问题/只选回答；内容列表统一显示“内容 #序号”。保留全选、清空、反选、手动勾选与Shift连选。Word和PNG格式标签按用户指定加“bata”。

# AI Rich Exporter 1.1.1

多平台适配版：ChatGPT、Claude、Gemini、DeepSeek、Grok、通义千问、Kimi、豆包、Copilot。仅限manifest列明的网页域名，不申请所有网站权限。各平台共用单条消息选择和四格式导出流程。

新增平台规则在src/platforms.ts中，域名和worker通信校验共用该白名单。原ChatGPT新版问答拆分继续保留。不同平台网站变更时需要更新规则；新增平台目前只完成合成DOM的本机扩展测试，不能视为所有登录页面兼容认证，尤其豆包和千问页面变体需要线上核对。未识别时可保存结构诊断，不按消息奇偶猜角色。

安装：停用旧版，解压安装包，在Chrome扩展管理页加载含manifest.json的文件夹，刷新对应AI网页。安装无需Node.js。

开发复测：npm install；npm run build；npm test；npx playwright install chromium；npm run test:browser；npm run test:platforms。四格式测试需Python的pypdf/python-docx/Pillow。最低Chrome131，本次本机Chromium156。完整限制及测试证据见VERIFICATION.md。

以下为原有详细功能说明，ChatGPT特定操作请对应所用平台理解。

---

# ChatGPT Rich Exporter 1.0.4

一个本地运行的 Chrome Manifest V3 扩展。最小选择单位是一条用户或助手消息。可以按角色筛选、勾选不连续的消息，或按住 Shift 选择连续范围。导出按页面顺序排列。

## 安装与使用

1. 解压交付 ZIP。如已安装 v1.0.0／v1.0.1，请先停用旧版本，避免两个扩展同时注入。在 **Chrome 131 或更新版本**打开 `chrome://extensions`，打开右上角的开发者模式。
2. 点击 **加载已解压的扩展程序**，选择 `chatgpt-rich-exporter/dist`。所选目录中应直接包含 `manifest.json`。
3. 刷新已打开的 ChatGPT 页面，进入一段会话。点击右侧浮动的 **导出** 或 Chrome 工具栏中的扩展图标。
4. 选择消息和格式，点击 **导出**。预览会列出选择数量、公式、图片和降级项。资源缺失时可以重试或继续导出。
5. PDF 在 Chrome 打印对话框中选择 **另存为 PDF**。Markdown、Word 和 PNG 从导出预览下载。

设置支持中文／英文、亮／暗主题、PNG 宽度和倍率、A4／Letter、横向纸张、按消息分页、目录、页码、Markdown ZIP 和 YAML 元数据。DOCX 使用 Word 的正常浅色文档样式。面板关闭或切换会话再返回时会恢复本次标签页中的选择。重载页面会重新读取已加载消息。

| 格式 | 输出 |
| --- | --- |
| Markdown | 默认为 ZIP，含 `.md` 和本地图片资源。可切换单文件。保留 LaTeX、链接和代码围栏。合并单元格用 HTML 表格表示。 |
| PDF | Chrome 打印独立预览。普通文字可搜索和复制，保留链接、KaTeX、表格和代码。PDF 页码使用 Chrome 131 的 CSS 打印页边距功能。 |
| Word | 可编辑段落、标题、编号列表、合并单元格、链接和图片。基本公式是 OMML，复杂公式优先保留为图片和可用的 LaTeX。目录可在 Word 中更新。 |
| PNG | 以设定宽度和 1×／2×／3× 渲染。短内容生成一张 PNG，长内容生成按顺序编号的多张 PNG 和 ZIP。 |

## 导出范围与保真度

- 读取当前可见分支中已经加载的消息。点击 **加载较早消息** 会尝试向上滚动并恢复位置。网页回收已滚出视口的消息时，可读取范围仍由网页当前 DOM 决定。回答生成期间可以修改勾选，完成后才能导出。
- 保真度报告中的 **Complete** 只针对已选且可读的消息。**Partial** 表示当前导出使用了占位符、静态快照或其他降级；**Failed** 表示本次准备或下载失败。浏览器打印对话框负责最终保存，扩展无法读取 PDF 文件大小或确认用户是否保存。
- 附件卡片保留可见文件名、链接或路径。附件二进制内容与附件 ZIP 未实现。未加载的数据、折叠部分和虚拟化列表只保留已读取的内容，并在有信号时标记限制。
- SVG 会移除外部引用和主动内容。Canvas、GIF、音视频与交互组件按当前可见状态静态表示。外部 iframe、实时交互、闭合 Shadow DOM，以及网页没有暴露的数据只能保留可读说明或链接。Mermaid 有可见 SVG 时保留图形，有代码时保留源码。
- 资源明细包含候选来源、实际尺寸、MIME 和获取结果。只有页面暴露更高质量候选链接且读取成功，才显示获取到了该候选；其它显示版本会注明。浏览器 CORS、失效链接、画布跨域限制和资源大小上限可能触发占位符。超大图片、公式或表格行可能跨 PNG 页，报告会标出已知切分。
- 分数、根号、上下标和部分求和／积分可转换为 Word 原生公式。矩阵、分段函数和多行对齐一般使用图像和 TeX。源 TeX 不可见时优先使用 MathML 或可读取的页面表示。单文件 Markdown 中的远程图片链接可能过期，嵌入图片的支持取决于编辑器。
- 对话内容在当前标签页与扩展预览间传输。仅设置写入 Chrome 扩展存储。网络访问默认限于同源媒体，用户开启设置后才会对已出现的外部 HTTPS 图片做无 Cookie、无 Referer 的 CORS 请求。没有登录数据采集、服务端渲染或遥测。
- 权限只覆盖 ChatGPT 的两种站点地址、设置存储和下载。使用已有图片链接或页面快照，不调用 ChatGPT 内部接口。每张网络图片上限 24 MiB，单次解码资源累计上限 180 MiB，已捕获的页面快照有单独预算。

## 构建与测试

需要 Node.js 22.12+ 和 npm。构建后生成 `dist/`，运行时代码、KaTeX 和字体全部随包安装。

```sh
npm ci
npm run build
npm test
```

完整扩展测试需要 Playwright 自带的 Chromium，以及 Python 的 `pypdf`、`python-docx`、`Pillow`。测试通过独立读取器验证导出文件，不依赖 Poppler 命令。PDF 人工视觉复查可使用 Poppler 渲染。

```sh
npx playwright install chromium
python -m pip install pypdf python-docx Pillow
npm run test:browser
# 或指定已安装的、支持扩展的 Chromium 二进制
CHROMIUM_BIN=/path/to/chromium npm run test:browser
# 仅当浏览器是 Headless Shell 时，使用真实渲染器与测试用 Chrome API 模拟
RENDERER_ONLY=1 CHROMIUM_BIN=/path/to/chromium-headless-shell npm run test:browser
```

Windows PowerShell 可直接运行以上不含环境变量的命令。若 Python 不叫 `python`，先设 `$env:PYTHON_BIN='完整的python.exe路径'`；若使用自定义浏览器缓存，先设 `$env:PLAYWRIGHT_BROWSERS_PATH='缓存目录'`。需要显示测试窗口时设 `$env:HEADED='1'`。不要将自己的 Chrome 用户资料目录作为自动测试目录。

测试使用合成会话、透明图片与模拟的过期资源。输出写入 `test-output/`，也可用 `EXPORT_TEST_OUTPUT` 指定目录。`browser-results.json` 记录模式、浏览器版本、各组结果和脚本错误。本次已在 Windows 本机真实加载 MV3 扩展，覆盖原生扩展通信与下载、worker 停止后恢复、单条消息和间隔选择、角色筛选、Shift、关闭恢复、生成中保护、SPA、220 条混合内容、取消及四种格式。当前已登录 ChatGPT 线上 DOM 和原生工具栏鼠标点击仍需按以下清单验证；未把合成会话测试当成线上兼容认证。详细证据见 `VERIFICATION.md`。

### 已登录 ChatGPT 人工验收

1. 安装后固定工具栏图标，打开会话，分别验证工具栏与浮动入口。检查标题、消息数量和勾选恢复。
2. 在包含上传图片、生成图片、来源、文件、写作块及公式的会话中，选择两条不相邻消息，核对四种格式的正文和保真度报告。
3. 在一个超过 100 条消息的会话中使用加载较早消息，核对页面读取范围和滚动位置。开始生成回答，确认生成期间导出暂缓，完成后恢复。
4. PDF 保存后搜索中文正文、点击链接。Word 检查表格和公式可编辑性，PNG 检查首末内容与分片顺序。对有缺失资源的会话测试重试与取消。

## 模块定位

| 模块 | 职责 |
| --- | --- |
| `src/adapter.ts` | ChatGPT DOM 选择器、可见消息、标题和生成状态。网页改版时先更新此处。 |
| `src/extract.ts`、`src/model.ts` | 内容识别、可见状态、统一内容树、未知组件和警告。 |
| `src/content.ts`、`src/worker.ts` | 选择器、会话切换、分批提取、启动独立预览。 |
| `src/preview.ts`、`src/export/assets.ts` | 资源读取、进度、取消、预览、保真度报告。 |
| `src/export/` | Markdown、HTML／PDF、DOCX／OMML、PNG 渲染与下载。 |
| `test/` | 合成网页、单元测试和浏览器验收。 |

本项目自此版本起采用 PolyForm Noncommercial 1.0.0，仅授予其条款允许的非商业用途。第三方组件保持原许可证；历史 MIT 版本的授权不因此撤销。详见 LICENSE 与 LICENSING.md。构建产物附带第三方运行时依赖和字体许可。实现参考 [Chrome MV3](https://developer.chrome.com/docs/extensions/develop/migrate)、[Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)、[KaTeX](https://katex.org/docs/options)、[docx](https://github.com/dolanmiu/docx) 和 [html-to-image](https://github.com/bubkoo/html-to-image)。
