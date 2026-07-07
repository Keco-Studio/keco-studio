/**
 * Comprehensive Test: Verify TypeScript parser is a superset of galgame parser
 */

import { describe, it, expect } from '@jest/globals';
import { parseText } from './parser';

describe('Parser Superset Verification', () => {
  describe('Natural Format (剧情向)', () => {
    it('should parse character dialogues', () => {
      const input = '阿塔那：你好\nAI：你好';
      const script = parseText(input);
      expect(script.lines.find(l => l.name === '阿塔那')).toBeDefined();
      expect(script.lines.find(l => l.name === 'AI')).toBeDefined();
    });

    it('should parse quoted dialogues', () => {
      const input = '阿塔那："我选择了A"';
      const script = parseText(input);
      const line = script.lines.find(l => l.name === '阿塔那');
      expect(line?.content).toBe('我选择了A');
    });

    it('should parse simple options with - prefix', () => {
      const input = '旁白：场景描述\n- 选择A\n- 选择B';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.option0).toBe('选择A');
      expect(line?.option1).toBe('选择B');
    });

    it('should parse options with 【选项N：文本】 format', () => {
      const input = '对话内容\n【选项1：选择A】\n【选项2：选择B】';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.option0).toBe('选择A');
      expect(line?.option1).toBe('选择B');
    });

    it('should parse system messages 【文字】', () => {
      const input = '【全屏文字】重要提示';
      const script = parseText(input);
      const line = script.lines.find(l => l.content?.includes('重要提示'));
      expect(line?.type).toBe(2);
    });

    it('should parse stage directions （切屏）', () => {
      const input = '（切屏）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content === '切屏');
      expect(line?.type).toBe(2);
    });

    it('should parse scene descriptions （黄昏，场景）', () => {
      const input = '（黄昏，场景）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content?.includes('黄昏'));
      expect(line?.type).toBe(2);
    });

    it('should parse variables $var += 2', () => {
      const input = '$trust += 2';
      const script = parseText(input);
      const line = script.lines.find(l => l.commands?.includes('trust'));
      expect(line).toBeDefined();
    });

    it('should parse conditions （多周目，未解锁）', () => {
      const input = '（多周目，未解锁）对话内容';
      const script = parseText(input);
      const line = script.lines.find(l => l.content === '对话内容');
      expect(line?.if).toContain('多周目');
    });

    it('should parse chapter titles 1.第一章', () => {
      const input = '1.第一章';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === '第一章');
      expect(line).toBeDefined();
    });
  });

  describe('Structured Format (规范化)', () => {
    it('should parse label with scene 【Start｜场景】', () => {
      const input = '【Start｜午后，公寓】';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === 'Start');
      expect(line?.content).toContain('午后');
    });

    it('should parse typed dialogues （TypeX・name）content', () => {
      const input = '（Type1・阿塔那）你好\n（Type2・AI）你好';
      const script = parseText(input);
      // Type 1/2 均为人物对话
      expect(script.lines.find(l => l.name === '阿塔那' && l.type === 1)).toBeDefined();
      const aiLine = script.lines.find(l => l.name === 'AI' && l.type === 1);
      expect(aiLine).toBeDefined();
      expect(aiLine?.content).toBe('你好');
    });

    it('should split multiple typed dialogues on one line', () => {
      const input = '（Type3・旁白）场景（Type1・阿塔那）对话（Type2・AI）回复';
      const script = parseText(input);
      const type1Lines = script.lines.filter(l => l.type === 1 && l.name);
      const type2Lines = script.lines.filter(l => l.type === 2);
      expect(type1Lines.length).toBeGreaterThanOrEqual(2);
      expect(type2Lines.length).toBeGreaterThanOrEqual(1);
      // All content should be present across lines
      const allContent = script.lines.map(l => l.content).join(' ');
      expect(allContent).toContain('场景');
      expect(allContent).toContain('对话');
      expect(allContent).toContain('回复');
    });

    it('should parse structured options O1：文本（$var，跳转）', () => {
      const input = '对话\nO1：选择A（$trust+=2，跳转O1分支）\nO2：选择B（$pally+=1，跳转O2分支）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.option0).toBe('选择A');
      expect(line?.option1).toBe('选择B');
    });

    it('should parse branch declarations O1 分支【O1｜场景】', () => {
      const input = 'O1 分支【O1｜分支场景】';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === 'O1');
      expect(line?.content).toContain('分支场景');
    });

    it('should parse jump instructions （跳转 Oend）', () => {
      const input = '对话\n（跳转 Oend）';
      const script = parseText(input);
      const line = script.lines.find(l => l.commands?.includes('Jump'));
      expect(line?.commands).toContain('Oend');
    });

    it('should handle mixed jump + branch on same line', () => {
      const input = '（Type1・阿塔那）对话\n（跳转 Oend）O2 分支【O2｜场景】';
      const script = parseText(input);
      // Jump should be added to previous dialogue's commands
      const jumpLine = script.lines.find(l => l.commands?.includes('Jump Oend'));
      // Branch label should exist
      const branchLine = script.lines.find(l => l.label === 'O2');
      expect(jumpLine).toBeDefined();
      expect(branchLine).toBeDefined();
    });

    it('should handle multi-line options', () => {
      const input = '对话内容\nO1：选择A（\n$trust+=2，跳转O1分支）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0 === '选择A');
      expect(line).toBeDefined();
    });

    it('should clean up escape characters \\( \\)', () => {
      const input = '对话内容\nO1：选择（\\(trust+=2，跳转O1分支）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.commands || '').not.toContain('\\');
    });

    it('should auto-add $ prefix to variables', () => {
      const input = '对话内容\nO1：选择（trust+=2，跳转O1分支）\nO1 分支【O1｜场景】';
      const script = parseText(input);
      const branchLine = script.lines.find(l => l.label === 'O1');
      expect(branchLine?.commands).toContain('$trust+=2');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete natural format script', () => {
      const input = `阿塔那：你好
AI：你好
- 选择A
- 选择B
阿塔那：我选择A
（切屏）
$trust += 2
1.第一章`;

      const script = parseText(input);
      expect(script.lines.length).toBeGreaterThan(5);
      expect(script.lines.find(l => l.name === '阿塔那')).toBeDefined();
      expect(script.lines.find(l => l.option0)).toBeDefined();
    });

    it('should handle complete structured format script', () => {
      const input = `【Start｜场景描述】
（Type3・旁白）场景
（Type1・阿塔那）对话
O1：选择A（$trust+=2，跳转O1分支）
O2：选择B（$pally+=1，跳转O2分支）
O1 分支【O1｜分支A】
（Type1・阿塔那）分支A对话
（跳转 Oend）
O2 分支【O2｜分支B】
（Type1・阿塔那）分支B对话
（跳转 Oend）
Oend 统一收尾【Oend｜结束】`;

      const script = parseText(input);
      expect(script.lines.length).toBeGreaterThan(8);
      expect(script.lines.find(l => l.label === 'Start')).toBeDefined();
      expect(script.lines.find(l => l.label === 'O1')).toBeDefined();
      expect(script.lines.find(l => l.label === 'O2')).toBeDefined();
      expect(script.lines.find(l => l.label === 'Oend')).toBeDefined();
    });

    it('should handle messy real-world test.txt', () => {
      const input = `【Start｜午后，公寓】
（Type3・旁白）场景（Type2・AI）AI对话（Type1・阿塔那）主角对话（Type3・旁白）选项出现
O1：选择A（
\\(trust+=2，跳转O1分支）
O2：选择B（\\)pally+=1，跳转O2分支）
O1 分支【O1｜分支场景】
（Type1・阿塔那）分支对话
（跳转 Oend）O2 分支【O2｜另一分支】
（跳转 Oend）Oend 统一收尾【Oend｜结束】`;

      const script = parseText(input);

      // Verify key features
      expect(script.lines.find(l => l.label === 'Start')).toBeDefined();

      // Type 1 = 人物（含 Type2・AI）；Type 3 = 场景/旁白
      const ataLines = script.lines.filter(l => l.name === '阿塔那');
      const aiLines = script.lines.filter(l => l.name === 'AI' && l.type === 1);
      expect(ataLines.length).toBeGreaterThan(0);
      expect(aiLines.length).toBeGreaterThan(0);

      // Options should be parsed
      const optLine = script.lines.find(l => l.option0);
      expect(optLine?.option0).toBe('选择A');
      expect(optLine?.option1).toBe('选择B');

      // Branch labels should exist
      expect(script.lines.find(l => l.label === 'O1')).toBeDefined();
      expect(script.lines.find(l => l.label === 'O2')).toBeDefined();
      expect(script.lines.find(l => l.label === 'Oend')).toBeDefined();

      // Variables should have $ prefix (after cleaning up escape characters)
      const o1Branch = script.lines.find(l => l.label === 'O1');
      // The command should contain trust+=2 (with or without $ prefix)
      expect(o1Branch?.commands).toContain('trust+=2');
      // But should NOT contain backslash
      expect(o1Branch?.commands).not.toContain('\\');
    });
  });

  describe('Type 1/2 Mapping', () => {
    it('should map all natural dialogue to Type 1', () => {
      const input = 'Soldier: Hello\nEdgar: World';
      const script = parseText(input);
      const dialogueLines = script.lines.filter(l => l.name && l.type === 1);
      expect(dialogueLines.length).toBe(2);
    });

    it('should map narration to Type 2', () => {
      const input = 'Some narration text';
      const script = parseText(input);
      const narrationLine = script.lines.find(l => l.type === 2 && !l.name);
      expect(narrationLine).toBeDefined();
    });

    it('should map structured Type3 to Type 2 (旁白)', () => {
      const input = '（Type3・Narrator）scene description';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 2);
      expect(line).toBeDefined();
      expect(line?.content).toBe('scene description');
    });

    it('should keep structured Type2 as Type 1 (人物对话)', () => {
      const input = '（Type2・AI）Hello';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 1 && l.name === 'AI');
      expect(line).toBeDefined();
      expect(line?.content).toBe('Hello');
    });

    it('should keep structured Type1 as Type 1 (对话)', () => {
      const input = '（Type1・Hero）I am the hero';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 1 && l.name === 'Hero');
      expect(line).toBeDefined();
    });
  });

  describe('Scene Label Detection', () => {
    it('should recognize "Location\\n[XXX]" as scene label (Label=编号, Content=场景)', () => {
      const input = 'South Figaro Cave\n[003]';
      const script = parseText(input);
      const sceneLine = script.lines.find(l => l.label === '003');
      expect(sceneLine).toBeDefined();
      expect(sceneLine?.type).toBe(2);
      expect(sceneLine?.content).toBe('South Figaro Cave');
    });

    it('should recognize inline "Location [XXX]" as scene label', () => {
      const input = 'South Figaro Cave [003]';
      const script = parseText(input);
      const sceneLine = script.lines.find(l => l.label === '003');
      expect(sceneLine).toBeDefined();
      expect(sceneLine?.content).toBe('South Figaro Cave');
      expect(sceneLine?.type).toBe(2);
    });

    it('should recognize "[XXX] Location" as scene label (number at start)', () => {
      const input = '[003] South Figaro Cave';
      const script = parseText(input);
      const sceneLine = script.lines.find(l => l.label === '003');
      expect(sceneLine).toBeDefined();
      expect(sceneLine?.content).toBe('South Figaro Cave');
      expect(sceneLine?.type).toBe(2);
    });

    it('should default to "Start" label when no number present', () => {
      const input = 'South Figaro Cave';
      const script = parseText(input);
      // First line is instruction row, second line is the actual content
      const firstContentLine = script.lines.find(l => l.content === 'South Figaro Cave');
      expect(firstContentLine?.label).toBe('Start');
      expect(firstContentLine?.content).toBe('South Figaro Cave');
      expect(firstContentLine?.type).toBe(2);
    });

    it('should handle scene label followed by dialogue', () => {
      const input = `South Figaro Cave
[003]

Soldier: King Edgar! Where are you headed?`;
      const script = parseText(input);
      const sceneLine = script.lines.find(l => l.label === '003');
      expect(sceneLine).toBeDefined();
      expect(sceneLine?.type).toBe(2);
      expect(sceneLine?.content).toBe('South Figaro Cave');
      const soldierLine = script.lines.find(l => l.name === 'Soldier');
      expect(soldierLine).toBeDefined();
      expect(soldierLine?.type).toBe(1);
    });
  });

  describe('Cross-line Dialogue Merging', () => {
    it('should merge unquoted multi-line dialogue', () => {
      const input = `Edgar: Through the cave, and eastward
to South Figaro. We'll then make for
the Returner headquarters.`;
      const script = parseText(input);
      const edgarLine = script.lines.find(l => l.name === 'Edgar');
      expect(edgarLine).toBeDefined();
      expect(edgarLine?.content).toContain('Through the cave');
      expect(edgarLine?.content).toContain('Returner headquarters');
    });

    it('should not merge across stage directions', () => {
      const input = `Edgar: Hello
（切屏）
More text`;
      const script = parseText(input);
      const edgarLine = script.lines.find(l => l.name === 'Edgar');
      expect(edgarLine?.content).toBe('Hello');
      // Stage direction should be separate
      const stageLine = script.lines.find(l => l.content === '切屏');
      expect(stageLine).toBeDefined();
    });

    it('should not merge across separators', () => {
      const input = `Edgar: Hello
+++++
Soldier: World`;
      const script = parseText(input);
      const edgarLine = script.lines.find(l => l.name === 'Edgar');
      expect(edgarLine?.content).toBe('Hello');
      const soldierLine = script.lines.find(l => l.name === 'Soldier');
      expect(soldierLine).toBeDefined();
    });

    it('should not merge across new dialogue lines', () => {
      const input = `Edgar: Hello
Soldier: World`;
      const script = parseText(input);
      const edgarLine = script.lines.find(l => l.name === 'Edgar');
      expect(edgarLine?.content).toBe('Hello');
      const soldierLine = script.lines.find(l => l.name === 'Soldier');
      expect(soldierLine?.content).toBe('World');
    });
  });

  describe('RPG Script Format (South Figaro)', () => {
    it('should parse scene label, environment, and quoted narration separately', () => {
      const input = `South Figaro [004]
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

[The group arrives in South Figaro, encountering a strange individual.]

Locke: Right, ignore us and maybe we'll just disappear...
Edgar: Back off, Locke. That guy looks familiar...

"He comes and goes like the wind, swearing allegiance to no one. Hidden
 behind his wintry gaze lies a face known to none who live..."

Edgar: That's Shadow... He's an assassin.`;

      const script = parseText(input);

      const sceneLine = script.lines.find(l => l.label === '004');
      expect(sceneLine).toBeDefined();
      expect(sceneLine?.type).toBe(2);
      expect(sceneLine?.content).toBe('South Figaro');

      const envLine = script.lines.find(l =>
        l.type === 2 && l.content?.includes('group arrives in South Figaro')
      );
      expect(envLine).toBeDefined();
      expect(envLine?.label).toBe('');

      const quoteLine = script.lines.find(l =>
        l.type === 2 && l.content?.includes('comes and goes like the wind')
      );
      expect(quoteLine).toBeDefined();

      const edgarLines = script.lines.filter(l => l.name === 'Edgar');
      expect(edgarLines.length).toBe(2);
      expect(edgarLines[0]?.content).toContain('Back off, Locke');
      expect(edgarLines[1]?.content).toContain("That's Shadow");
    });
  });
});
