/**
 * Script Parser - Structured Format Tests
 */

import { describe, it, expect } from '@jest/globals';
import { parseText } from './parser';

describe('Structured Format Parser', () => {
  it('should parse label with scene description', () => {
    const input = '【Start｜Mid-afternoon, a cramped apartment】';
    const script = parseText(input);

    expect(script.lines.length).toBeGreaterThan(1);
    const dataLine = script.lines.find(l => l.label === 'Start');
    expect(dataLine).toBeDefined();
    expect(dataLine?.content).toContain('Mid-afternoon');
  });

  it('should parse single typed dialogue', () => {
    const input = '（Type1・Atana）Hello world';
    const script = parseText(input);

    const dataLines = script.lines.filter(l => l.name || l.content);
    expect(dataLines.length).toBeGreaterThan(0);
    const dialogue = dataLines.find(l => l.name === 'Atana');
    expect(dialogue).toBeDefined();
    expect(dialogue?.content).toBe('Hello world');
    expect(dialogue?.type).toBe(1);
  });

  it('should split multiple typed dialogues on one line', () => {
    const input = '（Type3・Narrator）Scene description（Type1・Atana）Some dialogue（Type2・AI）AI reply';
    const script = parseText(input);

    const dataLines = script.lines.filter(l => l.content);
    // Should have at least 3 separate dialogue lines
    expect(dataLines.length).toBeGreaterThanOrEqual(3);

    // Check each dialogue was extracted
    const names = dataLines.map(l => l.name).filter(Boolean);
    expect(names).toContain('Atana');
    expect(names).toContain('AI');
    const allContent = dataLines.map(l => l.content).join(' ');
    expect(allContent).toContain('Scene');
    expect(allContent).toContain('reply');
  });

  it('should parse structured option format', () => {
    const input = `（Type1・Atana）Some dialogue
O1：Option one（$trust+=2, jump O1）
O2：Option two（$pally+=2, jump O2）`;

    const script = parseText(input);

    // Find the dialogue line with options
    const dialogueWithOpts = script.lines.find(l => l.option0 || l.option1);
    expect(dialogueWithOpts).toBeDefined();
    expect(dialogueWithOpts?.option0).toBe('Option one');
    expect(dialogueWithOpts?.option1).toBe('Option two');
  });

  it('should parse branch declaration', () => {
    const input = 'O1 branch【O1｜Atana stretches and stands up】';
    const script = parseText(input);

    // Should create a label for the branch
    const branchLine = script.lines.find(l => l.label === 'O1');
    expect(branchLine).toBeDefined();
    expect(branchLine?.content).toContain('stretches');
  });

  it('should parse jump instruction', () => {
    const input = `（Type1・Atana）Some dialogue
（Jump Oend）`;

    const script = parseText(input);

    // The jump should be added as a command to the previous line
    const dialogueLine = script.lines.find(l => l.name === 'Atana');
    expect(dialogueLine?.commands).toContain('Jump');
  });

  it('should handle complete structured format example', () => {
    const input = `【Start｜Mid-afternoon, apartment】
（Type3・Narrator）Scene description
（Type1・Atana）Some dialogue
O1：Option one（$trust+=2, jump O1）
O2：Option two（$pally+=2, jump O2）
O1 branch【O1｜Branch scene】
（Type1・Atana）Branch dialogue
（Jump Oend）
Oend merge【Oend｜Closing scene】
（Type3・Narrator）The end`;

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
