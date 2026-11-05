# 本地安装与复测

本包已含构建产物，安装使用无需 Node.js。

1. 将 ZIP 完整解压到固定目录。
2. Chrome 地址栏打开 `chrome://extensions`，停用已安装的旧版 ChatGPT Rich Exporter。
3. 打开右上角「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择本包的 `chatgpt-rich-exporter/dist` 文件夹。该文件夹内应直接有 `manifest.json`。若下载的是仅扩展包，则直接选择解压后的扩展文件夹。
5. 刷新 ChatGPT 网页，点击页面右侧「导出」，选择所需消息和格式。

PDF 需要在 Chrome 打印对话框选择「另存为 PDF」；其余格式通过预览页下载。资源缺失会显示 Partial 和具体原因，可重试或继续部分导出。

最低声明版本为 Chrome 131；本次实际测试版本为 Chromium 156。只读取当前网页已加载的可见分支，不保证已加载完整历史。扩展不自动读取附件原始二进制内容。

源码修改后，在项目根目录运行：

```powershell
npm install
npm run build
npm test
python -m pip install pypdf python-docx Pillow
npx playwright install chromium
npm run test:browser
```

随后在 `chrome://extensions` 点击此扩展的刷新按钮，再刷新 ChatGPT 网页。

网页布局变更时先检查 `src/adapter.ts`；组件内容和公式识别在 `src/extract.ts`。实际测试证据和已知限制见 `VERIFICATION.md`。
