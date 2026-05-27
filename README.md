# 大盘云图 - 本地复刻版

一个本地化的股票市场热力图可视化应用，展示中国A股市场的实时行情数据。

## 功能特性

- 📊 **实时行情展示** - 展示A股全市场、沪深京创四大市场的实时股票行情
- 🗺️ **热力图可视化** - 用Treemap图表直观展示股票涨跌情况
- 📈 **多维度分析** - 支持涨跌幅、周/月/年涨跌幅等多种指标
- 🔄 **实时数据更新** - 每日自动更新股票数据
- 🌐 **本地服务** - 可在本地运行，无需依赖外部网站

## 项目结构

```
.
├── server.js              # Node.js服务器（静态文件+API代理）
├── app.js                 # 前端应用入口逻辑
├── index.html             # 应用主页面
├── styles.css             # 样式表
├── mapData.js             # 地图数据配置
├── *.min.js               # 经过压缩的JavaScript文件
└── restart-server.bat     # Windows环境下快速重启脚本
```

## 快速开始

### 前提要求

- Node.js 12.0 或更高版本

### 安装和运行

1. **克隆或下载项目**
   ```bash
   git clone https://github.com/ZackKingS/dapanyuntu.git
   cd dapanyuntu
   ```

2. **启动服务器**
   ```bash
   node server.js
   ```

3. **打开浏览器**
   访问 `http://localhost:4173`

### 自定义端口

通过环境变量指定端口：

```bash
# Linux/Mac
PORT=3000 node server.js

# Windows PowerShell
$env:PORT=3000; node server.js
```

### Windows快速重启

直接运行 `restart-server.bat` 脚本：
```bash
restart-server.bat
```

## 市场范围

应用支持以下市场视图：

- **A股全图** - 所有A股上市公司
- **上证A股** - 上海证券交易所
- **深证A股** - 深圳证券交易所
- **北交所A股** - 北京证券交易所
- **科创板** - 上交所科创板
- **创业板** - 深交所创业板

## 分析指标

支持的数据指标：

- 涨跌幅（实时）
- 近1周涨跌幅
- 近2周涨跌幅
- 近2月涨跌幅
- 年初至今涨跌幅

## 技术栈

- **后端**: Node.js
- **前端**: HTML5 + CSS3 + JavaScript
- **可视化**: Treemap 热力图
- **数据源**: data.dapanyuntu.com API

## 主要功能

- ⏰ 实时时钟显示
- 🔄 一键刷新数据
- 🖥️ 沉浸式全屏模式
- 📅 历史数据查询
- 📱 响应式设计

## 开发

### 本地开发流程

```bash
# 启动开发服务器
node server.js

# 修改代码后，重启服务器即可看到更新
```

### 构建生产版本

编辑相关JavaScript文件并使用压缩工具生成`.min.js`文件。

## API端点（代理支持）

服务器仅允许代理以下端点：

- `/dpyt/getRealtimeIndexes` - 获取主要指数
- `/dpyt/queryCurrentVerion` - 查询版本信息
- `/dpyt/getMapParamDataV3` - 获取实时行情数据
- `/dpyt/getMapParamDataV2` - 获取历史数据
- `/dpyt/getHistoryRateByDate` - 获取历史涨跌幅
- `/dpyt/getDayRecallRate` - 获取复盘数据

## 许可证

本项目是对大盘云图（https://dapanyuntu.com/）的本地复刻版本。

## 相关链接

- 📌 官方网站: https://dapanyuntu.com/
- 📌 备用地址: https://dpyt.cc/
- 📦 GitHub: https://github.com/ZackKingS/dapanyuntu
