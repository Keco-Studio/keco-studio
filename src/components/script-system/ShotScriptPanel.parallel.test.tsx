/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShotScriptPanel } from './ShotScriptPanel';

test('waits for the parent backdrop, renders both branches concurrently and keeps out-of-order results', async () => {
  const rows = [
    {id:'a', values:{Label:'A', Content:'Start', Option1:'Left', Option1_Next:'Jump B', Option2:'Right', Option2_Next:'Jump C'}},
    {id:'b', values:{Label:'B', Content:'Left', Commands:'End'}},
    {id:'c', values:{Label:'C', Content:'Right', Commands:'End'}},
  ];
  localStorage.setItem('keco.script.cast:p:s', JSON.stringify({characterGuide:'None',castSprites:[]}));
  const requests = new Map<string, {reference?:string; finish:()=>void}>();
  const previous = global.fetch;
  global.fetch = jest.fn((_url, options) => {
    const {board,artworkShotId:id} = JSON.parse(options!.body as string);
    return new Promise<Response>(resolve => {
      const image = 'data:image/png;base64,' + btoa(id);
      requests.set(id, {reference:board.shots[0].backdrop, finish:()=>resolve({
        ok:true, headers:{get:()=>'application/json'}, json:async()=>({artwork:image, backdrop:image,visibleCast:[]})
      } as unknown as Response)});
    });
  });
  try {
    render(<ShotScriptPanel projectId="p" libraryId="s" rows={rows} scenes={new Map()}/>);
    fireEvent.click(screen.getByText('Illustrate scene with PixelLab and play'));
    await waitFor(()=>expect([...requests.keys()]).toEqual(['a']));
    requests.get('a')!.finish();
    await waitFor(()=>expect([...requests.keys()]).toEqual(['a','b','c']));
    expect(requests.get('b')!.reference).toBe('data:image/png;base64,YQ==');
    expect(requests.get('c')!.reference).toBe(requests.get('b')!.reference);
    requests.get('c')!.finish();
    await waitFor(()=>expect(screen.getByText('1 generation task in progress')).toBeTruthy());
    requests.get('b')!.finish();
    await waitFor(()=>expect(screen.getByTitle('Scene animation').getAttribute('srcdoc')).toContain('data:image/png;base64,Yw=='));
    expect(screen.getByTitle('Scene animation').getAttribute('srcdoc')).toContain('data:image/png;base64,Yg==');
  } finally {
    global.fetch = previous;
    localStorage.clear();
  }
});
