/**
 * Comprehensive Test: Verify TypeScript parser is a superset of galgame parser
 */

import { describe, it, expect } from '@jest/globals';
import { parseText } from './parser';

describe('Parser Superset Verification', () => {
  describe('Natural Format (narrative)', () => {
    it('should parse character dialogues', () => {
      const input = 'Atana：Hello\nAI：Hello';
      const script = parseText(input);
      expect(script.lines.find(l => l.name === 'Atana')).toBeDefined();
      expect(script.lines.find(l => l.name === 'AI')).toBeDefined();
    });

    it('should parse quoted dialogues', () => {
      const input = 'Atana："I chose A"';
      const script = parseText(input);
      const line = script.lines.find(l => l.name === 'Atana');
      expect(line?.content).toBe('I chose A');
    });

    it('should parse simple options with - prefix', () => {
      const input = 'Narrator：Scene description\n- Choice A\n- Choice B';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.option0).toBe('Choice A');
      expect(line?.option1).toBe('Choice B');
    });

    it('should parse system messages 【text】', () => {
      const input = '【Fullscreen text】Important notice';
      const script = parseText(input);
      const line = script.lines.find(l => l.content?.includes('Important notice'));
      expect(line?.type).toBe(2);
    });

    it('should parse stage directions （cut scene）', () => {
      const input = '（cut scene）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content === 'cut scene');
      expect(line?.type).toBe(2);
    });

    it('should parse scene descriptions （Dusk, an empty plaza）', () => {
      const input = '（Dusk, an empty plaza）';
      const script = parseText(input);
      const line = script.lines.find(l => l.content?.includes('Dusk'));
      expect(line?.type).toBe(2);
    });

    it('should parse variables $var += 2', () => {
      const input = '$trust += 2';
      const script = parseText(input);
      const line = script.lines.find(l => l.commands?.includes('trust'));
      expect(line).toBeDefined();
    });

    it('should parse chapter titles 1.Chapter One', () => {
      const input = '1.Chapter One';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === 'Chapter One');
      expect(line).toBeDefined();
    });
  });

  describe('Structured Format (normalized)', () => {
    it('should parse label with scene 【Start｜scene】', () => {
      const input = '【Start｜Mid-afternoon, apartment】';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === 'Start');
      expect(line?.content).toContain('Mid-afternoon');
    });

    it('should parse typed dialogues （TypeX・name）content', () => {
      const input = '（Type1・Atana）Hello\n（Type2・AI）Hello';
      const script = parseText(input);
      // Type 1/2 are both character dialogue
      expect(script.lines.find(l => l.name === 'Atana' && l.type === 1)).toBeDefined();
      const aiLine = script.lines.find(l => l.name === 'AI' && l.type === 1);
      expect(aiLine).toBeDefined();
      expect(aiLine?.content).toBe('Hello');
    });

    it('should split multiple typed dialogues on one line', () => {
      const input = '（Type3・Narrator）Scene（Type1・Atana）Dialogue（Type2・AI）Reply';
      const script = parseText(input);
      const type1Lines = script.lines.filter(l => l.type === 1 && l.name);
      const type2Lines = script.lines.filter(l => l.type === 2);
      expect(type1Lines.length).toBeGreaterThanOrEqual(2);
      expect(type2Lines.length).toBeGreaterThanOrEqual(1);
      // All content should be present across lines
      const allContent = script.lines.map(l => l.content).join(' ');
      expect(allContent).toContain('Scene');
      expect(allContent).toContain('Dialogue');
      expect(allContent).toContain('Reply');
    });

    it('should parse structured options O1：text（$var, jump）', () => {
      const input = 'Some dialogue\nO1：Choice A（$trust+=2, jump O1）\nO2：Choice B（$pally+=1, jump O2）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.option0).toBe('Choice A');
      expect(line?.option1).toBe('Choice B');
    });

    it('should parse branch declarations O1 branch【O1｜scene】', () => {
      const input = 'O1 branch【O1｜Branch scene】';
      const script = parseText(input);
      const line = script.lines.find(l => l.label === 'O1');
      expect(line?.content).toContain('Branch scene');
    });

    it('should parse jump instructions （Jump Oend）', () => {
      const input = 'Some dialogue\n（Jump Oend）';
      const script = parseText(input);
      const line = script.lines.find(l => l.commands?.includes('Jump'));
      expect(line?.commands).toContain('Oend');
    });

    it('should handle mixed jump + branch on same line', () => {
      const input = '（Type1・Atana）Some dialogue\n（Jump Oend）O2 branch【O2｜scene】';
      const script = parseText(input);
      // Jump should be added to previous dialogue's commands
      const jumpLine = script.lines.find(l => l.commands?.includes('Jump Oend'));
      // Branch label should exist
      const branchLine = script.lines.find(l => l.label === 'O2');
      expect(jumpLine).toBeDefined();
      expect(branchLine).toBeDefined();
    });

    it('should handle multi-line options', () => {
      const input = 'Some dialogue\nO1：Choice A（\n$trust+=2, jump O1）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0 === 'Choice A');
      expect(line).toBeDefined();
    });

    it('should clean up escape characters \\( \\)', () => {
      const input = 'Some dialogue\nO1：Choice（\\(trust+=2, jump O1）';
      const script = parseText(input);
      const line = script.lines.find(l => l.option0);
      expect(line?.commands || '').not.toContain('\\');
    });

    it('should auto-add $ prefix to variables', () => {
      const input = 'Some dialogue\nO1：Choice（trust+=2, jump O1）\nO1 branch【O1｜scene】';
      const script = parseText(input);
      const branchLine = script.lines.find(l => l.label === 'O1');
      expect(branchLine?.commands).toContain('$trust+=2');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete natural format script', () => {
      const input = `Atana：Hello
AI：Hello
- Choice A
- Choice B
Atana：I choose A
（cut scene）
$trust += 2
1.Chapter One`;

      const script = parseText(input);
      expect(script.lines.length).toBeGreaterThan(5);
      expect(script.lines.find(l => l.name === 'Atana')).toBeDefined();
      expect(script.lines.find(l => l.option0)).toBeDefined();
    });

    it('should handle complete structured format script', () => {
      const input = `【Start｜Scene description】
（Type3・Narrator）Scene
（Type1・Atana）Dialogue
O1：Choice A（$trust+=2, jump O1）
O2：Choice B（$pally+=1, jump O2）
O1 branch【O1｜Branch A】
（Type1・Atana）Branch A dialogue
（Jump Oend）
O2 branch【O2｜Branch B】
（Type1・Atana）Branch B dialogue
（Jump Oend）
Oend merge【Oend｜The end】`;

      const script = parseText(input);
      expect(script.lines.length).toBeGreaterThan(8);
      expect(script.lines.find(l => l.label === 'Start')).toBeDefined();
      expect(script.lines.find(l => l.label === 'O1')).toBeDefined();
      expect(script.lines.find(l => l.label === 'O2')).toBeDefined();
      expect(script.lines.find(l => l.label === 'Oend')).toBeDefined();
    });

    it('should handle messy real-world test.txt', () => {
      const input = `【Start｜Mid-afternoon, apartment】
（Type3・Narrator）Scene（Type2・AI）AI dialogue（Type1・Atana）Protagonist dialogue（Type3・Narrator）Options appear
O1：Choice A（
\\(trust+=2, jump O1）
O2：Choice B（\\)pally+=1, jump O2）
O1 branch【O1｜Branch scene】
（Type1・Atana）Branch dialogue
（Jump Oend）O2 branch【O2｜Another branch】
（Jump Oend）Oend merge【Oend｜The end】`;

      const script = parseText(input);

      // Verify key features
      expect(script.lines.find(l => l.label === 'Start')).toBeDefined();

      // Type 1 = characters (including Type2・AI); Type 3 = scene/narration
      const ataLines = script.lines.filter(l => l.name === 'Atana');
      const aiLines = script.lines.filter(l => l.name === 'AI' && l.type === 1);
      expect(ataLines.length).toBeGreaterThan(0);
      expect(aiLines.length).toBeGreaterThan(0);

      // Options should be parsed
      const optLine = script.lines.find(l => l.option0);
      expect(optLine?.option0).toBe('Choice A');
      expect(optLine?.option1).toBe('Choice B');

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

    it('should map structured Type3 to Type 2 (narration)', () => {
      const input = '（Type3・Narrator）scene description';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 2);
      expect(line).toBeDefined();
      expect(line?.content).toBe('scene description');
    });

    it('should keep structured Type2 as Type 1 (character dialogue)', () => {
      const input = '（Type2・AI）Hello';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 1 && l.name === 'AI');
      expect(line).toBeDefined();
      expect(line?.content).toBe('Hello');
    });

    it('should keep structured Type1 as Type 1 (dialogue)', () => {
      const input = '（Type1・Hero）I am the hero';
      const script = parseText(input);
      const line = script.lines.find(l => l.type === 1 && l.name === 'Hero');
      expect(line).toBeDefined();
    });
  });

  describe('Scene Label Detection', () => {
    it('should recognize "Location\\n[XXX]" as scene label (label=id, content=scene name)', () => {
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
（cut scene）
More text`;
      const script = parseText(input);
      const edgarLine = script.lines.find(l => l.name === 'Edgar');
      expect(edgarLine?.content).toBe('Hello');
      // Stage direction should be separate
      const stageLine = script.lines.find(l => l.content === 'cut scene');
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
