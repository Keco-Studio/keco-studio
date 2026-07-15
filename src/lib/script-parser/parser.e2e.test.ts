/**
 * Script Parser - End-to-end test with real structured format input
 */

import { describe, it, expect } from '@jest/globals';
import { parseText } from './parser';

describe('Structured Format E2E', () => {
  it('should parse the complete test.txt example', () => {
    const input = `【Start｜Mid-afternoon, a cramped apartment, sunlight filtered pale gold】
（Type3・Scene narration）At three in the afternoon, Atana, who pulled two all-nighters, sleeps on her arms at the workbench
（Type1・Atana）Mmh... quiet, one last loop of the algorithm to finish
（Type2・AI）You have gone 22 hours without a proper meal
O1：Take the advice, put down the work, and head downstairs for food（$trust+=2, jump O1）
O2：Bargain for another half hour of coding before eating（$pally+=2, jump O2）
O3：Use root access to silence every meal reminder（$rely-=1, jump O3）
O1 branch【O1｜Atana stretches and stands up】
（Type1・Atana）Fine, just this once I will listen to you
（Jump Oend）
O2 branch【O2｜Atana's fingertips settle back onto the keyboard】
（Type1・Atana）Half an hour, set the timer
（Jump Oend）
O3 branch【O3｜Atana types a quick command】
（Type1・Atana）Silence the reminders first
（Jump Oend）
Oend merge【Oend｜Evening, the apartment dining table】
（Type2・AI）After weeks of regular meals your productivity data rose 11 percent
（Type1・Atana）Hard to argue with objective data`;

    const script = parseText(input);

    // Verify structure
    expect(script.lines.length).toBeGreaterThan(10);

    // Check Start label
    const startLine = script.lines.find(l => l.label === 'Start');
    expect(startLine).toBeDefined();
    expect(startLine?.content).toContain('Mid-afternoon');

    // Check that the scene narration line survived
    const narrations = script.lines.filter(l => l.content && l.content.includes('three in the afternoon'));
    expect(narrations.length).toBeGreaterThan(0);

    // Check options were attached to previous dialogue
    const linesWithOptions = script.lines.filter(l => l.option0);
    expect(linesWithOptions.length).toBeGreaterThan(0);

    const optLine = linesWithOptions[0];
    expect(optLine.option0).toContain('Take the advice');
    expect(optLine.option1).toContain('Bargain');
    expect(optLine.option2).toContain('root access');

    // Check branch labels exist
    const o1Branch = script.lines.find(l => l.label === 'O1');
    expect(o1Branch).toBeDefined();
    expect(o1Branch?.content).toContain('stretches');

    const o2Branch = script.lines.find(l => l.label === 'O2');
    expect(o2Branch).toBeDefined();

    const oendBranch = script.lines.find(l => l.label === 'Oend');
    expect(oendBranch).toBeDefined();
    expect(oendBranch?.content).toContain('Evening');

    // Check jump commands
    const linesWithJumps = script.lines.filter(l => l.commands && l.commands.includes('Jump'));
    expect(linesWithJumps.length).toBeGreaterThan(0);
  });

  it('should handle the problematic line 2 from test.txt', () => {
    // This is the equivalent of line 2 from test.txt that has multiple dialogues
    const input = '（Type3・Scene narration）At three in the afternoon, Atana, who pulled two all-nighters, sleeps at the workbench while unfinished optimization code floats on the screen. （Type2・AI）You have gone 22 hours without a proper meal and your heart rate is low, so I cancelled redundant background jobs to remind you to rest and eat. （Type1・Atana）Mmh... quiet, one last loop of the algorithm remains, I will eat once it is written. （Type3・Narrator）The lights soften slowly and three interactive options pop up beside the screen';

    const script = parseText(input);

    // Should have split into at least 4 separate dialogue lines
    const dataLines = script.lines.filter(l => l.content);
    expect(dataLines.length).toBeGreaterThanOrEqual(4);

    // Verify each dialogue was extracted correctly
    const names = dataLines.map(l => l.name).filter(Boolean);
    expect(names).toContain('Atana');
    expect(names).toContain('AI');
    // Type 3 → scene/narration (no speaker), content preserved

    const ataLine = dataLines.find(l => l.name === 'Atana');
    expect(ataLine?.content).toContain('quiet');
  });
});
