import fs from 'node:fs/promises';
const prompt=(await fs.readFile('src/lib/services/scriptTextGrammar.ts','utf8')).split('= `')[1].split('`;')[0]
 .replace(/[^\x00-\x7f]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const prefix='Use whole-line **bold titles**, whole-line *italic scene/action descriptions*, and `Speaker: dialogue` without outer quotes. Use ASCII syntax punctuation. ';
for(const plugin of ['keco-codex','keco-claude']){
 const dir=`plugins/${plugin}/skills/keco-convert-document-to-script`;
 await fs.writeFile(`${dir}/references/script-grammar.md`,'# Script grammar\n\nUnicode escapes in multilingual examples denote the corresponding source characters.\n\n'+prompt+'\n');
 const skill=(await fs.readFile(`${dir}/SKILL.md`,'utf8')).split(prefix).join('');
 await fs.writeFile(`${dir}/SKILL.md`,skill.replace("Preserve the user's original language",prefix+"Preserve the user's original language"));
}
