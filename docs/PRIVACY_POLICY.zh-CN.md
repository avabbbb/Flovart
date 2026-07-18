# Flovart 隐私政策

状态：公开发布前草案。本政策在官方公开版本链接并展示后生效。

政策版本：1.0-draft

发布者：Flovart，由香港个人开源开发者 [@avabbbb](https://github.com/avabbbb) 发布和维护（下称“Flovart”或“我们”）。

主要法域：中华人民共和国香港特别行政区。

[English controlling version](./PRIVACY_POLICY.md)

本政策说明位于 `https://avabbbb.github.io/Flovart/` 的 Official WebUI、Desktop Edition、Edge Extension 及相关项目功能如何处理数据。英文版为控制版本；本中文版为完整官方翻译。你所在地依法不得排除的强制性权利不受语言条款影响。

Flovart 是本地优先创作工具。默认情况下，官方 Desktop Edition 不要求账号，发布者也不运营用于保存 Workflow、提示词、生成文件或 API Key 的托管后端。

本政策不适用于你选择的第三方 AI Provider、自定义端点、浏览器厂商、操作系统、备份服务、扩展商店、支付服务、网站或独立部署；这些主体适用自己的政策。

## 1. 本地存储的数据

根据使用功能，Flovart 可能在你的设备、浏览器或应用配置中保存：

- Provider 设置和 API Key。当前 Desktop Edition 与 Official WebUI 会由应用加密 Provider Secret，再写入对应 WebView 或浏览器配置中基于 `localforage` / IndexedDB 的、按 origin 隔离的 Browser Secret Vault。这属于应用层加密的浏览器存储，并非操作系统凭据库。官方 Edge Extension 不保存 Provider Secret。
- Workflow 项目、节点、布局、媒体、提示词和生成配置。
- 生成的图片、视频、引用、预览和元数据。
- 模型偏好、自定义端点、主题、语言和布局设置。
- 素材库、历史记录、固定结果和本地运行信息。
- 你启用的浏览器导入偏好。

存储位置可能包括 IndexedDB、用于少量非业务偏好的 localStorage、扩展本地存储、应用数据目录、本地文件、操作系统缓存、浏览器配置和你配置的备份系统。

Official WebUI 与 Desktop WebView 目前各自创建按 origin / profile 隔离的工作区，不能静默读取彼此的 IndexedDB、其他网站存储、Windows Credential Manager 或 Edge Extension storage。用于明确共享项目、并在不暴露原始 Secret 的前提下调用 Provider 的受限 Local Data Service 尚在规划中，当前版本跨入口移动数据需分别导出、导入。

## 2. 默认不由发布者运营的云端处理

默认情况下，Flovart 不为本地项目运行中央账号、提示词数据库、媒体数据库或 API Key 数据库，也不销售个人信息，不包含由发布者运营的广告追踪、行为画像或产品分析。

如果你使用自托管或 SaaS Community Hub / Enterprise API，该部署可能保存账号凭据、JWT、组织、部门、角色和社区内容。该部署的运营者是相应的数据控制者或个人信息处理者，并应提供自己的隐私政策；开源发布者不会仅因提供源代码而承担独立部署的运营责任。

## 3. 第三方 AI Provider 与自定义端点

使用 AI 功能时，Desktop Edition 会从你的设备向你配置的 Provider 或端点发送请求。请求可能包含：

- API Key 或认证令牌；
- 文本提示词与指令；
- 图片、视频、文件、蒙版、引用或附件；
- Workflow 上下文、节点输入、生成结果和元数据；
- 模型名称、端点地址、请求参数和运行信息。

第三方可能按照自己的协议收集、处理、保留、审核、训练、披露数据或收取费用。使用前应自行审查对方政策和身份。只应连接你信任并理解其数据去向的自定义端点。

## 4. Edge Extension 数据

官方 Edge Extension 是 Desktop Edition 与 Official WebUI 的薄伴侣，不保存 Provider Secret、不向 Official WebUI 披露原始 Secret，也不直接调用 AI Provider。

仅在用户主动导入后，扩展版本才可能按该已安装版本展示的权限与能力访问选中文本、用户选择的图片或图片 URL、基础图片信息，或者当前可见标签页截图。当前页面 URL 与标题可能作为来源信息随导入项发送。

官方扩展不扫描页面中的全部图片，也不设计为收集浏览历史、键盘输入、密码、Cookie、认证令牌、后台页面活动或用户未操作标签页的内容；默认不出售数据、不投放广告，也不向发布者发送扩展分析数据。

允许 Official WebUI 访问获批项目数据与类型化 Runtime 动作的可撤销 Trusted Web Bridge 尚在规划中，当前版本并未提供。未来桥接必须限制允许的 origin，使配对和数据访问在 Desktop Edition 与扩展中可见、可撤销，并且不得提供返回原始 Provider Secret 的操作。

Desktop Edition 只有在用户发起或批准相关动作后，才可能把导入内容继续发送给 Provider 或自定义端点；此时适用该第三方政策。

## 5. 数据安全

本地系统也可能受到设备入侵、恶意软件、浏览器配置访问、同步账户、云备份、共享电脑、不可信扩展、不可信端点或错误配置影响。你负责保护设备、浏览器、操作系统、备份、导出文件和 API Key。

怀疑 Key 泄露时，请立即到对应 Provider 撤销并重新创建。发布者通常无法访问或恢复仅保存在你设备上的 Key 和项目。

## 6. 保留与删除

你可以通过应用内删除、清除相应站点或应用数据、删除应用数据目录、卸载扩展、清除扩展偏好，或删除导出文件和备份来移除本地数据。

官方 Edge Extension 不保存 Provider Secret。卸载扩展或清除扩展数据可删除其非秘密偏好。当前版本不会自动合并 Official WebUI 与 Desktop Edition 工作区；请分别清理各 origin / profile，或在可用时使用显式导出、导入。

Official WebUI 由 GitHub Pages 提供静态托管。GitHub 可能按照其隐私声明处理请求和安全数据；GitHub 文档说明访问者 IP 地址会为安全目的被记录和保存。Flovart 不把 GitHub Pages 用作 Browser Workspace、提示词、媒体或 Provider Secret 的后端。

发布者通常无法恢复你删除的本地数据，也无法删除第三方 Provider、自定义端点、浏览器同步、云备份或独立部署所持有的副本。相关删除请求应向实际持有数据的主体提出。

## 7. 你的选择与权利

你可以不添加 API Key、不上传文件、不连接自定义端点、不安装 Edge Extension、不授权网页导入，并可随时清除本地数据。

官方本地版本通常把项目数据留在你的设备，因此访问、更正、导出和删除主要由本地功能完成。第三方 Provider、端点、浏览器厂商、扩展商店、备份服务或独立部署持有的数据，应向该主体行使权利。

中国内地用户保留《中华人民共和国个人信息保护法》及其他适用法律规定的强制性权利。香港用户保留《个人资料（私隐）条例》规定的适用权利，包括访问与更正权。本政策不放弃依法不得放弃的权利。

## 8. 儿童与未成年人

Flovart 不面向 13 岁以下儿童或所在地规定的更高最低年龄。未达到法定成年年龄时，只能在父母或监护人许可和监督下使用。

除非具备合法依据和充分授权，不要向第三方 Provider 上传儿童个人信息、肖像、学校记录、健康信息或其他敏感材料。

## 9. 跨境处理

本地优先设计本身不会为本地项目选择云端存储国家或地区。但你选择的第三方 Provider、自定义端点、浏览器厂商、备份、扩展商店或独立部署可能在其他国家或地区处理数据。

你应审查相关第三方政策，确认数据位置、跨境传输条件和自己的授权基础。Flovart 允许填写端点不代表发布者替你完成跨境合规判断。

## 10. 政策变更

影响数据类别、数据去向、浏览器权限、Provider Secret 处理或用户选择的实质变更将使用新的政策版本，并在下一次 Provider 请求或扩展数据传输前重新提示。

## 11. 联系方式

项目仓库：
https://github.com/avabbbb/Flovart

公开支持、隐私问题与通知：
https://github.com/avabbbb/Flovart/issues

请勿在公开 GitHub Issue 中发布 API Key、密码、身份证明、私人媒体、机密信息或其他敏感个人信息。Flovart 目前不提供单独的私人隐私邮箱，且通常无法访问、恢复、更正或删除仅保存在你设备上或由第三方持有的数据。
