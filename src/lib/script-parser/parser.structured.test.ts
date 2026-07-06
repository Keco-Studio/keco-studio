/**
 * Script Parser - Structured Format Tests
 */

import { describe, it, expect } from '@jest/globals';
import { parseText } from './parser';

describe('Structured Format Parser', () => {
  it('should parse label with scene description', () => {
    const input = '【Start｜午后，狭小公寓】';
    const script = parseText(input);

    expect(script.lines.length).toBeGreaterThan(1);
    const dataLine = script.lines.find(l => l.label === 'Start');
    expect(dataLine).toBeDefined();
    expect(dataLine?.content).toContain('午后');
  });

  it('should parse single typed dialogue', () => {
    const input = '（Type1・阿塔那）你好世界';
    const script = parseText(input);

    const dataLines = script.lines.filter(l => l.name || l.content);
    expect(dataLines.length).toBeGreaterThan(0);
    const dialogue = dataLines.find(l => l.name === '阿塔那');
    expect(dialogue).toBeDefined();
    expect(dialogue?.content).toBe('你好世界');
    expect(dialogue?.type).toBe(1);
  });

  it('should split multiple typed dialogues on one line', () => {
    const input = '（Type3・旁白）场景描述（Type1・阿塔那）对话内容（Type2・AI）AI回复';
    const script = parseText(input);

    const dataLines = script.lines.filter(l => l.content);
    // Should have at least 3 separate dialogue lines
    expect(dataLines.length).toBeGreaterThanOrEqual(3);

    // Check each dialogue was extracted
    const names = dataLines.map(l => l.name).filter(Boolean);
    expect(names).toContain('阿塔那');
    expect(names).toContain('AI');
  });

  it('should parse structured option format', () => {
    const input = `（Type1・阿塔那）对话
O1：选项一（$trust+=2，跳转O1分支）
O2：选项二（$pally+=2，跳转O2分支）`;

    const script = parseText(input);

    // Find the dialogue line with options
    const dialogueWithOpts = script.lines.find(l => l.option0 || l.option1);
    expect(dialogueWithOpts).toBeDefined();
    expect(dialogueWithOpts?.option0).toBe('选项一');
    expect(dialogueWithOpts?.option1).toBe('选项二');
  });

  it('should parse branch declaration', () => {
    const input = 'O1 分支【O1｜阿塔那伸懒腰起身】';
    const script = parseText(input);

    // Should create a label for the branch
    const branchLine = script.lines.find(l => l.label === 'O1');
    expect(branchLine).toBeDefined();
    expect(branchLine?.content).toContain('伸懒腰');
  });

  it('should parse jump instruction', () => {
    const input = `（Type1・阿塔那）对话
（跳转 Oend 统一收尾）`;

    const script = parseText(input);

    // The jump should be added as a command to the previous line
    const dialogueLine = script.lines.find(l => l.name === '阿塔那');
    expect(dialogueLine?.commands).toContain('Jump');
  });

  it('should handle complete structured format example', () => {
    const input = `【Start｜午后，公寓】
（Type3・旁白）场景描述
（Type1・阿塔那）对话内容
O1：选项一（$trust+=2，跳转O1分支）
O2：选项二（$pally+=2，跳转O2分支）
O1 分支【O1｜分支场景】
（Type1・阿塔那）分支对话
（跳转 Oend）
Oend 统一收尾【Oend｜结束场景】
（Type3・旁白）结束`;

    const script = parseText(input);

    // Should have multiple lines
    expect(script.lines.length).toBeGreaterThan(5);

    // Check Start label exists
    const startLine = script.lines.find(l => l.label === 'Start');
    expect(startLine).toBeDefined();

    // Check branch label exists
    const o1Line = script.lines.find(l => l.label === 'O1');
    expect(o1Line).toBeDefined();
  });
});
