import { describe, expect, it, jest, beforeEach } from '@jest/globals';
jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));
import { completeLlm } from '@/lib/agent/llm-client';
import { resolveScriptTextForImport } from './scriptTextConversion';

const script = `Guide: "Choose a road."
O1: Left (jump O1)
O2: Right (jump O2)
O1 branch [O1 | Left]
Guide: "A quiet road."
(Jump Oend)
O2 branch [O2 | Right]
Guide: "A busy road."
(Jump Oend)
Oend merge [Oend | Arrival]
Guide: "Welcome."`;
const raw = script.replace('jump O1', 'jump Missing');
beforeEach(() => jest.mocked(completeLlm).mockReset());
describe('legacy Script text conversion', () => {
  it('converts author profiles, quoted reporting verbs, scene annotations and choice instructions', async () => {
    const source = '\u4eba\u7269\u8d44\u6599\n\u6797\u91ce——\u7a7f\u7070\u5927\u8863。\n\u5c0f\u96e8——\u7a7f\u9ec4\u96e8\u8863。\n\u5730\u70b9：\u96e8\u591c\u7ad9\u53f0。\n\u6797\u91ce\u8bf4：“\u4e00\u8d77\u8d70\u5417？”\n\u8fd9\u91cc\u8ba9\u73a9\u5bb6\u9009\u62e9：\u8d70 / \u7b49。\n\u5982\u679c\u9009\u62e9\u8d70：\n\u5c0f\u96e8\u56de\u7b54：“\u8d70\u5427。”\n\u5982\u679c\u9009\u62e9\u7b49：\n\u5c0f\u96e8\u56de\u7b54：“\u518d\u7b49\u7b49。”';
    const output = '**Character - \u6797\u91ce**\n*\u7a7f\u7070\u5927\u8863。*\n**Character - \u5c0f\u96e8**\n*\u7a7f\u9ec4\u96e8\u8863。*\n*\u5730\u70b9：\u96e8\u591c\u7ad9\u53f0。*\n\u6797\u91ce: \u4e00\u8d77\u8d70\u5417？\nO1: \u8d70 (jump O1)\nO2: \u7b49 (jump O2)\nO1 branch [O1 | \u5982\u679c\u9009\u62e9\u8d70：]\n\u5c0f\u96e8: \u8d70\u5427。\nO2 branch [O2 | \u5982\u679c\u9009\u62e9\u7b49：]\n\u5c0f\u96e8: \u518d\u7b49\u7b49。';
    jest.mocked(completeLlm).mockResolvedValue(output);
    const result = await resolveScriptTextForImport(source);
    expect(result.fallback).toBe(false);
    expect(result.document.nodes.filter(n => n.speaker).map(n => n.speaker)).toEqual(['\u6797\u91ce', '\u5c0f\u96e8', '\u5c0f\u96e8']);
    expect(result.document.nodes.some(n => n.content.includes('\u96e8\u8863'))).toBe(false);
    expect(result.document.nodes.some(n => n.type === 'narration' && n.content === '\u5730\u70b9：\u96e8\u591c\u7ad9\u53f0。')).toBe(true);
    jest.mocked(completeLlm).mockResolvedValue(output.replace('\u5c0f\u96e8: \u8d70\u5427。', '\u6797\u91ce: \u8d70\u5427。'));
    expect((await resolveScriptTextForImport(source)).fallback).toBe(true);
  });
  it('preserves character descriptions in source without playing them as scenes or dialogue', async () => {
    const profile = '**Character - Guide**\n*An older guide wearing a raincoat.*\n';
    const result = await resolveScriptTextForImport(profile + script);
    expect(result.fallback).toBe(false);
    expect(result.scriptText).toContain(profile.trim());
    expect(result.document.nodes.some(n => /raincoat|Character/.test(n.content))).toBe(false);
    expect(result.document.nodes.flatMap(n => n.options)).toHaveLength(2);
  });
  it('prioritizes bold titles and italic descriptions over colon speaker detection', async () => {
    const source = '**\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854**\n*\u65f6\u95f4: \u508d\u665a*\n\u5b88\u5854\u4eba: \u53bb\u54ea?\nO1: \u6cb3\u8fb9 (jump O1)\nO1 branch [O1 | \u6cb3\u8fb9]\n\u8bbf\u5ba2: \u51fa\u53d1.';
    const result = await resolveScriptTextForImport(source);
    expect(result.fallback).toBe(false);
    expect(result.document.nodes[0]).toMatchObject({ type: 'scene', content: '\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854' });
    expect(result.document.nodes[1]).toMatchObject({ type: 'narration', content: '\u65f6\u95f4: \u508d\u665a' });
    expect(result.document.nodes.filter(n => n.speaker).map(n => n.speaker)).toEqual(['\u5b88\u5854\u4eba', '\u8bbf\u5ba2']);
    expect(result.scriptText).toBe(source);
    expect(completeLlm).not.toHaveBeenCalled();
  });
  it('accepts natural choice conditions as branch descriptions while retaining speakers', async () => {
    const source = '\u5411\u5bfc：\u53bb\u54ea？\n\u5982\u679c\u73a9\u5bb6\u9009\u62e9\u6cb3\u8fb9：\n\u65c5\u884c\u8005：\u53bb\u770b\u8239。\n\u5982\u679c\u73a9\u5bb6\u9009\u62e9\u96c6\u5e02：\n\u5546\u4eba：\u4e70\u82f9\u679c\u5417？';
    const output = '\u5411\u5bfc: "\u53bb\u54ea？"\nO1: \u6cb3\u8fb9 (jump O1)\nO2: \u96c6\u5e02 (jump O2)\nO1 branch [O1 | \u5982\u679c\u73a9\u5bb6\u9009\u62e9\u6cb3\u8fb9：]\n\u65c5\u884c\u8005: "\u53bb\u770b\u8239。"\nO2 branch [O2 | \u5982\u679c\u73a9\u5bb6\u9009\u62e9\u96c6\u5e02：]\n\u5546\u4eba: "\u4e70\u82f9\u679c\u5417？"';
    jest.mocked(completeLlm).mockResolvedValue(output);
    const result = await resolveScriptTextForImport(source);
    expect(result.fallback).toBe(false);
    expect(result.document.nodes.filter(n => n.type === 'dialogue').map(n => n.speaker)).toEqual(['\u5411\u5bfc', '\u65c5\u884c\u8005', '\u5546\u4eba']);
    expect(result.document.nodes.flatMap(n => n.options)).toHaveLength(2);
  });
  it('imports valid legacy branches without AI and retains both branches', async () => {
    const result = await resolveScriptTextForImport(script);
    expect(completeLlm).not.toHaveBeenCalled();
    expect(result.document.nodes.flatMap(n => n.options)).toHaveLength(2);
    expect(result.scriptText).toBe(script.replace(/"/g, ''));
    expect(result.plotPlan.edges.length).toBeGreaterThan(1);
  });
  it('asks AI for Script text, never JSON tool output', async () => {
    jest.mocked(completeLlm).mockResolvedValue(script);
    const result = await resolveScriptTextForImport(raw);
    expect(result.scriptText).toBe(script.replace(/"/g, ''));
    expect(result.fallback).toBe(false);
    const [messages, options] = jest.mocked(completeLlm).mock.calls[0];
    expect(messages[0].content).toContain('Script text');
    expect(options?.toolName).toBeUndefined();
    expect(options?.tools).toBeUndefined();
    expect(options?.thinking).toBe('disabled');
  });
  it('repairs dangling targets instead of accepting them', async () => {
    jest.mocked(completeLlm).mockResolvedValueOnce(script.replace('jump O1', 'jump Missing')).mockResolvedValueOnce(script);
    const result = await resolveScriptTextForImport(raw);
    expect(completeLlm).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(false);
  });
  it('rejects omitted content and preserves all raw lines on fallback', async () => {
    jest.mocked(completeLlm).mockResolvedValue('Guide: "Choose a road."');
    const result = await resolveScriptTextForImport(raw);
    expect(result.fallback).toBe(true);
    const text = result.document.nodes.map(n => n.content).join('\n');
    for (const line of raw.split('\n')) expect(text).toContain(line);
    expect(result.document.nodes.flatMap(n => n.options)).toHaveLength(0);
  });
  it('returns editable content when the provider fails', async () => {
    jest.mocked(completeLlm).mockRejectedValue(new Error('offline'));
    const result = await resolveScriptTextForImport(raw);
    expect(result.fallback).toBe(true);
    expect(result.document.nodes.length).toBeGreaterThan(0);
    expect(result.plotPlan.nodes.length).toBeGreaterThan(0);
  });
  it('never turns cancellation or empty input into a successful fallback', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(resolveScriptTextForImport(raw, { signal: controller.signal })).rejects.toThrow();
    await expect(resolveScriptTextForImport('   ')).rejects.toThrow();
  });
  it('keeps four options and independent endings in the existing projection', async () => {
    const four = 'Guide: "Choose."\n' + [1,2,3,4].map(i => `O${i}: Road ${i} (jump O${i})`).join('\n') + '\n' + [1,2,3,4].map(i => `O${i} branch [O${i} | Road ${i}]\nGuide: "End ${i}."`).join('\n');
    const result = await resolveScriptTextForImport(four);
    expect(result.document.nodes.flatMap(n => n.options)).toHaveLength(4);
    expect(result.plotPlan.edges.filter(e => e.optionIndex !== null)).toHaveLength(4);
    expect(completeLlm).not.toHaveBeenCalled();
  });
  it('does not persist fallback after cancellation during a model call', async () => {
    const controller = new AbortController();
    jest.mocked(completeLlm).mockImplementation(async () => { controller.abort(); throw new Error('aborted'); });
    await expect(resolveScriptTextForImport(raw, { signal: controller.signal })).rejects.toThrow();
  });
  it('rejects invented variable effects', async () => {
    jest.mocked(completeLlm).mockResolvedValue(script.replace('(jump O1)', '($trust+=5; jump O1)'));
    expect((await resolveScriptTextForImport(raw)).fallback).toBe(true);
  });

  it('rejects collapsing repeated dialogue', async () => {
    jest.mocked(completeLlm).mockResolvedValue('Guide: "Hello."');
    const result = await resolveScriptTextForImport('Guide: "Hello."\nGuide: "Hello."');
    expect(result.fallback).toBe(true);
  });
  it('rejects swapping dialogue between known speakers', async () => {
    jest.mocked(completeLlm).mockResolvedValue('Tom: "Hello."\nGuide: "Goodbye."');
    const result = await resolveScriptTextForImport('Guide: "Hello."\nTom: "Goodbye."');
    expect(result.fallback).toBe(true);
  });

  it('rejects removing a speaker entirely', async () => {
    jest.mocked(completeLlm).mockResolvedValue('Bob: Hello\nBob: Goodbye');
    expect((await resolveScriptTextForImport('Alice: Hello\nBob: Goodbye')).fallback).toBe(true);
  });
  it('rejects adding a duplicate dialogue', async () => {
    jest.mocked(completeLlm).mockResolvedValue('Guide: Hello\nGuide: Hello');
    expect((await resolveScriptTextForImport('Guide: Hello')).fallback).toBe(true);
  });

  it('normalizes Markdown formatting into ordinary legacy dialogue', async () => {
    jest.mocked(completeLlm).mockResolvedValue('**Opening**\nGuide: "Hello."');
    const result = await resolveScriptTextForImport('# Opening\n**Guide**: "Hello."');
    expect(result.fallback).toBe(false);
    expect(result.scriptText).toBe('**Opening**\nGuide: Hello.');
    expect(result.document.nodes.find(n => n.speaker === 'Guide')?.content).toBe('Hello.');
  });

});
