## 类型

<!-- 选择一个：Skill / Fix / Meta -->

## Skill 描述

### 功能

<!-- 一句话描述这个 Skill 做了什么 -->

### 场景

<!-- 用于什么场景，解决什么问题 -->

### 解决了什么痛点

<!-- 引用 Issue 编号或反馈条目 -->

### 调用的原子工具

<!-- 列出 Skill 内部串联了哪些工具 -->

### 参数

<!-- 列出 Skill 的参数和说明 -->

### 返回示例

<!-- 描述返回数据的结构（选填） -->

## 自检

- [ ] `npm run build` 通过
- [ ] 8 字段描述完整（功能/场景/关键词/参数/鉴权/风险/返回量/关联）
- [ ] 时间戳包含 `tsIso`
- [ ] 使用 `toResult()` / `toError()` 统一格式
- [ ] 使用 `INST_TYPE_*` 枚举（如涉及产品类型）
- [ ] 并行调用使用 `Promise.allSettled`

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
