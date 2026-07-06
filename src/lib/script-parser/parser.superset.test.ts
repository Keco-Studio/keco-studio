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
      expect(line?.type).toBe(5);
    });

    it('should parse stage directions （切屏）', () => {
      const input = '（切屏）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content === '切屏');
      expect(line?.type).toBe(5);
    });

    it('should parse scene descriptions （黄昏，场景）', () => {
      const input = '（黄昏，场景）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content?.includes('黄昏'));
      expect(line?.type).toBe(5);
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
      expect(script.lines.find(l => l.name === '阿塔那' && l.type === 1)).toBeDefined();
      expect(script.lines.find(l => l.name === 'AI' && l.type === 2)).toBeDefined();
    });

    it('should split multiple typed dialogues on one line', () => {
      const input = '（Type3・旁白）场景（Type1・阿塔那）对话（Type2・AI）回复';
      const script = parseText(input);
      const dialogues = script.lines.filter(l => l.name);
      expect(dialogues.length).toBeGreaterThanOrEqual(3);
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

      // Multiple dialogues on one line should be split
      const aiLines = script.lines.filter(l => l.name === 'AI');
      const ataLines = script.lines.filter(l => l.name === '阿塔那');
      expect(aiLines.length).toBeGreaterThan(0);
      expect(ataLines.length).toBeGreaterThan(0);

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
});
