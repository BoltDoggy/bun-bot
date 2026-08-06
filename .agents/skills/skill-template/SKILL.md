---
name: skill-template
description: 当用户要求创建新技能、或想了解 .agents/skills 技能格式时使用；内含技能目录结构与 SKILL.md 编写规范。
---

# skill-template — 新技能模板

## 什么时候用

- 用户要求"新建一个技能"、"添加 SKILL.md"或询问 .agents/skills 的目录规范时。

## 技能目录结构（两种形态，任选其一）

```
.agents/skills/
├── <技能名>/          # 目录型：技能名即目录名（推荐，可附带支持文件）
│   ├── SKILL.md       # 技能定义：frontmatter(name/description) + 正文指令
│   └── scripts/       # 可选：技能需要的脚本/模板等支持文件
└── <技能名>.md        # 单文件型：轻量技能直接放一个 md 文件
```

## SKILL.md 写法

1. 开头用 `---` 包裹 YAML frontmatter，至少声明 `name`（技能名）与 `description`（何时触发该技能）。
2. description 要具体、写"什么时候用"，避免泛泛而谈导致误触发。
3. 正文用中文写详细步骤指令，越具体越容易被 agent 正确执行。
