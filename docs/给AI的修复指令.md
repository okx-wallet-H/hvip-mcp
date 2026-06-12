# 给 AI 的修复指令

你面前是 hvip-mcp-server 项目，`src/tools/` 下面有 18 个工具文件。其中 3 个文件里有部分工具还在用老格式描述需要升级。

## 你要改什么

### 文件 1：`src/tools/public.ts`

8 个工具的 description 现在是老格式（一句话），全部改成 8 字段模板。**不动函数体、不动参数名、不动 API 调用逻辑，只改 description 字符串。**

| 工具 | 改什么 |
|------|--------|
| `okx_get_mark_price` | description 换成 8 字段模板 |
| `okx_get_index_price` | description 换成 8 字段模板 |
| `okx_get_open_interest` | description 换成 8 字段模板 |
| `okx_get_system_time` | description 换成 8 字段模板 |
| `okx_get_opt_summary` | description 换成 8 字段模板 |
| `okx_get_insurance_fund` | description 换成 8 字段模板 |
| `okx_convert_contract_coin` | description 换成 8 字段模板 |
| `okx_get_announcements` | description 换成 8 字段模板 |

### 文件 2：`src/tools/algo.ts`

4 个工具老格式描述，全部换成 8 字段：

| 工具 | 改什么 |
|------|--------|
| `okx_get_algo_orders` | 整段 description 换成 8 字段模板 |
| `okx_get_algo_orders_history` | 整段 description 换成 8 字段模板 |
| `okx_place_algo_order` | 整段 description 换成 8 字段模板 |
| `okx_cancel_algo_order` | 整段 description 换成 8 字段模板 |

### 文件 3：`src/tools/trading.ts`

这个文件整体是老格式。按 8 字段模板重写所有工具的 description。注意 `okx_place_order` 参数里有个 `sz`，保持不改。

### 文件 4：`src/tools/account.ts`

只改 `okx_convert_trade` 一处：当前已经是 8 字段格式，确认参数 `sz` 的描述里有中文说明即可。

---

## 8 字段模板格式

每个工具的 description 必须包含以下 8 个段落，中间用 `\n` 分隔：

```
## 功能：一句话说清这个工具做什么
## 场景：用于{场景1}、{场景2}、{场景3}
## 关键词：{3-8 个逗号分隔的中文搜索词}
## 参数：
##   - {param}: {中文解释}。{可选值说明}
## 鉴权：{PUBLIC — 不需要 API Key | ⚠️ 需要 API Key（只读）| 🔴 需要 API Key（交易）}
## 风险：{READ | WRITE | FUND_TRANSFER | ADMIN}
## 返回量：{微小 | 中等 | 大量} ~{预估KB数}
## 关联：{前置工具} → 本工具 → {后续工具}
```

## 参考样本

打开 `src/tools/market.ts`，看 `okx_get_ticker` 的描述。照它的格式写。

## 绝对禁止

- ❌ 不改函数体（async 块）
- ❌ 不改参数名字
- ❌ 不改 `z.enum()` `z.string()` 这些
- ❌ 不改 API 调用
- ❌ 自己编路径或参数（都有现成的，只改描述）

## 改完后

跑一下 `npm run build`，确认编译通过。然后把改过的文件发我。
