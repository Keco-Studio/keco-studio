/**
 * Script Parser - End-to-end test with real structured format input
 */

import { describe, it, expect } from 'vitest';
import { parseText } from './parser';

describe('Structured Format E2E', () => {
  it('should parse the complete test.txt example', () => {
    const input = `【Start｜午后，狭小公寓，阳光被遮光帘滤成淡金色】
（Type3・场景旁白）午后三点，连续通宵两晚的阿塔那枕着手臂睡在工作台前
（Type1・阿塔那）唔…… 别吵，还差最后一段闭环算法
（Type2・AI）检测到你已连续 22 小时未正常进食
O1：顺从提议，放下工作出门下楼觅食（$trust+=2，跳转O1分支）
O2：讨价还价，再写完半小时代码再吃饭（$pally+=2，跳转O2分支）
O3：直接耍赖，用最高权限屏蔽所有用餐提醒（$rely-=1，跳转O3分支）
O1 分支【O1｜阿塔那伸懒腰起身】
（Type1・阿塔那）行吧，难得听你一回
（跳转 Oend 统一收尾）
O2 分支【O2｜阿塔那指尖重新落回键盘】
（Type1・阿塔那）就半小时，定好计时器
（跳转 Oend 统一收尾）
O3 分支【O3｜阿塔那快速敲入代码】
（Type1・阿塔那）先把提醒关掉
（跳转 Oend 统一收尾）
Oend 统一收尾【Oend｜傍晚，公寓餐桌】
（Type2・AI）长期规律用餐后，你的工作效率数据环比上涨 11%
（Type1・阿塔那）客观数据确实没法反驳`;

    const script = parseText(input);

    // Verify structure
    expect(script.lines.length).toBeGreaterThan(10);

    // Check Start label
    const startLine = script.lines.find(l => l.label === 'Start');
    expect(startLine).toBeDefined();
    expect(startLine?.content).toContain('午后');

    // Check that multiple dialogues on one line were split
    const narrations = script.lines.filter(l => l.content && l.content.includes('午后三点'));
    expect(narrations.length).toBeGreaterThan(0);

    // Check options were attached to previous dialogue
    const linesWithOptions = script.lines.filter(l => l.option0);
    expect(linesWithOptions.length).toBeGreaterThan(0);

    const optLine = linesWithOptions[0];
    expect(optLine.option0).toContain('顺从提议');
    expect(optLine.option1).toContain('讨价还价');
    expect(optLine.option2).toContain('直接耍赖');

    // Check branch labels exist
    const o1Branch = script.lines.find(l => l.label === 'O1');
    expect(o1Branch).toBeDefined();
    expect(o1Branch?.content).toContain('伸懒腰');

    const o2Branch = script.lines.find(l => l.label === 'O2');
    expect(o2Branch).toBeDefined();

    const oendBranch = script.lines.find(l => l.label === 'Oend');
    expect(oendBranch).toBeDefined();
    expect(oendBranch?.content).toContain('傍晚');

    // Check jump commands
    const linesWithJumps = script.lines.filter(l => l.commands && l.commands.includes('Jump'));
    expect(linesWithJumps.length).toBeGreaterThan(0);

    console.log('=== Parsed Script Lines ===');
    script.lines.forEach((line, idx) => {
      if (line.label || line.name || line.content || line.option0) {
        console.log(`Line ${idx}:`, {
          label: line.label,
          type: line.type,
          name: line.name,
          content: line.content?.slice(0, 50),
          option0: line.option0,
          option1: line.option1,
          option2: line.option2,
          commands: line.commands,
        });
      }
    });
  });

  it('should handle the problematic line 2 from test.txt', () => {
    // This is the actual line 2 from test.txt that has multiple dialogues
    const input = '（Type3・场景旁白）午后三点，连续通宵两晚的阿塔那枕着手臂睡在工作台前，屏幕还悬浮着未写完的 AI 优化代码。（Type2・AI）检测到你已连续 22 小时未正常进食，心率偏低，我自动取消后台冗余运算，腾出算力提醒你休息用餐。（Type1・阿塔那）唔…… 别吵，还差最后一段闭环算法，写完再吃就行。（Type3・旁白）系统灯光缓缓柔和变亮，屏幕侧边弹出三个互动选项';

    const script = parseText(input);

    // Should have split into at least 4 separate dialogue lines
    const dataLines = script.lines.filter(l => l.content);
    expect(dataLines.length).toBeGreaterThanOrEqual(4);

    // Verify each dialogue was extracted correctly
    const names = dataLines.map(l => l.name).filter(Boolean);
    expect(names).toContain('阿塔那');
    expect(names).toContain('AI');
    // Type 3 → 场景/旁白（无说话人），内容保留

    const ataLine = dataLines.find(l => l.name === '阿塔那');
    expect(ataLine?.content).toContain('别吵');
  });
});
