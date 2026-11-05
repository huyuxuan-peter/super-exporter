# v1.1.2 名称更新

名称：ChatGPT·Gemini·Claude·DeepSeek·Grok·Qwen·Kimi·豆包·Copilot Super Exporter。本次仅品牌与版本变更，构建验证通过；下文为历史功能测试证据。

---

# v1.1.1 界面调整

移除问题/回答角色筛选，列表统一标记内容序号。Word (.docx) bata及PNG bata使用用户指定拼写。导出器与识别管线未更改。构建及40项单元测试通过；现有12组浏览器测试通过，检查角色按钮不存在、中性内容标签以及两个bata选项；8个平台的手动勾选导出流程通过。以下为历史验收。

---

# v1.1.0 多平台适配验收

新增src/platforms.ts统一域名、角色选择器和生成状态，适配9个平台：ChatGPT、Claude、Gemini、DeepSeek、Grok、通义千问、Kimi、豆包、Copilot。新旧域名与本地预览通信白名单同步更新，避免扩展注入后被worker拒绝。问题和回答仍为独立单位，沿用Markdown/PDF/DOCX/PNG资源与渲染管线。query参数变更也会切换选择状态。

构建通过；40/40单元测试通过，包含8个新增平台DOM、嵌套去重、侧栏/输入区排除、Claude生成保护及域名仿冒测试。原12/12组真实MV3浏览器测试通过。新增8/8个域名的真实MV3流程通过：实际匹配注入→识别两条→只选回答→worker打开预览→下载Markdown ZIP→独立校验回答存在、问题不存在。机器可读证据分别在test-output的unit-results.json、browser-results.json、platform-results.json。

所有新增平台测试页面均由本机合成Fixture拦截提供，不是实际登录会话。没有登录用户账号或调用各平台内部API。仅说明候选规则和扩展端到端流程可用，不保证当前每个线上DOM版本适配。豆包仅支持明确角色标记及候选data-testid，千问/Kimi各页面版本的类名可能变化；没有明确角色时不自动猜测。其它原有的附件、复杂公式、未知组件与加载范围限制继续适用。

域名白名单包括chatgpt.com、chat.openai.com、claude.ai、gemini.google.com、chat.deepseek.com、grok.com、chat.qwen.ai、qianwen.com/www.qianwen.com、tongyi.aliyun.com、kimi.com/www.kimi.com、kimi.moonshot.cn、doubao.com/www.doubao.com、copilot.microsoft.com。不覆盖所有任意AI网站、X内嵌Grok或闭合Shadow DOM。

选择规则参考作者公开源码/文档，未复用其凭证和API抓取逻辑：
- https://github.com/Eshaan-Nair/ArcRift/blob/main/PLATFORM_SELECTORS.md
- https://github.com/zero-gate-org/ChatVault
- https://github.com/pionxzh/chatgpt-exporter/blob/master/src/page.ts

以下为历史验收，当前以本节和本包JSON为准。

---

# v1.0.4 问题与回答拆分修复

2026-11-05。用户截图确认v1.0.3会把一个问答组误列为用户消息。本轮修复data-turn-key包裹整个问答组的情况：按用户气泡与回答区域拆成两条独立消息；同一回答下多段Markdown、代码和图片保留在同一回答中；共享搜索ID加角色区分，避免去重误删。排除另一条消息的资源，防止只选问题时混入回答图表。

新增问答共用轮次和搜索ID的回归，验证两条消息、角色、独立ID、预览边界和多块回答保留。真实浏览器场景改为共用同一个问答容器，验证只选回答导出的Markdown含回答和完整代码、不含问题。

构建通过；30/30单元测试、12/12真实MV3浏览器测试通过。测试仍使用合成DOM，尚未直接读取用户当前登录页面。安装后刷新扩展及ChatGPT页面，确认版本1.0.4。原先4个问答组应显示为8条独立消息（以页面实际可访问内容为准）。

以下为历史报告，当前结果以本节和test-output中的JSON为准。

---

# v1.0.3 消息发现修复（2026-11-05）

用户截图显示真实页面有正文但识别为0。本轮参考 https://github.com/pionxzh/chatgpt-exporter/blob/master/src/page.ts 和 src/exporter/image.ts 中的新版DOM标记，独立补充 data-chatgpt-conversation-selection-target、data-turn-key、data-chatgpt-search-message-ids 发现规则，以及可见署名、用户气泡和助手正文的角色识别。不按消息奇偶猜角色，不读取登录凭证或调用内部API。由样式识别的角色会在保真报告提示核对。

增加无旧作者属性、嵌套消息标记、旧隐藏会话和未知占位符测试；真实MV3浏览器测试新增新版结构单条回答导出。npm run build通过，29/29单元测试、12/12真实扩展浏览器测试通过，errors为空。实际已登录页面DOM尚未获取，因此不能声称截图所在页面已实测修复。

无消息时新增“保存识别诊断”：仅保存选择器命中数、元素标签、属性名称和祖先可见状态；不保存正文、标题、URL、Cookie或属性中的消息ID。若仍无法识别，可提供该JSON继续精确适配。先停用所有旧版本，加载本包，并刷新ChatGPT网页，扩展管理页版本应显示1.0.3。

下文为v1.0.2历史验收，当前结果以本节和随包test-output中的JSON为准。

---

# v1.0.2 本机验收报告

日期：2026-11-05。以用户提供的 v1.0.1 为修改基础，并与 v1.0.0 比较。本报告记录本轮实际执行结果，替代旧包内报告。没有将合成测试当成当前线上 ChatGPT 全部页面变体的认证。

## 实际运行环境与结果

Windows 本机，Node.js 24.18.0，npm 11.16.0，Playwright 1.64.1，自带 Chromium / Chrome for Testing 156.0.8078.4。使用临时独立浏览器资料目录，真实加载 MV3 扩展；正式测试未使用 Chrome API shim，保留浏览器默认沙箱设置。测试网页由本地 Fixture 拦截提供，没有读取或上传用户真实对话、Cookie 或浏览器资料。

| 检查 | 本轮结果 |
| --- | --- |
| 依赖安装 | `npm ci --ignore-scripts`、`npm install` 均退出 0。依赖安装在项目目录。 |
| 构建 | `npm run build` 通过，含 TypeScript strict 检查、esbuild 和本地字体/许可打包。 |
| 单元测试 | 4 个测试文件，26/26 通过，0 失败。 |
| 真实扩展浏览器测试 | 11/11 组通过，`errors=[]`，真实扩展通信、存储和下载 API。 |
| Markdown | 单条用户消息、间隔助手消息、完整代码、LaTeX、链接、合并表格、资源 ZIP 和 220 条混合消息均通过。 |
| PDF | Chromium 打印引擎生成 4 页横向 A4；独立 pypdf 提取中文、末尾正文、页码及外部链接。Poppler 渲染全部页面并进行视觉复查。 |
| DOCX | python-docx 成功打开，含 2 张可编辑 Word 表格和 7 个嵌入图形；OpenXML 验证标题、五层编号、合并单元格、超链接、OMML 及复杂公式图像回退。 |
| PNG | 深色、640 CSS px、2×、浏览器 DPR 1.5，生成 3 张：1280×4200、1280×4200、1280×2470。Pillow 解码、色彩、宽度、分片顺序和尾部标记通过；逐张视觉复查。 |
| 扩展生命周期 | 实际停止 worker 后发起下一次导出，确认新运行上下文被唤醒；延迟预览握手期间取消后，晚开的标签页自动关闭。 |

测试用例刻意包含失效图片、无目标引用、附件卡片和未知组件，结果正确显示 Partial 及说明。文件成功下载不会据此误报 Complete。

PDF 自动测试调用的是标准 Chromium 打印引擎。日常使用仍须用户在打印对话框选择「另存为 PDF」；扩展无法确认用户最终保存或取消，也无法取得该 PDF 的实际文件大小。

## 本轮修复

1. 隐藏的停止按钮不再误判生成中；选择器预览排除隐藏回答版本和折叠正文。
2. 补充作者正文外的引用、图片、SVG、Canvas、表格等可访问内容，按 DOM 顺序去重；排除消息操作图标。
3. 代码行的 `data-line-number` 元数据不会导致整行正文被删除，保留纯行号栏排除规则。
4. 保留消息根节点的语义及 RTL 方向；无网站消息 ID 时使用稳定的节点 ID，避免向上加载后选择错位。
5. 修复 SVG 重复 xmlns 导致解析失败，保存继承的颜色、描边和字体；保留安全的嵌入图片与本地渐变。清理导致的内容降级会报告。
6. 修复 DOCX 标题层级偏移，以及 div 包裹列表正文时的编号错位。
7. 修复 Markdown 字面列表符号、分隔线和 HTML 实体被误解，保留纯文本显式换行，并限制嵌套表格的行遍历。
8. 空正文、部分解析和未知组件会进入保真度报告，避免无依据的 Complete。
9. 修复取消/切换会话发生在预览握手期间仍打开旧导出的竞态，失败时及时清理任务。预览关闭请求必须精确匹配来源标签、token 和预览 URL，并有安全边界测试。
10. 提取期间若选中消息祖先的样式或可见属性改变，会中止不稳定快照。成功打开工具栏入口后清除旧错误标题。
11. 将浏览器测试改成 Windows 可运行版本，增加机器可读结果和独立文件验证，取消对 Linux 的 python3/Poppler 命令硬编码。

## 已接通的功能

页面浮动入口与工具栏监听器；Shadow DOM 中英双语面板；单消息选择、All/Questions/Answers/None/Invert、Shift 连选、预览展开、定位、选择恢复；SPA 检测、生成中保护、分批提取、取消与进度；共享 AST 和资源解析；四种导出格式；保真度/资源明细、重试及继续部分导出；设置本地保存；运行时代码与数学字体均随包提供。

本地 Fixture 覆盖富文本、五层列表、中文/英文/韩文/日文/阿拉伯文/Emoji、行内与多行公式、矩阵/cases/aligned、Python/C++/JSON/HTML/Mermaid、合并表格和表内公式、透明图与多图、SVG/Canvas、网页引用、附件卡片、写作块、交互当前值、未知内容、失效资源、极长代码和 220 条混合消息。

自动化验证工具栏监听器注册及相同消息入口；没有模拟原生 Chrome 工具栏图标的鼠标点击。

## 已知限制与未执行的线上验证

- 本轮未在用户已登录的 ChatGPT 真实会话中安装/替换扩展，未实测当前线上所有 DOM 变体。请按 README 的人工清单核对真实上传图、生成图、来源卡片、写作块，以及工具栏鼠标点击。自动测试使用真实浏览器和真实扩展，但消息内容来自 Fixture。
- 仅导出当前 DOM 可读取的可见分支。未加载、已被虚拟化回收、关闭的 Shadow DOM、外部 iframe 和隐藏回答不会被伪造恢复。无法证明整段历史已全部加载。
- 附件保留文件名、路径、链接和可见说明，未实现原始附件二进制 ZIP。虚拟化编辑器没有暴露的代码行也无法恢复。
- 复杂 Word 数学公式仍可能使用高清图片及可用 TeX；不声称所有公式均为可编辑 OMML。独立 OpenXML 读取验证已执行，Microsoft Word/WPS GUI 人工打开未执行。
- 交互图表、地图、音视频和 GIF 只能保留当前状态、静态帧、可读文本或链接，不能在静态文件中复现交互。来源不暴露数据时无法恢复完整数据集。
- 图片可能因 CORS、过期链接、跨域画布或预算而不可获取；保留占位并报告。只在网页明确暴露并成功读取候选时采用候选高清资源，不保证候选就是原始文件。
- 超过 3000 节点的 SVG 仅复制前 3000 节点的计算样式并报告。安全清理会移除 SVG 的主动内容和无法保留的外部引用/foreignObject。
- 极大图形或单个表格行可能跨 PNG 分片并提示。浏览器缩放百分比及全部纸张/主题/倍率组合未逐一测试；本次覆盖 DPR 1.5、PNG 2×、深色与横向 A4。
- 无网站 ID 的消息若被 React 完全替换，将按新节点处理，不冒险把原选择赋给另一条消息。

最低声明支持 Chrome 131（页码使用 CSS 打印页边距盒）；本次实际验证的是 Chromium 156，没有运行 Chrome 131。构建需要 Node.js 22.12+。

## 安装、复测与维护

安装步骤见 `INSTALL.zh-CN.md`。完整包根目录运行：

```powershell
npm install
npm run build
npm test
python -m pip install pypdf python-docx Pillow
npx playwright install chromium
npm run test:browser
```

`PYTHON_BIN`、`CHROMIUM_BIN`、`PLAYWRIGHT_BROWSERS_PATH`、`EXPORT_TEST_OUTPUT` 可指定本机路径；`HEADED=1` 显示测试窗口。机器可读结果在 `test-output/unit-results.json` 与 `test-output/browser-results.json`。交付的测试证据目录保留结果和四种格式的样本。内容均为合成数据。

ChatGPT 网页改版优先修改 `src/adapter.ts` 的作者、轮次、可见性及组件选择规则；具体内容和公式解析在 `src/extract.ts`；类型在 `src/model.ts`；资源处理在 `src/export/assets.ts`；各格式渲染在 `src/export/`。先添加结构 Fixture 回归，再运行单元与真实扩展测试。

参考：[Playwright 扩展测试说明](https://playwright.dev/docs/chrome-extensions)、[Chrome 扩展端到端测试](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)。默认采用 Playwright 自带 Chromium，以保证测试加载扩展的能力。
