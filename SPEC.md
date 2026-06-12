# OKX MCP · 技能知识谱 设计规范

> 版本 v0.1 · 2026-06-11 · 待确认

---

## 一、核心理念

**不是工具集，是知识谱。**

每次 Agent 使用技能 → 产生知识 → 沉淀进向量库 → 下次更聪明。
最终形成一张自生长的技能知识图谱：节点是技能，边是依赖与知识流。

---

## 二、技能分层（4层）

```
Layer 3  工作流技能 (Workflow)    多步骤、有决策、有副作用
              ↑ 依赖
Layer 2  分析技能 (Analysis)      模式识别、异常检测、洞察生成
              ↑ 依赖
Layer 1  复合技能 (Compound)      组合多个原子技能，加计算
              ↑ 依赖
Layer 0  原子技能 (Atomic)        单次 API 调用，返回归一化数据
```

**规则：Layer N 只能依赖 Layer < N 的技能，不得跨层反向依赖。**

---

## 三、技能分类与边界

### 按操作类型（读/写/算）

| 类型 | 说明 | 鉴权要求 | 风险等级 |
|------|------|----------|----------|
| `read·public`  | 公共行情数据 | 无 | 🟢 安全 |
| `read·private` | 账户/持仓/订单 | API Key | 🟡 需鉴权 |
| `compute`      | 本地计算，不打 API | 无 | 🟢 安全 |
| `write·order`  | 下单/撤单 | API Key + 二次确认 | 🔴 需确认 |
| `write·memory` | 写入知识库 | 无 | 🟡 可撤销 |

### 按数据来源

```
okx_public   → OKX 公共接口（行情、产品、资金费率）
okx_private  → OKX 私有接口（账户、交易）
outcomes     → H Rails P1（OKX 预测市场，staging）
computed     → 本地计算（套利分析、统计、指标）
knowledge    → 向量库（历史知识检索）
```

---

## 四、规则清单

### R1 · 单一职责
每个技能只做一件事。`get_ticker` 只拿价格，不做分析，不写库。

### R2 · 归一化输出
所有技能返回统一格式：
```json
{
  "ok": true,
  "skill": "get_ticker",
  "source": "okx_public",
  "data": { ... },
  "meta": { "ts": "ISO8601", "latency_ms": 42 }
}
```

### R3 · 幂等性
`read` 和 `compute` 类技能：相同输入 → 相同输出。不得有隐藏副作用。

### R4 · 写操作必须二次确认
任何 `write·order` 类技能，Agent 必须在工具描述里声明：
> "⚠️ 此操作会产生真实订单，调用前必须向用户确认。"

### R5 · 知识过滤门槛
进入向量库的条件（全部满足）：
1. `ok: true`（调用成功）
2. 余弦相似度 < 0.92（与已有条目不重复）
3. 数据有实质内容（非空、非默认值）
4. 不包含账户私密信息（余额、API Key）

### R6 · 技能版本化
破坏性变更必须新建版本（`get_ticker_v2`），旧版本标记 `@deprecated`，不删除。

### R7 · 测试覆盖
每个技能必须有对应测试，实测通过后才能标记 `status: verified`。

---

## 五、流程定义

### 5.1 标准调用流程

```
Agent 发起调用
    │
    ▼
[鉴权检查] ── 不通过 ──► 返回 PermissionError
    │通过
    ▼
[执行技能] ── 失败 ────► 返回错误，不入库
    │成功
    ▼
[知识过滤] ── 不通过 ──► 直接返回结果（不入库）
    │通过
    ▼
[向量化 + 入库]
    │
    ▼
返回结果给 Agent
```

### 5.2 知识检索流程（Agent 提问时）

```
Agent 提问
    │
    ▼
[向量搜索知识库] → 找到相关条目（sim > 0.75）
    │                    │
    │有命中               │无命中
    ▼                    ▼
[返回历史知识]      [调用 API 拿新数据]
+ 时间戳 + 来源          │
    │                    ▼
    │              [知识过滤 → 入库]
    │                    │
    └────────────────────┘
                         ▼
                   返回给 Agent
```

### 5.3 技能上线流程

```
编写技能代码
    → 写单元测试
    → 实测通过（打真实 API）
    → 在知识库 HTML 标记 ✅ verified
    → 更新技能知识谱图
    → 可被 Agent 调用
```

---

## 六、技能知识谱（初版图谱）

```
                        ┌─────────────────────────────────────┐
  Layer 3               │  scan_arb_opportunities              │
  工作流                │  monitor_price_alert                 │
                        │  generate_market_report              │
                        └──────────────┬──────────────────────┘
                                       │ depends on
                        ┌──────────────▼──────────────────────┐
  Layer 2               │  detect_arb          analyse_trend   │
  分析                  │  assess_liquidity    compare_markets │
                        │  recall_similar_pattern              │
                        └──────────────┬──────────────────────┘
                                       │ depends on
          ┌────────────────────────────▼────────────────────────────────┐
  Layer 1 │  get_ticker_pair   get_full_event   get_market_snapshot     │
  复合    │  search_knowledge  store_knowledge                          │
          └────────────────────────────┬────────────────────────────────┘
                                       │ depends on
┌──────────────────────────────────────▼────────────────────────────────────────┐
│  get_ticker      get_orderbook   get_candles    get_instruments               │ Layer 0
│  get_balance     get_positions   get_orders     list_events                   │ 原子
│  get_event       list_markets    get_market     get_trades                    │
│  place_order     cancel_order    embed_text     vector_search                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 七、知识条目 Schema

向量库每条记录的结构：

```python
{
  "id":          "uuid",
  "skill":       "get_ticker",           # 来自哪个技能
  "source":      "okx_public",           # 数据来源
  "layer":       0,                      # 技能层级
  "domain":      "market_data",          # 领域标签
  "query":       "BTC-USDT ticker",      # Agent 的查询意图
  "summary":     "BTC-USDT: 67,234 ...", # 结果摘要（用于向量化）
  "raw_data":    { ... },                # 原始数据（JSON）
  "tags":        ["BTC", "spot", "price"],
  "confidence":  0.98,
  "ts":          "2026-06-11T10:00:00Z",
  "ttl_hours":   24,                     # 有效期，行情数据不宜太长
  "verified":    true
}
```

---

## 八、技能目录（待实现）

### Layer 0 · 原子技能

**OKX 公共行情**
- [ ] `okx_get_ticker`        — 单产品实时 Ticker
- [ ] `okx_get_tickers`       — 批量 Ticker（按类型）
- [ ] `okx_get_orderbook`     — 订单簿深度
- [ ] `okx_get_candles`       — K线数据
- [ ] `okx_get_trades`        — 最新成交
- [ ] `okx_get_instruments`   — 产品列表
- [ ] `okx_get_funding_rate`  — 永续合约资金费率
- [ ] `okx_get_mark_price`    — 标记价格
- [ ] `okx_get_index_price`   — 指数价格
- [ ] `okx_get_open_interest` — 持仓量
- [ ] `okx_get_system_time`   — 系统时间

**OKX 私有账户**
- [ ] `okx_get_balance`       — 账户余额
- [ ] `okx_get_positions`     — 当前持仓
- [ ] `okx_get_order`         — 单笔订单
- [ ] `okx_get_orders_history`— 历史订单

**OKX 交易（写操作）**
- [ ] `okx_place_order`       — 下单 ⚠️
- [ ] `okx_cancel_order`      — 撤单 ⚠️
- [ ] `okx_amend_order`       — 改单 ⚠️

**OKX 预测市场（H Rails）**
- [ ] `outcomes_list_events`  — 事件列表
- [ ] `outcomes_get_event`    — 单个事件
- [ ] `outcomes_list_markets` — 市场列表
- [ ] `outcomes_get_market`   — 单个市场
- [ ] `outcomes_get_ticker`   — 单边 Ticker（YES/NO）
- [ ] `outcomes_get_orderbook`— 订单簿
- [ ] `outcomes_get_candles`  — K线

**知识库**
- [ ] `kb_store`              — 存入知识条目
- [ ] `kb_search`             — 向量语义搜索
- [ ] `kb_get`                — 按 ID 获取条目
- [ ] `kb_list_recent`        — 最近入库条目

### Layer 1 · 复合技能
- [ ] `outcomes_get_ticker_pair`  — YES+NO 双边（含套利分析）
- [ ] `outcomes_get_full_event`   — 事件+所有市场+价格
- [ ] `okx_get_market_snapshot`   — 产品快照（ticker+ob+candles）

### Layer 2 · 分析技能
- [ ] `outcomes_detect_arb`       — 互补套利检测
- [ ] `okx_analyse_trend`         — 价格趋势分析
- [ ] `kb_recall_similar`         — 检索历史相似情况

### Layer 3 · 工作流技能
- [ ] `outcomes_scan_arb`         — 全市场套利扫描
- [ ] `okx_market_report`         — 市场日报生成

---

## 九、代码质量标准（强制）

### Q1 · 实测才算完成
每个技能必须打真实 API 验证响应，测试通过后才能标记 `status: verified`。
Mock 测试只用于单元逻辑，不能替代真实调用。

### Q2 · 代码整洁规则
- 函数 ≤ 30 行，只做一件事
- 所有参数和返回值必须有类型注解
- 命名自解释，不需要解释"做什么"的注释
- 不留 TODO、死代码、调试 print
- 能删的全删，不能删的有存在理由

### Q3 · 每个技能的完整交付物
```
src/tools/okx_market.py          ← 技能实现
tests/test_okx_market.py         ← 测试文件
```
测试文件模板：
```python
# tests/test_okx_market.py
import pytest
from src.tools.okx_market import okx_get_ticker

@pytest.mark.asyncio
async def test_get_ticker_btc():
    result = await okx_get_ticker(inst_id="BTC-USDT")
    assert result["ok"] is True
    assert result["data"]["last"] > 0

@pytest.mark.asyncio
async def test_get_ticker_invalid():
    result = await okx_get_ticker(inst_id="INVALID-PAIR")
    assert result["ok"] is False
```

### Q4 · 审核检查单（每个技能上线前）
- [ ] 代码通过 `ruff check`（无 lint 错误）
- [ ] 类型注解完整（mypy 无报错）
- [ ] 真实 API 调用测试通过
- [ ] 异常处理完整（网络错误、鉴权错误、数据错误）
- [ ] 返回格式符合 Rule R2（统一 ApiResponse）
- [ ] 知识库 HTML 状态更新为 ✅

---

## 十、待确认问题

1. 向量库选型：**ChromaDB**（本地简单）还是 **Qdrant**（更易扩展到云端）？
2. 向量化模型：**本地 sentence-transformers** 还是调 **Claude/OpenAI embeddings API**？
3. 知识条目 TTL：行情数据多久过期？（建议：ticker=1h，事件=24h，套利信号=30min）
4. 写操作（下单）是否在 v1 范围内，还是先做纯读？
5. 技能知识谱可视化：单独页面，还是集成到现有知识库 HTML？
