# RE-SillyTavern

基于 [SillyTavern](https://github.com/SillyTavern/SillyTavern) v1.18.0 的个人功能分支，主要面向长篇角色扮演、DeepSeek 前缀缓存、累计剧情记忆、结构化主角状态，以及 ComfyUI 小说背景自动生成。

项目保留 SillyTavern 原有功能和数据格式。新增能力尽量作为内置扩展实现，避免要求数据库参考插件或其他第三方扩展必须处于运行状态。

## 主要改造

### 1. DeepSeek 前缀缓存与本轮输入锚点

#### 需要解决的问题

Memory、世界书、作者注释和主角状态如果放在提示词前部，会频繁改变长上下文的前缀，降低 DeepSeek/Claude 的缓存命中率；全部放到聊天末尾后，模型又可能在多段动态内容中忽略用户本轮真正的输入。

#### 实现路径

- 动态扩展内容统一通过 `IN_CHAT @ Depth 0/1` 注入到历史消息末端，保留前方系统提示、角色卡和历史对话的稳定前缀。
- Chat Completion 的 `normal`、`swipe` 和 `regenerate` 请求在所有动态注入完成后，追加一条不持久化的 User 锚点：

  ```text
  以下是用户本轮输入：
  “用户原文”
  ```

- 锚点只复述用户手写文本，不重复附件或媒体正文；预算不足时退化为给原始临时 User 消息添加标题。
- `quiet`、`continue`、`impersonate`、扩展后台 API 和 Text Completion 不添加锚点。
- DeepSeek 自身会执行 `SEMI_TOOLS` 消息兼容处理，因此原生 DeepSeek 的自定义提示词后处理建议保持 `None`，避免再次重排角色。

主要代码：

- `public/scripts/latest-user-input-anchor.js`
- `public/scripts/openai.js`
- `src/prompt-converters.js`

### 2. Memory Summary：累计时间线记忆

#### 需要解决的问题

普通摘要容易丢失时间跨度、地点、重要对话和关系转折；只发送增量虽然节省单次 Token，但会削弱完整上下文和前缀缓存的稳定性。

#### 实现路径

- 每次总结新增一个 `[Stage N]`，旧 Stage 不被覆盖。
- 时间线模式固定生成时间跨度、地点、纪要、最多三条重要对话和简短概览。
- 累计批次保持同一起点并逐批扩大终点，例如 `1–10`、`1–20 + 旧 Memory`、`1–30 + 全部旧 Memory`。
- `promptWords` 只控制纪要正文的目标长度，不挤占时间、地点和概览字段。
- Main API 与 Custom API 使用同一套提示词和累计批次逻辑。
- 自动频率按最近一次成功 Summary 标记之后的 Assistant 回复数计算；手动总结和自动总结共享标记。
- 大面板集中管理 Summary、API、频率、注入位置和提示词；左下角魔棒菜单可直接打开。

主要代码：`public/scripts/extensions/memory/`。

### 3. Protagonist State：结构化主角状态

#### 需要解决的问题

完整剧情应该保存在 Memory，但地点、时间、身份、关系、技能、物品和任务等当前事实需要结构化读取。模型返回的表格操作还可能包含空 `row_id`、非法字段、错误删除或过期异步结果，导致“API 返回成功但表格没有变化”。

#### 实现路径

- 状态保存在聊天消息的 `TavernDB_ACU_IsolatedData` 快照中，不依赖数据库参考插件的实时全局对象。
- 使用七张活动表：全局状态、主角信息、重要角色、主角技能、背包物品、任务与事件、选项。
- 新聊天没有快照时自动创建规范模板；残缺快照只补充缺失表，不覆盖已有表和自定义表。
- 非法、空值和重复 `row_id` 在发送给模型前自愈为稳定正整数。
- 模型只能输出严格 `<tableEdit>`，整批操作按原顺序解析、校验并在工作副本执行。
- 未知表、未知行、未知字段、修改 `row_id`、非法值或禁止操作会让整批回滚，不产生成功标记。
- API 更新固定写入请求发起时的 Assistant 消息；聊天切换、目标被编辑/删除/重生成或出现更新回复时，旧结果被丢弃。
- Memory 保存完整历史；状态表只保存当前事实与长期有效结论。角色关系履历采用覆盖式压缩，避免复制场景流水账。
- 设置页、底部状态栏和大尺寸导航弹窗共享编辑与保存逻辑；Memory Summary 在状态弹窗中只读显示。

主要代码：`public/scripts/extensions/protagonist-state/`。

### 4. ComfyUI 自动小说背景

#### 目标

每轮剧情结束后，根据最新场景自动生成无人物背景；同一场景不重复生成，明确转场时才调用 ComfyUI。自动背景使用独立工作流，不覆盖普通人物立绘或其他图像生成配置。

#### 运行 ComfyUI Windows Portable

推荐只监听本机：

```powershell
Set-Location D:\ComfyUI_windows_portable
.\python_embeded\python.exe -s .\ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1
```

浏览器访问 <http://127.0.0.1:8188>。SillyTavern 的 ComfyUI 地址同样填写 `http://127.0.0.1:8188`。

#### 准备 API Format 工作流

1. 在 ComfyUI 中加载并实际运行一次 UI 工作流。
2. 在设置中开启 Dev Mode。
3. 通过“工作流操作 → 导出 (API)”保存 API 工作流。
4. API JSON 最外层应是节点 ID；如果仍包含顶层 `nodes` / `links`，它仍然是 UI 工作流，不能用于 ST。
5. 至少在两个 `CLIPTextEncode` 节点和 `KSampler` 节点中分别替换正面提示词、负面提示词和随机种子：

   ```json
   "2": { "inputs": { "text": "%prompt%" }, "class_type": "CLIPTextEncode" },
   "3": { "inputs": { "text": "%negative_prompt%" }, "class_type": "CLIPTextEncode" },
   "5": { "inputs": { "seed": "%seed%" }, "class_type": "KSampler" }
   ```

   上面的片段只展示动态字段，不能代替完整节点；模型、CLIP 连接、正负条件和 latent 连接必须保留。还可以使用 `%steps%`、`%scale%`、`%width%`、`%height%`、`%sampler%` 和 `%scheduler%`。

6. 在 ST 的 ComfyUI 工作流编辑器中新建并粘贴 JSON，或将文件放入：

   ```text
   data/<用户名>/user/workflows/
   ```

本分支本地配置使用 `Novel_Background_Juggernaut.json`：Juggernaut XL、1344×768、20 步、CFG 4.5、`dpmpp_2m_sde + karras`。背景工作流固定分辨率和采样器，只动态替换提示词与种子，避免 ST 的通用 512×512/其他采样器设置意外覆盖背景参数。

#### 自动生成流程

1. 监听真实剧情 Assistant 回复，忽略 User、System、空消息和扩展生成的背景媒体消息。
2. 使用 quiet Main API 分析最新 Assistant 剧情；前一条 User 输入、主角状态的时间地点和最新 Memory Stage 仅作辅助。
3. 模型严格返回稳定的 `scene_key` 与英文、无人物的背景提示词。
4. “场景变化时”模式比较上次成功保存的 `scene_key`；相同场景不调用 ComfyUI。
5. “每 N 轮”只统计真实 Assistant 剧情回复，并从上次成功背景重新计数。
6. “仅手动”不进行后台场景检测；“立即生成当前背景”始终从当前聊天查找最新真实 Assistant 回复。
7. ComfyUI 成功后切换聊天背景，并可追加一条可见的系统媒体卡片。该卡片不会进入后续剧情提示词，也不会计入 Memory、主角状态或背景轮数。

#### 并发与数据安全

- 每次任务固定绑定发起时的聊天和 Assistant 消息。
- 聊天切换、消息编辑/删除/重生成、更新回复覆盖旧目标时，过期结果不会应用。
- 同时只运行一个后台任务；更新目标会中止并替换旧任务。
- 失败的场景分析、无效工作流、ComfyUI 离线和聊天保存失败均不写成功标记，可在下一轮重试。
- 独立工作流通过单次请求参数传入，不修改全局 `comfy_workflow`，避免普通图片生成串用背景工作流。

#### 已解决的手动按钮问题

“立即生成当前背景”不提供具体消息编号，代码需要从聊天末尾寻找最新 Assistant 回复。旧实现中 `Number(null)` 被转换成 `0`，错误选择了第 1 条消息，随后又被过期目标保护静默丢弃，因此点击后没有任何反应。

当前实现保留“未提供消息编号”这一状态，只把有效的非负整数当作明确消息 ID；手动触发会正确选择最新剧情回复。对应回归测试覆盖 `null`、`undefined`、空字符串、数字 `0` 和数字字符串。

主要代码：

- `public/scripts/extensions/stable-diffusion/index.js`
- `public/scripts/extensions/stable-diffusion/auto-background.js`
- `public/scripts/extensions/stable-diffusion/settings.html`
- `test-auto-background.mjs`

## 常见故障解决

### 点击“立即生成当前背景”没有反应

- 先按 `Ctrl + F5`，避免浏览器继续使用旧扩展脚本。
- 确认当前聊天至少有一条真实 Assistant 剧情回复。
- 确认图像来源是 ComfyUI，背景工作流已经选择，连接按钮显示成功。
- 状态应先变为“正在分析或生成背景……”。若没有变化，检查浏览器控制台中的 `[AutoBackground]` 日志。

### 提示 UI Format 工作流

重新从 ComfyUI 导出 `Export (API)`。不要直接把包含 `nodes` 和 `links` 的画布工作流导入 ST。

### ComfyUI 报模型或节点缺失

先在 ComfyUI 页面中独立运行工作流。确认 checkpoint、VAE、ControlNet 和所有自定义节点均已安装。自动小说背景建议使用纯文生图工作流，避免依赖每次都要上传的 `LoadImage` 参考图。

### ComfyUI 可以出图，但 ST 不切换背景

- 检查任务期间是否切换了聊天、编辑/删除了目标回复，或产生了新的 Assistant 回复；这些情况会主动丢弃旧结果。
- 检查聊天能否正常保存。没有实际聊天文件的欢迎页可以临时切换背景，但无法可靠保存背景标记和媒体卡片。

### `8000` 端口已被占用

在 PowerShell 中查看占用者：

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id <OwningProcess>
```

确认是旧 SillyTavern 实例后再停止对应进程，或者修改 `config.yaml` 中的 `port`。

## 开发与验证

项目要求 Node.js 20 或更高版本：

```bash
npm start
```

前端扩展的快速语法和逻辑测试：

```bash
node --check public/scripts/extensions/stable-diffusion/index.js
node --check public/scripts/extensions/stable-diffusion/auto-background.js
node test-auto-background.mjs
node test-protagonist-state.mjs
node test-memory.mjs
node test-latest-user-input-anchor.mjs
```

浏览器会积极缓存扩展资源。修改 `index.js`、`settings.html` 或 `style.css` 后，需要 `Ctrl + F5` 强制刷新。

## Upstream Resources

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

## License

AGPL-3.0
