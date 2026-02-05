# Huxiu RSS (Node.js + GitHub Pages)

使用 Node.js 抓取虎嗅移动端首页并生成 `public/rss.xml`，发布到 GitHub Pages 作为静态文件托管。

## 功能

- 从虎嗅移动端首页提取 `window.__NUXT__` 数据
- 生成 RSS 2.0 格式的 XML 订阅源
- 输出静态文件：`public/rss.xml`
- 提供静态健康检查：`/healthz`
- GitHub Actions 每日 UTC 09:00 生成并发布到 GitHub Pages

## 项目结构

```
.
├── scripts/generate-rss.mjs     # Node.js 生成脚本
├── public/rss.xml               # 生成的 RSS（由 CI/本地脚本生成）
├── public/healthz.txt           # 健康检查静态文件
├── package.json                 # Node.js 依赖和脚本
└── README.md                    # 本文件
```

## 本地开发

### 安装依赖

```bash
npm install
```

### 生成 rss.xml

```bash
npm run generate
```

生成结果在：

- `public/rss.xml`
- `public/healthz.txt`

## 发布到 GitHub Pages

工作流：`.github/workflows/pages.yml`，每日 **UTC 09:00** 运行并发布 `public/`。

需要在仓库 Settings 中启用 Pages：

- Settings → Pages → Source 选择 “GitHub Actions”

## 配置环境变量

可以在 GitHub Actions 中设置以下环境变量（可选）：

- `FETCH_RETRY_MAX`: 可选；拉取 `m.huxiu.com` 失败重试次数（默认 3）
- `FETCH_RETRY_BASE_DELAY_MS`: 可选；重试基础延迟（默认 500ms，指数退避+抖动）
- `FETCH_RETRY_MAX_DELAY_MS`: 可选；单次重试最大延迟上限（默认 8000ms）

## 技术栈

- **Node.js**: JavaScript 运行时
- **GitHub Actions**: 定时生成与部署
- **GitHub Pages**: 静态托管

## 许可证

MIT
