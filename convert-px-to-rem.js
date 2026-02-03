const fs = require('fs');
const path = require('path');

// px 转 rem 的映射表（基于 16px）
const pxToRemMap = {
  '597px': '37.3125rem',
  '303px': '18.9375rem',
  '271px': '16.9375rem',
  '64px': '4rem',
  '48px': '3rem',
  '40px': '2.5rem',
  '32px': '2rem',
  '28px': '1.75rem',
  '24px': '1.5rem',
  '22px': '1.375rem',
  '20px': '1.25rem',
  '18px': '1.125rem',
  '16px': '1rem',
  '14px': '0.875rem',
  '12px': '0.75rem',
  '11px': '0.6875rem',
  '10px': '0.625rem',
  '8px': '0.5rem',
  '6px': '0.375rem',
  '4px': '0.25rem',
  '3px': '0.1875rem',
  '2px': '0.125rem',
};

// 不应该转换的属性（保持 px）
const skipProperties = [
  'border-width',
  'outline-width',
  'stroke-width',
];

// 不应该转换 1px 的上下文
const keep1px = true;

function shouldSkipLine(line) {
  // 跳过注释
  if (line.trim().startsWith('/*') || line.trim().startsWith('*') || line.trim().startsWith('//')) {
    return true;
  }
  
  // 跳过媒体查询
  if (line.includes('@media')) {
    return true;
  }
  
  // 跳过特定属性
  for (const prop of skipProperties) {
    if (line.includes(prop + ':')) {
      return true;
    }
  }
  
  return false;
}

function convertPxToRem(content) {
  const lines = content.split('\n');
  const convertedLines = lines.map(line => {
    if (shouldSkipLine(line)) {
      return line;
    }
    
    let convertedLine = line;
    
    // 转换映射表中的值
    Object.entries(pxToRemMap).forEach(([px, rem]) => {
      // 匹配 :空格*值 的模式，但不匹配 border: 1px
      const regex = new RegExp(`(:\\s*)${px}(?!\\s*solid|\\s*dashed|\\s*dotted)`, 'g');
      convertedLine = convertedLine.replace(regex, `$1${rem}`);
    });
    
    // 保持边框的 1px 不变，但转换其他位置的 1px
    if (!line.includes('border') && !line.includes('outline')) {
      convertedLine = convertedLine.replace(/(:\s*)1px/g, '$10.0625rem');
    }
    
    return convertedLine;
  });
  
  return convertedLines.join('\n');
}

function getAllCssFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== 'dist') {
        getAllCssFiles(filePath, fileList);
      }
    } else if (file.endsWith('.css')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function convertFiles() {
  try {
    // 查找所有 CSS 文件
    const srcPath = path.join(process.cwd(), 'src');
    const cssFiles = getAllCssFiles(srcPath).map(f => 
      path.relative(process.cwd(), f)
    );
    
    console.log(`\n🔍 找到 ${cssFiles.length} 个 CSS 文件\n`);
    
    let convertedCount = 0;
    let skippedCount = 0;
    
    for (const file of cssFiles) {
      const filePath = path.join(process.cwd(), file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // 检查是否有需要转换的 px
      const hasPxToConvert = Object.keys(pxToRemMap).some(px => 
        content.includes(px) && !content.includes(px.replace('px', 'rem'))
      );
      
      if (!hasPxToConvert) {
        console.log(`⏭️  跳过: ${file} (没有需要转换的内容)`);
        skippedCount++;
        continue;
      }
      
      const convertedContent = convertPxToRem(content);
      
      if (convertedContent !== content) {
        // 备份原文件
        const backupPath = filePath + '.backup';
        fs.writeFileSync(backupPath, content, 'utf8');
        
        // 写入转换后的内容
        fs.writeFileSync(filePath, convertedContent, 'utf8');
        
        console.log(`✅ 转换: ${file}`);
        convertedCount++;
      } else {
        console.log(`⏭️  跳过: ${file} (无变化)`);
        skippedCount++;
      }
    }
    
    console.log(`\n✨ 完成！`);
    console.log(`   转换: ${convertedCount} 个文件`);
    console.log(`   跳过: ${skippedCount} 个文件`);
    console.log(`\n💾 原文件已备份为 .backup 后缀`);
    console.log(`   如需恢复，删除转换后的文件并重命名 .backup 文件即可\n`);
    
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}

convertFiles();

