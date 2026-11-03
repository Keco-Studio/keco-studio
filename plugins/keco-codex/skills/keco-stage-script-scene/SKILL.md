---
name: keco-stage-script-scene
description: 在 Keco Conversation 为分支剧本制作角色定妆图并按剧情上下文生成镜头，适用于角色跨镜换装、身份混淆或分支画面串线的制作与验收。
---

打开指定项目的 Conversation，核对源 Document、剧本名、目标镜头和分支。如果用户只想看角色设定，完成 Characters 阶段即停止。如果用户只想检查一镜，使用该镜的单独生图按钮。

1. 在 **Characters** 用 **Draft profiles from Script** 起草角色卡，或 **Add character** 手动建卡。每张卡用 **Edit profile** 修改名字和外形、服装、随身配饰，点击 **Save profile** 保存。本镜动作与临时道具写在镜头里；纯环境场景可选 **Use an empty cast**。
2. 逐卡点击 **Generate reference** 生成透明立绘，检查轮廓和服装。只需调整一人时，修改其卡片后重新生成，或点击 **Regenerate reference** 重画同一设定。其他角色的图应保持不变。角色设定保存在当前浏览器，含立绘的镜头模板可用 **Save template** 复用。
3. 进入 **Shot Script**。用当前分支上通往该镜的前序事件、实际选项和当前对白描述画面。继承同场景的布置和光线；剧本切换地点时，按新地点重建背景。列出本镜实际在场的角色，使用已准备好的角色图与空背景合成。角色离开后应从画面移除。分支汇合只有一张代表画面，避免把某条路径独有的道具或结局强加到其他路径。
4. 用相邻的两镜检查同名角色是否使用同一张角色图，再检查说话者、动作、道具、分支目标和对白。分别报告服装连续性与动作表现；固定姿势的角色贴图不能证明动作动画已通过验收。

例如「公交站」的「主动搭话」镜头，应能从身形与大衣认出林野，从身形、雨衣和背包认出小雨。两人是否真的交接雨伞，需要另看画面中的动作与道具。

维护产品实现时，固定生成提示词在 src/lib/script-system/shotPrompts.ts，角色准备状态在 src/lib/script-system/shotCast.ts，分支上下文在 src/lib/script-system/shotContinuity.ts。通过已登录工作台使用配置好的生成接口。
